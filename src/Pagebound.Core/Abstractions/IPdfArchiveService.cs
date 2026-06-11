namespace Pagebound.Core.Abstractions;

/// <summary>
/// Konvertiert eine PDF Richtung PDF/A-2b — <b>Best Effort, keine
/// Konformitätsgarantie</b>. Setzt XMP-Metadaten (pdfaid:part=2, conformance=B),
/// bettet einen sRGB-OutputIntent (GTS_PDFA1) ein, entfernt aktive Inhalte
/// (/OpenAction, Dokument-JavaScript, Additional Actions), flattet optional
/// AcroForm-Felder und setzt eine Trailer-ID. Nicht eingebettete Schriften
/// werden nicht repariert, sondern als Warnungen gemeldet — das Ergebnis ist
/// für Archivzwecke extern zu prüfen (z. B. veraPDF).
/// Im Browser-Pfad über die pdf-lib-Bridge (pageboundPdfManipulator.convertToPdfA);
/// MCP-Pendant: Tool <c>pdf_to_pdfa</c>.
/// </summary>
public interface IPdfArchiveService
{
    /// <summary>
    /// Erzeugt eine neue PDF in PDF/A-2b-Nähe. Die Eingabe bleibt unangetastet.
    /// </summary>
    /// <param name="pdf">Quell-PDF (unverschlüsselt — PDF/A verbietet Verschlüsselung).</param>
    /// <param name="flattenForm">AcroForm-Felder vor der Konvertierung einbrennen (empfohlen).</param>
    Task<PdfArchiveResult> ConvertToPdfAAsync(Stream pdf, bool flattenForm, CancellationToken cancellationToken);
}

/// <summary>
/// Ergebnis der Best-Effort-Konvertierung: die neuen Bytes plus ehrliche
/// Hinweise (z. B. nicht eingebettete Schriften, entfernte Aktionen).
/// </summary>
public sealed record PdfArchiveResult(byte[] Bytes, IReadOnlyList<string> Warnings);
