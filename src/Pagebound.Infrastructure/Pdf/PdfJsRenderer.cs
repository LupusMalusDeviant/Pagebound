using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// PDF-Renderer auf Basis von PDF.js (Mozilla) via JavaScript-Interop.
/// Die JS-Seite liegt in <c>wwwroot/js/pdfjs-bridge.ts</c> und wird als
/// globales <c>window.pageboundPdf</c> exponiert (esbuild IIFE-Bundle).
/// Erfüllt FA-001, FA-003, FA-004, FA-008 (Laden + Rendern).
/// FA-005 (Suche), FA-006 (Outline) sind in dieser Iteration noch Stubs.
/// </summary>
public sealed class PdfJsRenderer : IPdfRenderer
{
    private const string JsModuleId = "pageboundPdf";

    private readonly IJSRuntime _js;

    public PdfJsRenderer(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<PdfDocumentHandle> LoadAsync(
        Stream pdf,
        LoadOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);

        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
        var bytes = ms.ToArray();

        var result = await _js.InvokeAsync<LoadDto>(
            $"{JsModuleId}.loadPdf",
            cancellationToken,
            bytes,
            options.Password)
            .ConfigureAwait(false);

        return new PdfDocumentHandle(result.Id, result.PageCount, result.Title);
    }

    public async Task<RenderedPage> RenderPageAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        RenderOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(handle);
        ArgumentNullException.ThrowIfNull(options);
        if (pageNumber < 1 || pageNumber > handle.PageCount)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pageNumber),
                pageNumber,
                $"Seitenzahl muss zwischen 1 und {handle.PageCount} liegen.");
        }

        var result = await _js.InvokeAsync<RenderDto>(
            $"{JsModuleId}.renderPage",
            cancellationToken,
            handle.Id,
            pageNumber,
            options.Scale)
            .ConfigureAwait(false);

        var raster = Convert.FromBase64String(result.RasterBase64);
        return new RenderedPage(
            result.PageNumber,
            result.WidthPx,
            result.HeightPx,
            raster,
            result.RasterFormat);
    }

    public async Task<IReadOnlyList<TextItem>> ExtractTextAsync(
        PdfDocumentHandle handle,
        int pageNumber,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(handle);
        if (pageNumber < 1 || pageNumber > handle.PageCount)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pageNumber),
                pageNumber,
                $"Seitenzahl muss zwischen 1 und {handle.PageCount} liegen.");
        }

        var raw = await _js.InvokeAsync<TextItemDto[]>(
            $"{JsModuleId}.extractText",
            cancellationToken,
            handle.Id,
            pageNumber)
            .ConfigureAwait(false);

        return raw
            .Select(item => new TextItem(item.Text, item.X, item.Y, item.Width, item.Height))
            .ToList();
    }

    public async Task<IReadOnlyList<SearchHit>> SearchAsync(
        PdfDocumentHandle handle,
        string query,
        SearchOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(handle);
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrEmpty(query))
        {
            return Array.Empty<SearchHit>();
        }

        var raw = await _js.InvokeAsync<SearchHitDto[]>(
            $"{JsModuleId}.search",
            cancellationToken,
            handle.Id,
            query,
            options.MatchCase,
            options.WholeWord)
            .ConfigureAwait(false);

        return raw
            .Select(hit => new SearchHit(
                hit.PageNumber,
                hit.Position,
                hit.Match,
                hit.Snippet,
                hit.SnippetMatchStart))
            .ToList();
    }

    public Task<PdfOutline?> GetOutlineAsync(
        PdfDocumentHandle handle,
        CancellationToken cancellationToken) =>
        throw new NotImplementedException(
            "GetOutlineAsync folgt in Release 0.2 (FA-006).");

    public async Task UnloadAsync(PdfDocumentHandle handle)
    {
        ArgumentNullException.ThrowIfNull(handle);
        try
        {
            await _js.InvokeVoidAsync($"{JsModuleId}.unload", handle.Id).ConfigureAwait(false);
        }
        catch (JSDisconnectedException)
        {
            // Circuit ist weg (z.B. Browser-Reload mitten im Unload). Ignorieren.
        }
    }

    // --- JS-Interop-DTOs ------------------------------------------------------

    private sealed record LoadDto(string Id, int PageCount, string? Title);

    private sealed record RenderDto(
        int PageNumber,
        int WidthPx,
        int HeightPx,
        string RasterBase64,
        string RasterFormat);

    private sealed record TextItemDto(string Text, double X, double Y, double Width, double Height);

    private sealed record SearchHitDto(
        int PageNumber,
        int Position,
        string Match,
        string Snippet,
        int SnippetMatchStart);
}
