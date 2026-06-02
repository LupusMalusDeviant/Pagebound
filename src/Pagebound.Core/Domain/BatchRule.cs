namespace Pagebound.Core.Domain;

/// <summary>
/// Gespeicherte Stapel-Regel (FA-052): ein benanntes Preset einer Batch-Operation.
/// Bewusst OHNE Passwort — Secrets werden nie persistiert; das Passwort gibt der
/// Nutzer bei jedem Lauf neu ein. 100 % lokal (IndexedDB).
/// </summary>
public sealed class BatchRule
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>Name des Batch-Operations-Enums (z. B. "Compress"), als String persistiert.</summary>
    public string Operation { get; set; } = string.Empty;

    public DateTimeOffset UpdatedAt { get; set; }
}
