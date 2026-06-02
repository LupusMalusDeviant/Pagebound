using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Persistenz benannter Stapel-Regeln (FA-052) — 100 % lokal (IndexedDB via
/// <see cref="IStorageService"/>), kein Server. Analog <see cref="IEditorDraftService"/>.
/// </summary>
public interface IBatchRuleStore
{
    /// <summary>Alle gespeicherten Regeln (neueste zuerst).</summary>
    Task<IReadOnlyList<BatchRule>> ListAsync(CancellationToken cancellationToken);

    /// <summary>Speichert (erstellt/aktualisiert) eine Regel; setzt Id (falls leer) + UpdatedAt.</summary>
    Task SaveAsync(BatchRule rule, CancellationToken cancellationToken);

    /// <summary>Löscht eine Regel.</summary>
    Task DeleteAsync(string id, CancellationToken cancellationToken);
}
