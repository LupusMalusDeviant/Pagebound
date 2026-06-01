using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Editor;

/// <summary>
/// <see cref="IEditorDraftService"/> auf Basis von <see cref="IStorageService"/>
/// (IndexedDB). Jeder Entwurf liegt unter <c>editor:doc:{id}</c> als JSON.
/// Die Liste lädt die (wenigen, lokalen) Dokumente und projiziert auf
/// <see cref="EditorDraftInfo"/> — kein Server, kein Netzwerk (AK-05).
/// </summary>
public sealed class EditorDraftService : IEditorDraftService
{
    private const string KeyPrefix = "editor:doc:";

    private readonly IStorageService _storage;

    public EditorDraftService(IStorageService storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    private static string KeyFor(string id) => KeyPrefix + id;

    public async Task<IReadOnlyList<EditorDraftInfo>> ListAsync(CancellationToken cancellationToken)
    {
        var infos = new List<EditorDraftInfo>();
        await foreach (var key in _storage.KeysAsync(KeyPrefix, cancellationToken).ConfigureAwait(false))
        {
            var doc = await _storage.GetAsync<EditorDocument>(key, cancellationToken).ConfigureAwait(false);
            if (doc is not null)
            {
                infos.Add(new EditorDraftInfo(doc.Id, doc.Title, doc.Layout, doc.UpdatedAt));
            }
        }
        return infos.OrderByDescending(i => i.UpdatedAt).ToList();
    }

    public Task<EditorDocument?> LoadAsync(string id, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        return _storage.GetAsync<EditorDocument>(KeyFor(id), cancellationToken);
    }

    public Task SaveAsync(EditorDocument document, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (string.IsNullOrEmpty(document.Id))
        {
            document.Id = Guid.NewGuid().ToString("N");
        }
        document.UpdatedAt = DateTimeOffset.UtcNow;
        return _storage.SetAsync(KeyFor(document.Id), document, cancellationToken);
    }

    public Task DeleteAsync(string id, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        return _storage.DeleteAsync(KeyFor(id), cancellationToken);
    }
}
