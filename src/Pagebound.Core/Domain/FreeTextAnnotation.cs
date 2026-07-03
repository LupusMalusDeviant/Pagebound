using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Hilfsklasse für Freitext-Annotationen (FA — Text direkt auf der Seite,
/// wie der Text-Modus im Edge-PDF-Reader). Auch der Datum-Stempel des Readers
/// ist ein Freitext (vorbefüllt mit dem lokalen PC-Datum).
///
/// Payload-Struktur:
///   text:      Der Textinhalt (mehrzeilig via \n, KEIN Markdown)
///   x, y:      Top-Left-Position als 0..1-Fraction der Seite
///   fontSize:  Schriftgröße als 0..1-Fraction der Seitenhöhe
///              (skaliert damit zoom-unabhängig, Render via cqh)
///   color:     Textfarbe als Hex (#rrggbb)
/// </summary>
public static class FreeTextAnnotation
{
    public const string PayloadKeyText = "text";
    public const string PayloadKeyX = "x";
    public const string PayloadKeyY = "y";
    public const string PayloadKeyFontSize = "fontSize";
    public const string PayloadKeyColor = "color";

    /// <summary>Default-Schriftgröße: 2 % der Seitenhöhe (~17 pt auf A4).</summary>
    public const double DefaultFontSize = 0.02;

    /// <summary>Default-Farbe: Schwarz.</summary>
    public const string DefaultColor = "#000000";

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        double x,
        double y,
        string text,
        double? fontSize = null,
        string? color = null) =>
        new(
            pdfId,
            AnnotationType.FreeText,
            pageNumber,
            BuildPayload(x, y, text, fontSize ?? DefaultFontSize, color ?? DefaultColor));

    public static Annotation WithText(Annotation existing, string newText)
    {
        var payload = BuildPayload(GetX(existing), GetY(existing), newText, GetFontSize(existing), GetColor(existing));
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static Annotation WithPosition(Annotation existing, double x, double y)
    {
        var payload = BuildPayload(x, y, GetText(existing), GetFontSize(existing), GetColor(existing));
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static Annotation WithStyle(Annotation existing, double fontSize, string color)
    {
        var payload = BuildPayload(GetX(existing), GetY(existing), GetText(existing), fontSize, color);
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    /// <summary>
    /// Setzt Text UND Stil in einem Rutsch (ein Payload-Build, ein UpdatedAt-Bump).
    /// Vorbild für den Editor-Save, der beides zusammen persistiert (F-11).
    /// </summary>
    public static Annotation WithTextAndStyle(Annotation existing, string newText, double fontSize, string color)
    {
        var payload = BuildPayload(GetX(existing), GetY(existing), newText, fontSize, color);
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static double GetX(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyX);
    public static double GetY(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyY);
    public static string GetText(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyText);
    public static string GetColor(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyColor, DefaultColor);

    public static double GetFontSize(Annotation annotation)
    {
        var value = AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyFontSize);
        return value > 0 ? value : DefaultFontSize;
    }

    private static IReadOnlyDictionary<string, object?> BuildPayload(
        double x,
        double y,
        string text,
        double fontSize,
        string color) =>
        new Dictionary<string, object?>
        {
            [PayloadKeyX] = x,
            [PayloadKeyY] = y,
            [PayloadKeyText] = text,
            [PayloadKeyFontSize] = fontSize,
            [PayloadKeyColor] = color
        };
}
