namespace Pagebound.Core.Domain;

/// <summary>
/// Metadaten zum Unterzeichner einer PNG-Signatur (FA-015).
///
/// Werden in der Sidecar gespeichert und beim Embed in die PDF zusätzlich
/// in das <c>/Info</c>-Dictionary geschrieben (Standard-`Author` plus
/// Pagebound-Custom-Keys), damit auch andere PDF-Reader die Information
/// sehen können.
///
/// Felder bewusst lose modelliert — keine Pflichtfelder im Datenmodell;
/// die UI erzwingt nur, dass <see cref="Name"/> nicht leer ist, bevor
/// signiert wird.
/// </summary>
public sealed record SignerInfo(
    string Name,
    string? Email = null,
    string? Reason = null,
    string? Location = null)
{
    public static readonly SignerInfo Empty = new(string.Empty);

    public bool IsComplete => !string.IsNullOrWhiteSpace(Name);
}
