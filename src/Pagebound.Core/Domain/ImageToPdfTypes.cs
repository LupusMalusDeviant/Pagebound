namespace Pagebound.Core.Domain;

/// <summary>
/// Seitengröße-Modus für die Bild→PDF-Erzeugung (FA-025).
/// </summary>
public enum PdfPageSizeMode
{
    /// <summary>Jede Seite exakt in Bildgröße (Pixel → Punkte, 1:1).</summary>
    ImageSize,

    /// <summary>Feste A4-Seite (Hoch-/Querformat nach Bild-Seitenverhältnis), Bild eingepasst.</summary>
    A4,

    /// <summary>Feste US-Letter-Seite, Bild eingepasst.</summary>
    Letter
}

/// <summary>
/// Optionen für die Bild→PDF-Erzeugung (FA-025).
/// </summary>
public sealed record ImageToPdfOptions(
    PdfPageSizeMode PageSize = PdfPageSizeMode.ImageSize,
    double MarginPoints = 0);

/// <summary>
/// Ein Eingabebild für die PDF-Erzeugung. <see cref="MimeType"/> z.B.
/// <c>image/png</c> oder <c>image/jpeg</c>; bestimmt das pdf-lib-Embed.
/// </summary>
public sealed record PdfImageInput(byte[] Bytes, string MimeType);
