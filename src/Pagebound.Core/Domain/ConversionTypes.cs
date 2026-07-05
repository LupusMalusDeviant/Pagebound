namespace Pagebound.Core.Domain;

/// <summary>Zielformat einer PDF-Konvertierung (FA-030 PNG/JPG, FA-031 Text, FA-032 HTML).</summary>
public enum ConversionFormat
{
    Png,
    Jpg,
    Text,
    Html,
    Csv,
    // Nur anhängen (nicht einsortieren): Office-Exporte als Best-Effort.
    Docx,
    Xlsx,
    Pptx,
    // Editierbarer Vektor-SVG-Export (pdfjs-Operatorliste → SVG mit eingebetteten Fonts);
    // ein SVG je Seite, als ZIP gebündelt.
    Svg
}

/// <summary>
/// Ergebnis einer Konvertierung: die fertigen Bytes plus Dateiendung und
/// MIME-Type für den Download. Bei mehrseitigen Bild-Exports (PNG/JPG) ist
/// <see cref="Bytes"/> ein ZIP mit einer Bilddatei pro Seite.
/// </summary>
public sealed record ConversionResult(byte[] Bytes, string FileExtension, string MimeType);
