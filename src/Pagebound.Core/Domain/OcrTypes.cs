namespace Pagebound.Core.Domain;

/// <summary>
/// Ein per OCR erkanntes Wort mit seiner Bounding-Box im gerenderten
/// Seitenbild. Koordinaten in Pixel relativ zum Image; das Mapping zurück in
/// Page-Punkte erledigt der Aufrufer mittels <see cref="OcrPageResult.ImageWidth"/>
/// und <see cref="OcrPageResult.ImageHeight"/>.
/// </summary>
public sealed record OcrWord(
    string Text,
    double X,
    double Y,
    double Width,
    double Height,
    double Confidence);

/// <summary>
/// OCR-Ergebnis einer einzelnen Seite (FA-050).
/// </summary>
public sealed record OcrPageResult(
    string Text,
    double Confidence,
    IReadOnlyList<OcrWord> Words,
    double ImageWidth,
    double ImageHeight);
