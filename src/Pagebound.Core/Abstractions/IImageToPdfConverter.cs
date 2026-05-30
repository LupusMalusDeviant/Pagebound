using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Erzeugt aus einem oder mehreren Bildern (PNG/JPG) eine PDF — je Bild eine
/// Seite, in der übergebenen Reihenfolge (FA-025).
///
/// Web-Implementierung: <c>JsImageToPdfConverter</c> über die pdf-lib-JS-Bridge
/// (<c>pageboundPdfManipulator.imagesToPdf</c>) — pdf-lib bettet PNG/JPG nativ
/// im Browser ein, kein MD5 nötig.
/// </summary>
public interface IImageToPdfConverter
{
    /// <summary>
    /// Konvertiert die Bilder zu einer PDF. Wirft, wenn die Liste leer ist oder
    /// ein nicht unterstütztes Bildformat enthält.
    /// </summary>
    Task<byte[]> ConvertAsync(
        IReadOnlyList<PdfImageInput> images,
        ImageToPdfOptions options,
        CancellationToken cancellationToken);
}
