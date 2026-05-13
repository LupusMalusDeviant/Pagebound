using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// PDF-Renderer. Default-Implementierung (PdfJsRenderer) kapselt PDF.js via JS-Interop.
/// Spätere MAUI-Variante kann durch Native-Implementation ersetzt werden.
/// Erfüllt FA-001, FA-003, FA-004, FA-005, FA-006, FA-007, FA-008.
/// </summary>
public interface IPdfRenderer
{
    Task<PdfDocumentHandle> LoadAsync(
        Stream pdf,
        LoadOptions options,
        CancellationToken cancellationToken);

    Task<RenderedPage> RenderPageAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        RenderOptions options,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<TextItem>> ExtractTextAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<SearchHit>> SearchAsync(
        PdfDocumentHandle handle,
        string query,
        SearchOptions options,
        CancellationToken cancellationToken);

    Task<PdfOutline?> GetOutlineAsync(
        PdfDocumentHandle handle,
        CancellationToken cancellationToken);

    Task UnloadAsync(PdfDocumentHandle handle);
}
