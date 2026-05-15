using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// OCR-Service (FA-050). Erste Iteration: pro Seite via Tesseract.js im Browser.
/// Persistierung der Erkennungs-Ergebnisse pro PDF läuft mit Release 0.9 nach,
/// wenn die Library-Storage AKtenmäßig durchgehärtet ist.
/// </summary>
public interface IOcrService
{
    /// <summary>
    /// Erkennt Text auf einem gerenderten Seitenbild. <paramref name="imageDataUrl"/>
    /// muss eine vollständige <c>data:image/...;base64,...</c>-URL sein (oder ein
    /// anderer von <c>Image</c> akzeptierter Quelltyp).
    /// </summary>
    /// <param name="imageDataUrl">Data-URL des Seitenbildes.</param>
    /// <param name="languages">Tesseract-Sprach-Code(s), z.B. <c>"eng"</c>, <c>"deu"</c>, <c>"eng+deu"</c>.</param>
    /// <param name="cancellationToken">Cancel-Token.</param>
    Task<OcrPageResult> RecognizePageAsync(
        string imageDataUrl,
        string languages,
        CancellationToken cancellationToken);
}
