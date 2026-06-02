using System.Text;
using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfConverter"/> auf Basis der PDF.js-Bridge (<c>pageboundPdf</c>):
/// Text via Text-Extraktion, PNG/JPG/HTML via Seiten-Rendering.
/// Erfüllt FA-030 (PNG/JPG), FA-031 (Text), FA-032 (HTML).
/// </summary>
public sealed class JsPdfConverter : IPdfConverter
{
    private const string Module = "pageboundPdf";
    // Entspricht dem internen 100%-Scale des Viewers — gute Lesbarkeit ohne riesige Dateien.
    private const double RenderScale = 2.0;
    private const double JpegQuality = 0.85;

    private readonly IJSRuntime _js;

    public JsPdfConverter(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<ConversionResult> ConvertAsync(byte[] pdf, ConversionFormat format, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        if (pdf.Length == 0)
        {
            throw new ArgumentException("PDF darf nicht leer sein.", nameof(pdf));
        }

        switch (format)
        {
            case ConversionFormat.Text:
            {
                var text = await _js.InvokeAsync<string>($"{Module}.convertToText", cancellationToken, pdf)
                    .ConfigureAwait(false);
                return new ConversionResult(Encoding.UTF8.GetBytes(text ?? string.Empty), "txt", "text/plain");
            }
            case ConversionFormat.Html:
            {
                var html = await _js.InvokeAsync<string>($"{Module}.convertToHtml", cancellationToken, pdf, RenderScale)
                    .ConfigureAwait(false);
                return new ConversionResult(Encoding.UTF8.GetBytes(html ?? string.Empty), "html", "text/html");
            }
            case ConversionFormat.Png:
            case ConversionFormat.Jpg:
            {
                var jsFormat = format == ConversionFormat.Jpg ? "jpeg" : "png";
                var zip = await _js.InvokeAsync<byte[]>(
                    $"{Module}.convertToImagesZip", cancellationToken, pdf, jsFormat, JpegQuality, RenderScale)
                    .ConfigureAwait(false);
                return new ConversionResult(zip, "zip", "application/zip");
            }
            default:
                throw new ArgumentOutOfRangeException(nameof(format), format, "Unbekanntes Konvertierungsformat.");
        }
    }
}
