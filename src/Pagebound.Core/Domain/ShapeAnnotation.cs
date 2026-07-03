using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Form-Kind einer <see cref="ShapeAnnotation"/>:
/// Rechteck (hohl), Pfeil (Linie mit Spitze am Endpunkt),
/// gerade Linie ohne Spitze.
/// </summary>
public enum ShapeKind
{
    Rectangle,
    Arrow,
    Line
}

/// <summary>
/// Hilfsklasse für Formen-Annotationen (FA-014). Eine Form wird über zwei
/// Punkte definiert: Start (z.B. Klick-Down) und End (z.B. Pointer-Up), beide
/// in 0..1-Page-Koordinaten. Rechteck = umschließende Box der beiden Punkte;
/// Pfeil/Linie = Linie von Start nach End (Pfeil zusätzlich mit Spitze bei End).
///
/// Payload-Struktur:
///   shape:        "rectangle" | "arrow" | "line"
///   color:        CSS-Farbwert
///   strokeWidth:  Strichstärke als Anteil der Seitenbreite
///   startX, startY, endX, endY:   die zwei Definitionspunkte (0..1)
/// </summary>
public static class ShapeAnnotation
{
    public const string PayloadKeyShape = "shape";
    public const string PayloadKeyColor = "color";
    public const string PayloadKeyStrokeWidth = "strokeWidth";
    public const string PayloadKeyStartX = "startX";
    public const string PayloadKeyStartY = "startY";
    public const string PayloadKeyEndX = "endX";
    public const string PayloadKeyEndY = "endY";

    public const string DefaultColor = "#000000";
    public const double DefaultStrokeWidth = 0.004;

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        ShapeKind shape,
        double startX,
        double startY,
        double endX,
        double endY,
        string? color = null,
        double? strokeWidth = null) =>
        new(
            pdfId,
            AnnotationType.Shape,
            pageNumber,
            new Dictionary<string, object?>
            {
                [PayloadKeyShape] = ShapeKindToString(shape),
                [PayloadKeyColor] = color ?? DefaultColor,
                [PayloadKeyStrokeWidth] = strokeWidth ?? DefaultStrokeWidth,
                [PayloadKeyStartX] = startX,
                [PayloadKeyStartY] = startY,
                [PayloadKeyEndX] = endX,
                [PayloadKeyEndY] = endY
            });

    public static ShapeKind GetShape(Annotation annotation)
    {
        var raw = AnnotationPayload.GetString(annotation.Payload, PayloadKeyShape, "rectangle");
        return raw.ToLowerInvariant() switch
        {
            "rectangle" or "rect" => ShapeKind.Rectangle,
            "arrow" => ShapeKind.Arrow,
            "line" => ShapeKind.Line,
            _ => ShapeKind.Rectangle
        };
    }

    public static string GetColor(Annotation annotation) =>
        AnnotationPayload.GetString(annotation.Payload, PayloadKeyColor, DefaultColor);

    public static double GetStrokeWidth(Annotation annotation) =>
        AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyStrokeWidth, DefaultStrokeWidth);

    public static double GetStartX(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyStartX, 0);
    public static double GetStartY(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyStartY, 0);
    public static double GetEndX(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyEndX, 0);
    public static double GetEndY(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyEndY, 0);

    private static string ShapeKindToString(ShapeKind shape) => shape switch
    {
        ShapeKind.Rectangle => "rectangle",
        ShapeKind.Arrow => "arrow",
        ShapeKind.Line => "line",
        _ => "rectangle"
    };
}
