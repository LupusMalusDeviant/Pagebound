using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IImageToPdfConverter"/>-Implementation für Blazor WASM: erzeugt die
/// PDF über die pdf-lib-JS-Bridge (<c>pageboundPdfManipulator.imagesToPdf</c>).
/// Bilder werden als Base64 übergeben (verschachtelte <c>byte[]</c> marshallt
/// Blazor nicht als <c>Uint8Array</c>), die Bridge dekodiert sie.
/// </summary>
public sealed class JsImageToPdfConverter : IImageToPdfConverter
{
    private readonly IJSRuntime _js;

    public JsImageToPdfConverter(IJSRuntime js) => _js = js;

    public async Task<byte[]> ConvertAsync(
        IReadOnlyList<PdfImageInput> images,
        ImageToPdfOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(images);
        ArgumentNullException.ThrowIfNull(options);
        if (images.Count == 0)
            throw new ArgumentException("Mindestens ein Bild erforderlich.", nameof(images));

        var payload = images.Select(i => new JsImage
        {
            Base64 = Convert.ToBase64String(i.Bytes),
            Mime = i.MimeType ?? string.Empty
        }).ToArray();

        var opts = new { pageSize = MapPageSize(options.PageSize), marginPt = options.MarginPoints };

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.imagesToPdf",
                cancellationToken,
                payload,
                opts).ConfigureAwait(false);
            return result ?? Array.Empty<byte>();
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:imagesToPdf] pdf-lib Bild→PDF fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    private static string MapPageSize(PdfPageSizeMode mode) => mode switch
    {
        PdfPageSizeMode.A4 => "a4",
        PdfPageSizeMode.Letter => "letter",
        _ => "image"
    };

    private sealed class JsImage
    {
        public string Base64 { get; init; } = string.Empty;
        public string Mime { get; init; } = string.Empty;
    }
}
