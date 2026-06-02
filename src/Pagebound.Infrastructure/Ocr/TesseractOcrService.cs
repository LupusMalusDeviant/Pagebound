using System.Text.Json.Serialization;
using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Ocr;

/// <summary>
/// <see cref="IOcrService"/>-Implementierung, die Tesseract.js im Browser
/// nutzt (FA-050). Die eigentliche Recognition läuft in
/// <c>wwwroot/js/ocr-bridge.ts</c> in einem Web-Worker; wir reichen lediglich
/// den base64-Data-URL durch und übersetzen das Result zurück ins Domain-Modell.
///
/// Sprach-Pakete (~10 MB pro Sprache) zieht Tesseract.js lazy beim ersten
/// Aufruf und cached sie für die Session — der erste Klick dauert deutlich
/// länger als alle folgenden.
/// </summary>
public sealed class TesseractOcrService : IOcrService
{
    private readonly IJSRuntime _js;

    public TesseractOcrService(IJSRuntime js)
    {
        _js = js;
    }

    public async Task<OcrPageResult> RecognizePageAsync(
        string imageDataUrl,
        string languages,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(imageDataUrl);
        if (string.IsNullOrWhiteSpace(languages)) languages = "eng";

        JsOcrPageResult dto;
        try
        {
            dto = await _js.InvokeAsync<JsOcrPageResult>(
                "pageboundOcr.recognizePage",
                cancellationToken,
                imageDataUrl,
                languages).ConfigureAwait(false);
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:ocr-recognize] Tesseract-Worker fehlgeschlagen: {jsex.Message}", jsex);
        }

        var words = dto.Words?.Select(w => new OcrWord(
            Text: w.Text ?? string.Empty,
            X: w.X,
            Y: w.Y,
            Width: w.Width,
            Height: w.Height,
            Confidence: w.Confidence)).ToList() ?? new List<OcrWord>();

        return new OcrPageResult(
            Text: dto.Text ?? string.Empty,
            Confidence: dto.Confidence,
            Words: words,
            ImageWidth: dto.ImageWidth,
            ImageHeight: dto.ImageHeight);
    }

    // DTOs für System.Text.Json-Deserialisierung des JS-Bridge-Outputs (camelCase).
    private sealed class JsOcrPageResult
    {
        [JsonPropertyName("text")] public string? Text { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
        [JsonPropertyName("words")] public List<JsOcrWord>? Words { get; set; }
        [JsonPropertyName("imageWidth")] public double ImageWidth { get; set; }
        [JsonPropertyName("imageHeight")] public double ImageHeight { get; set; }
    }

    private sealed class JsOcrWord
    {
        [JsonPropertyName("text")] public string? Text { get; set; }
        [JsonPropertyName("x")] public double X { get; set; }
        [JsonPropertyName("y")] public double Y { get; set; }
        [JsonPropertyName("width")] public double Width { get; set; }
        [JsonPropertyName("height")] public double Height { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
    }
}
