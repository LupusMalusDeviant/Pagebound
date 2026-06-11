namespace Pagebound.Core.Abstractions;

/// <summary>
/// Archiv-/Barrierefreiheits-Aufbereitung — <b>Best Effort, keine
/// Konformitätsgarantie</b>.
/// PDF/A: Setzt XMP-Metadaten (pdfaid:part=2, conformance=B),
/// bettet einen sRGB-OutputIntent (GTS_PDFA1) ein, entfernt aktive Inhalte
/// (/OpenAction, Dokument-JavaScript, Additional Actions), flattet optional
/// AcroForm-Felder und setzt eine Trailer-ID. Nicht eingebettete Standard-14-
/// Schriften (Helvetica/Times/Courier) können durch metrisch kompatible,
/// eingebettete Liberation-Fonts (SIL OFL 1.1) ersetzt werden; andere nicht
/// eingebettete Schriften werden nur als Warnungen gemeldet — das Ergebnis ist
/// für Archivzwecke extern zu prüfen (z. B. veraPDF).
/// PDF/UA: Setzt die Kennzeichnung (/MarkInfo, /Lang, /DisplayDocTitle,
/// XMP pdfuaid:part=1) und liefert einen ehrlichen Prüfbericht — echtes
/// Tagging wird nicht synthetisiert.
/// Im Browser-Pfad über die pdf-lib-Bridge (pageboundPdfManipulator.convertToPdfA
/// bzw. preparePdfUa); MCP-Pendants: Tools <c>pdf_to_pdfa</c> und <c>pdf_ua_prepare</c>.
/// </summary>
public interface IPdfArchiveService
{
    /// <summary>
    /// Erzeugt eine neue PDF in PDF/A-2b-Nähe. Die Eingabe bleibt unangetastet.
    /// </summary>
    /// <param name="pdf">Quell-PDF (unverschlüsselt — PDF/A verbietet Verschlüsselung).</param>
    /// <param name="flattenForm">AcroForm-Felder vor der Konvertierung einbrennen (empfohlen).</param>
    /// <param name="embedFonts">Nicht eingebettete Standard-14-Schriften durch eingebettete Liberation-Fonts ersetzen (empfohlen).</param>
    Task<PdfArchiveResult> ConvertToPdfAAsync(Stream pdf, bool flattenForm, bool embedFonts, CancellationToken cancellationToken);

    /// <summary>
    /// Bereitet eine PDF Richtung PDF/UA-1 vor: Kennzeichnung (/MarkInfo Marked,
    /// /Lang, /DisplayDocTitle, XMP pdfuaid:part=1) plus ehrlicher Prüfbericht
    /// (fehlendes Tagging, fehlender Titel, Bilder ohne Alternativtext, Fonts
    /// ohne ToUnicode) in <see cref="PdfArchiveResult.Warnings"/>. Keine
    /// Konformitätsgarantie — echtes Tagging kann nicht synthetisiert werden.
    /// </summary>
    /// <param name="pdf">Quell-PDF (unverschlüsselt).</param>
    /// <param name="language">Dokumentsprache als BCP-47-Code (z. B. "de-DE", "en-US").</param>
    Task<PdfArchiveResult> PreparePdfUaAsync(Stream pdf, string language, CancellationToken cancellationToken);
}

/// <summary>
/// Ergebnis der Best-Effort-Aufbereitung: die neuen Bytes plus ehrliche
/// Hinweise (PDF/A: Warnungen, PDF/UA: Berichtszeilen).
/// </summary>
public sealed record PdfArchiveResult(byte[] Bytes, IReadOnlyList<string> Warnings);
