using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfArchiveService"/> für Blazor WASM — dünne Hülle über die
/// <c>pageboundPdfManipulator</c>-Bridge (wwwroot/js/pdf-manipulator-bridge.ts,
/// <c>convertToPdfA</c>; pdf-lib). Gleiches Muster wie
/// <see cref="Editor.BrowserDesignFolderService"/>: die Logik lebt im JS, hier
/// nur Marshalling. Best Effort — Warnungen der Bridge werden 1:1 durchgereicht.
/// </summary>
public sealed class JsPdfArchiveService : IPdfArchiveService
{
    /// <summary>DTO der Bridge: Ergebnis-PDF als base64 + Hinweise (camelCase via STJ).</summary>
    private sealed record JsPdfAResult(string DataBase64, string[]? Warnings);

    private readonly IJSRuntime _js;

    public JsPdfArchiveService(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<PdfArchiveResult> ConvertToPdfAAsync(Stream pdf, bool flattenForm, bool embedFonts, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);

        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
        var bytes = ms.ToArray();

        try
        {
            var result = await _js.InvokeAsync<JsPdfAResult>(
                "pageboundPdfManipulator.convertToPdfA", cancellationToken, bytes, flattenForm, embedFonts).ConfigureAwait(false);
            return new PdfArchiveResult(
                Convert.FromBase64String(result.DataBase64),
                result.Warnings ?? Array.Empty<string>());
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:pdfa] pdf-lib convertToPdfA fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<PdfArchiveResult> PreparePdfUaAsync(Stream pdf, string language, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentException.ThrowIfNullOrWhiteSpace(language);

        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
        var bytes = ms.ToArray();

        try
        {
            var result = await _js.InvokeAsync<JsPdfAResult>(
                "pageboundPdfManipulator.preparePdfUa", cancellationToken, bytes, language).ConfigureAwait(false);
            return new PdfArchiveResult(
                Convert.FromBase64String(result.DataBase64),
                result.Warnings ?? Array.Empty<string>());
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:pdfua] pdf-lib preparePdfUa fehlgeschlagen: {jsex.Message}", jsex);
        }
    }
}
