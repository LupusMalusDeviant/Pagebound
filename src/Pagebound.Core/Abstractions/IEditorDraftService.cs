using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Persistenz der WYSIWYG-Editor-Entwürfe — 100 % lokal (IndexedDB via
/// <see cref="IStorageService"/>). Speichert/lädt vollständige Dokumente und
/// liefert eine schlanke Liste für die Entwurfs-Übersicht. Erfüllt PF-04 / AK-04.
/// </summary>
public interface IEditorDraftService
{
    /// <summary>Alle gespeicherten Entwürfe (neueste zuerst), nur Metadaten.</summary>
    Task<IReadOnlyList<EditorDraftInfo>> ListAsync(CancellationToken cancellationToken);

    /// <summary>Lädt ein vollständiges Dokument; <c>null</c>, wenn nicht vorhanden.</summary>
    Task<EditorDocument?> LoadAsync(string id, CancellationToken cancellationToken);

    /// <summary>Speichert (erstellt/aktualisiert) ein Dokument; setzt <c>UpdatedAt</c>.</summary>
    Task SaveAsync(EditorDocument document, CancellationToken cancellationToken);

    /// <summary>Löscht einen Entwurf.</summary>
    Task DeleteAsync(string id, CancellationToken cancellationToken);
}
