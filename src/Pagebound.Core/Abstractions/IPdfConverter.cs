using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Konvertiert ein PDF in andere Formate (FA-030 PNG/JPG, FA-031 Text, FA-032 HTML).
/// Im Browser-Pfad über die PDF.js-Bridge (Seiten-Rendering bzw. Text-Extraktion).
/// </summary>
public interface IPdfConverter
{
    /// <summary>
    /// Konvertiert das ganze PDF ins gewünschte Format. PNG/JPG liefern ein ZIP
    /// (eine Bilddatei je Seite), Text/HTML liefern die jeweilige Textdatei.
    /// </summary>
    Task<ConversionResult> ConvertAsync(byte[] pdf, ConversionFormat format, CancellationToken cancellationToken);
}
