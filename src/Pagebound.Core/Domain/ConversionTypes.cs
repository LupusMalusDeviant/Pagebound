namespace Pagebound.Core.Domain;

/// <summary>Zielformat einer PDF-Konvertierung (FA-030 PNG/JPG, FA-031 Text, FA-032 HTML).</summary>
public enum ConversionFormat
{
    Png,
    Jpg,
    Text,
    Html,
    Csv
}

/// <summary>
/// Ergebnis einer Konvertierung: die fertigen Bytes plus Dateiendung und
/// MIME-Type für den Download. Bei mehrseitigen Bild-Exports (PNG/JPG) ist
/// <see cref="Bytes"/> ein ZIP mit einer Bilddatei pro Seite.
/// </summary>
public sealed record ConversionResult(byte[] Bytes, string FileExtension, string MimeType);
