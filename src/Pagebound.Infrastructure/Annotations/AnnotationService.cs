using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Annotations;

/// <summary>
/// Verwaltet Annotationen pro PDF. Persistierung läuft über
/// <see cref="IStorageService"/> (IndexedDB in Production, In-Memory in Tests).
/// Pro <see cref="PdfId"/> wird ein einzelnes Array unter dem Schlüssel
/// <c>annotations:{pdfId}</c> gehalten — eine pragmatische erste Iteration,
/// die später durch eine indexbasierte Variante ersetzt werden kann, wenn
/// Listen wachsen.
/// In-Memory-Cache verhindert wiederholte Storage-Roundtrips während einer
/// Lese-Session; jeder Schreibvorgang persistiert sofort (NFA-011 Auto-Save).
/// </summary>
public sealed class AnnotationService : IAnnotationService
{
    private const string KeyPrefix = "annotations:";

    private readonly IStorageService _storage;
    private readonly Dictionary<PdfId, List<Annotation>> _cache = new();
    private readonly SemaphoreSlim _lock = new(1, 1);

    public AnnotationService(IStorageService storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    public async Task<Annotation> CreateAsync(NewAnnotation input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);

        var now = DateTimeOffset.UtcNow;
        var annotation = new Annotation(
            AnnotationId.NewId(),
            input.PdfId,
            input.Type,
            input.PageNumber,
            now,
            now,
            input.Payload);

        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(input.PdfId, cancellationToken).ConfigureAwait(false);
            _cache[input.PdfId].Add(annotation);
            await PersistAsync(input.PdfId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _lock.Release();
        }

        return annotation;
    }

    public async Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(annotation);

        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(annotation.PdfId, cancellationToken).ConfigureAwait(false);
            var list = _cache[annotation.PdfId];
            var idx = list.FindIndex(a => a.Id.Value == annotation.Id.Value);
            if (idx < 0)
            {
                throw new InvalidOperationException($"Annotation '{annotation.Id.Value}' not found in cache.");
            }
            var updated = annotation with { UpdatedAt = DateTimeOffset.UtcNow };
            list[idx] = updated;
            await PersistAsync(annotation.PdfId, cancellationToken).ConfigureAwait(false);
            return updated;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task DeleteAsync(AnnotationId id, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // Wir wissen nicht, zu welcher PdfId die Annotation gehört. Suche in
            // jedem geladenen Cache und persistiere den betroffenen Bucket.
            foreach (var (pdfId, list) in _cache)
            {
                var idx = list.FindIndex(a => a.Id.Value == id.Value);
                if (idx < 0) continue;
                list.RemoveAt(idx);
                await PersistAsync(pdfId, cancellationToken).ConfigureAwait(false);
                return;
            }
            // Annotation gehört zu einer noch nicht geladenen PDF — selten,
            // aber möglich (UI hat den Pin aus einem vorherigen Mount im DOM).
            // Wir lassen den Aufruf still verpuffen.
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(pdfId, cancellationToken).ConfigureAwait(false);
            return _cache[pdfId].ToList();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId)
    {
        // TODO: Echte Beobachtbarkeit implementieren (eigener Subject/Channel),
        // sobald wir Multi-Subscriber-Szenarien (z.B. Pin-Overlay + Notiz-Liste)
        // gleichzeitig haben. Vorerst leerer Stream, damit das Interface
        // erfüllbar ist.
        await Task.CompletedTask;
        yield break;
    }

    private async Task EnsureLoadedAsync(PdfId pdfId, CancellationToken cancellationToken)
    {
        if (_cache.ContainsKey(pdfId)) return;
        var key = KeyPrefix + pdfId.Value;
        var stored = await _storage.GetAsync<List<Annotation>>(key, cancellationToken).ConfigureAwait(false);
        _cache[pdfId] = stored ?? new List<Annotation>();
    }

    private Task PersistAsync(PdfId pdfId, CancellationToken cancellationToken)
    {
        var key = KeyPrefix + pdfId.Value;
        return _storage.SetAsync(key, _cache[pdfId], cancellationToken);
    }
}
