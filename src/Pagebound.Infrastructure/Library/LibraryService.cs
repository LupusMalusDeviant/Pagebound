using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Library;

/// <summary>
/// Library-Verwaltung mit IndexedDB-Persistenz (FA-060 bis FA-064).
///
/// Layout in der Datenbank:
/// <list type="bullet">
///   <item><c>library:_index</c> — Array aller bekannten <see cref="LibraryEntryId"/>-Werte,
///         dient als Iterator-Quelle für Queries und Tag-Aggregation.</item>
///   <item><c>library:entry:{id}</c> — der einzelne <see cref="LibraryEntry"/> als JSON-Blob.
///         Granularität pro Eintrag macht Updates billig und vermeidet Race-Conditions
///         beim Cross-Tab-Schreiben.</item>
/// </list>
/// Pro Schreib-Operation greift ein <see cref="SemaphoreSlim"/>-Lock — Single-Tab macht
/// das nicht zwingend nötig, aber sobald wir Cross-Tab-Sync per BroadcastChannel
/// nachrüsten, ist die Serialisierung wichtig.
/// </summary>
public sealed class LibraryService : ILibraryService
{
    private const string IndexKey = "library:_index";
    private const string EntryKeyPrefix = "library:entry:";

    private readonly IStorageService _storage;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private List<LibraryEntryId>? _indexCache;

    public LibraryService(IStorageService storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    public async Task<LibraryEntry> AddOrUpdateAsync(LibraryEntry entry, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);

            // Match-Strategie: erst Id, dann Hash. Wenn der Hash schon bekannt ist
            // (gleiches PDF unter neuer Id), mergen wir auf den bestehenden Eintrag
            // und behalten dessen Id + AddedAt, aktualisieren aber LastOpenedAt,
            // Title, Tags etc.
            LibraryEntry? existing = null;
            if (_indexCache!.Any(id => id.Value == entry.Id.Value))
            {
                existing = await _storage.GetAsync<LibraryEntry>(KeyFor(entry.Id), cancellationToken)
                    .ConfigureAwait(false);
            }
            if (existing is null && entry.PdfMeta is not null
                && !string.IsNullOrEmpty(entry.PdfMeta.FileHashSha256))
            {
                existing = await FindByHashInternalAsync(entry.PdfMeta.FileHashSha256, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Merge-Regel: Werte aus `entry` haben Vorrang. Felder mit null-Wert
            // werden vom bestehenden Eintrag übernommen, damit Teil-Updates
            // (z.B. nur LastOpenedAt) andere Felder nicht versehentlich löschen.
            // Tags werden 1:1 übernommen (auch leeres Array), damit der User
            // bewusst alle Tags entfernen kann.
            var merged = existing is null
                ? entry
                : existing with
                {
                    Title = string.IsNullOrWhiteSpace(entry.Title) ? existing.Title : entry.Title,
                    Author = entry.Author ?? existing.Author,
                    Tags = entry.Tags ?? existing.Tags,
                    Rating = entry.Rating ?? existing.Rating,
                    LastOpenedAt = entry.LastOpenedAt ?? existing.LastOpenedAt,
                    Progress = entry.Progress ?? existing.Progress,
                    PdfMeta = entry.PdfMeta ?? existing.PdfMeta
                };

            await _storage.SetAsync(KeyFor(merged.Id), merged, cancellationToken).ConfigureAwait(false);
            if (!_indexCache!.Any(id => id.Value == merged.Id.Value))
            {
                _indexCache.Add(merged.Id);
                await _storage.SetAsync(IndexKey, _indexCache.Select(i => i.Value).ToList(), cancellationToken)
                    .ConfigureAwait(false);
            }
            return merged;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task RemoveAsync(LibraryEntryId id, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);
            // Vor dem Index-Update den Eintrag holen, damit wir den PDF-Hash
            // kennen — die persistierten PDF-Bytes liegen unter dem Hash-Key
            // (pdf:bytes:{hash}, siehe ReaderPane.PdfBytesKeyFor). Wenn die
            // ungelöscht bleiben würden, sammelt sich IndexedDB-Müll an.
            var existing = await _storage.GetAsync<LibraryEntry>(KeyFor(id), cancellationToken).ConfigureAwait(false);
            var removed = _indexCache!.RemoveAll(i => i.Value == id.Value) > 0;
            if (removed)
            {
                await _storage.DeleteAsync(KeyFor(id), cancellationToken).ConfigureAwait(false);
                await _storage.SetAsync(IndexKey, _indexCache.Select(i => i.Value).ToList(), cancellationToken)
                    .ConfigureAwait(false);
                if (existing?.PdfMeta is { } meta && !string.IsNullOrEmpty(meta.FileHashSha256))
                {
                    try
                    {
                        await _storage.DeleteAsync($"pdf:bytes:{meta.FileHashSha256}", cancellationToken)
                            .ConfigureAwait(false);
                    }
                    catch
                    {
                        // Best-effort — der Eintrag selbst ist schon weg.
                    }
                }
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<LibraryEntry?> GetAsync(LibraryEntryId id, CancellationToken cancellationToken)
    {
        return await _storage.GetAsync<LibraryEntry>(KeyFor(id), cancellationToken).ConfigureAwait(false);
    }

    public async Task<LibraryEntry?> FindByHashAsync(string sha256, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(sha256)) return null;
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);
            return await FindByHashInternalAsync(sha256, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<IReadOnlyList<LibraryEntry>> QueryAsync(LibraryQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);
            var all = await LoadAllAsync(cancellationToken).ConfigureAwait(false);

            IEnumerable<LibraryEntry> filtered = all;

            if (!string.IsNullOrWhiteSpace(query.FullTextSearch))
            {
                var q = query.FullTextSearch.Trim();
                filtered = filtered.Where(e => MatchesText(e, q));
            }
            if (query.Tags is { Count: > 0 })
            {
                var wanted = query.Tags.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
                if (wanted.Count > 0)
                {
                    filtered = filtered.Where(e =>
                        e.Tags is not null && e.Tags.Any(t => wanted.Contains(t, StringComparer.OrdinalIgnoreCase)));
                }
            }

            filtered = query.Sort switch
            {
                LibrarySort.LastOpenedDesc => filtered.OrderByDescending(e => e.LastOpenedAt ?? DateTimeOffset.MinValue),
                LibrarySort.AddedDesc => filtered.OrderByDescending(e => e.AddedAt),
                LibrarySort.TitleAsc => filtered.OrderBy(e => e.Title, StringComparer.CurrentCultureIgnoreCase),
                LibrarySort.TitleDesc => filtered.OrderByDescending(e => e.Title, StringComparer.CurrentCultureIgnoreCase),
                _ => filtered
            };

            if (query.Skip is int s and > 0) filtered = filtered.Skip(s);
            if (query.Take is int t and > 0) filtered = filtered.Take(t);

            return filtered.ToList();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<IReadOnlyList<string>> GetAllTagsAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);
            var all = await LoadAllAsync(cancellationToken).ConfigureAwait(false);
            return all
                .SelectMany(e => e.Tags ?? Array.Empty<string>())
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(t => t, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task TouchLastOpenedAsync(LibraryEntryId id, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureIndexLoadedAsync(cancellationToken).ConfigureAwait(false);
            var existing = await _storage.GetAsync<LibraryEntry>(KeyFor(id), cancellationToken).ConfigureAwait(false);
            if (existing is null) return;
            var updated = existing with { LastOpenedAt = DateTimeOffset.UtcNow };
            await _storage.SetAsync(KeyFor(id), updated, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lock.Release();
        }
    }

    // --- internals -----------------------------------------------------------

    private static string KeyFor(LibraryEntryId id) => EntryKeyPrefix + id.Value;

    private async Task EnsureIndexLoadedAsync(CancellationToken cancellationToken)
    {
        if (_indexCache is not null) return;
        var raw = await _storage.GetAsync<List<string>>(IndexKey, cancellationToken).ConfigureAwait(false);
        _indexCache = raw?.Select(v => new LibraryEntryId(v)).ToList() ?? new List<LibraryEntryId>();
    }

    private async Task<LibraryEntry?> FindByHashInternalAsync(string sha256, CancellationToken cancellationToken)
    {
        foreach (var id in _indexCache!)
        {
            var entry = await _storage.GetAsync<LibraryEntry>(KeyFor(id), cancellationToken).ConfigureAwait(false);
            if (entry?.PdfMeta is { } meta
                && string.Equals(meta.FileHashSha256, sha256, StringComparison.OrdinalIgnoreCase))
            {
                return entry;
            }
        }
        return null;
    }

    private async Task<List<LibraryEntry>> LoadAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<LibraryEntry>(_indexCache!.Count);
        foreach (var id in _indexCache)
        {
            var entry = await _storage.GetAsync<LibraryEntry>(KeyFor(id), cancellationToken).ConfigureAwait(false);
            if (entry is not null) result.Add(entry);
        }
        return result;
    }

    private static bool MatchesText(LibraryEntry entry, string needle)
    {
        // Erste Iteration: case-insensitive substring auf Titel, Filename, Author, Tags.
        // Volltext-Suche über PDF-Inhalt folgt in Release 0.9 (FA-050 OCR ->
        // dann steht ein Text-Index der gerenderten Seiten zur Verfügung).
        bool Has(string? s) => s is not null && s.Contains(needle, StringComparison.OrdinalIgnoreCase);
        if (Has(entry.Title) || Has(entry.Author)) return true;
        if (entry.PdfMeta is not null && Has(entry.PdfMeta.Filename)) return true;
        if (entry.Tags is not null && entry.Tags.Any(t => Has(t))) return true;
        return false;
    }
}
