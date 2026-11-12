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

    /// <summary>
    /// Rendert eine Seite und gibt die ROHBYTES zurück. Richtig für Aufrufer,
    /// die die Bytes wirklich brauchen — Schwärzen, Audit, Export, Weitergabe an
    /// pdf-lib. Für die bloße Anzeige ist
    /// <see cref="RenderPageToUrlAsync"/> der günstigere Weg: hier reist das
    /// Raster als base64 durch den WASM-Heap.
    /// </summary>
    Task<RenderedPage> RenderPageAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        RenderOptions options,
        CancellationToken cancellationToken);

    /// <summary>
    /// Rendert eine Seite als Bild-URL für die ANZEIGE. Das Raster bleibt in
    /// JavaScript und landet NICHT im WASM-Heap.
    ///
    /// Die URL ist eine Ressource, kein String: wer sie vergisst, ohne
    /// <see cref="ReleasePageImageAsync"/> zu rufen, leckt den Blob für die
    /// Lebensdauer der Seite. Siehe <c>docs/contracts/seitenbilder-speicher.md</c>.
    /// </summary>
    Task<PageImage> RenderPageToUrlAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        RenderOptions options,
        CancellationToken cancellationToken);

    /// <summary>Gibt eine mit <see cref="RenderPageToUrlAsync"/> erzeugte Bild-URL frei.</summary>
    Task ReleasePageImageAsync(PageImage image);

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
