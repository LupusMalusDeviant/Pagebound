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
            case ConversionFormat.Csv:
            {
                // Best-Effort-Tabellen-Extraktion (Roadmap B2): Heuristik auf den
                // Text-Positionen, kein ML. CSV (UTF-8), Seiten aneinandergehängt.
                var csv = await _js.InvokeAsync<string>($"{Module}.extractTablesCsv", cancellationToken, pdf)
                    .ConfigureAwait(false);
                return new ConversionResult(Encoding.UTF8.GetBytes(csv ?? string.Empty), "csv", "text/csv");
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
            case ConversionFormat.Docx:
            {
                // Best-Effort Word-Export: reiner Textfluss (Items->Zeilen->Absaetze),
                // von Hand als OOXML-ZIP gebaut. Ergebnis sind fertige .docx-Bytes.
                var docx = await _js.InvokeAsync<byte[]>($"{Module}.convertToDocx", cancellationToken, pdf)
                    .ConfigureAwait(false);
                return new ConversionResult(docx, "docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            }
            case ConversionFormat.Xlsx:
            {
                // Best-Effort Excel-Export: Tabellen-Heuristik, je Seite ein Blatt.
                var xlsx = await _js.InvokeAsync<byte[]>($"{Module}.convertToXlsx", cancellationToken, pdf)
                    .ConfigureAwait(false);
                return new ConversionResult(xlsx, "xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            }
            case ConversionFormat.Pptx:
            {
                // PowerPoint-Export: je Seite eine Folie mit dem Seitenbild.
                var pptx = await _js.InvokeAsync<byte[]>($"{Module}.convertToPptx", cancellationToken, pdf, RenderScale)
                    .ConfigureAwait(false);
                return new ConversionResult(pptx, "pptx",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation");
            }
            case ConversionFormat.Svg:
            {
                // Editierbarer Vektor-SVG-Export. Einseitig → ein SVG (direkt im Browser
                // öffenbar), mehrseitig → ZIP mit einem SVG je Seite. Die Bridge liefert
                // rohe Bytes; das Format erkennen wir am Magic-Byte ("PK" = ZIP, sonst SVG).
                var svg = await _js.InvokeAsync<byte[]>($"{Module}.convertToSvg", cancellationToken, pdf, RenderScale)
                    .ConfigureAwait(false);
                var isZip = svg.Length >= 2 && svg[0] == 0x50 && svg[1] == 0x4B; // "PK"
                return isZip
                    ? new ConversionResult(svg, "zip", "application/zip")
                    : new ConversionResult(svg, "svg", "image/svg+xml");
            }
            default:
                throw new ArgumentOutOfRangeException(nameof(format), format, "Unbekanntes Konvertierungsformat.");
        }
    }
}
