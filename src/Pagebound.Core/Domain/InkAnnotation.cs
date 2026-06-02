using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>Ein einzelner Punkt einer Stift-Linie, in normalisierten 0..1-Page-Koordinaten.</summary>
public sealed record InkPoint(double X, double Y);

/// <summary>Ein Strich (eine durchgehende Linie) als Punktfolge.</summary>
public sealed record InkStroke(IReadOnlyList<InkPoint> Points);

/// <summary>
/// Hilfsklasse für Stift-/Freihand-Annotationen (FA-013).
/// Payload-Struktur:
///   strokes:      Liste von Strichen, jeder Strich = Liste von Punkten (0..1)
///   color:        CSS-Farbwert (Default: schwarz)
///   strokeWidth:  Strichstärke als Anteil der Seitenbreite (Default: 0.004)
/// </summary>
public static class InkAnnotation
{
    public const string PayloadKeyStrokes = "strokes";
    public const string PayloadKeyColor = "color";
    public const string PayloadKeyStrokeWidth = "strokeWidth";

    public const string DefaultColor = "#000000";
    public const double DefaultStrokeWidth = 0.004;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        IReadOnlyList<InkStroke> strokes,
        string? color = null,
        double? strokeWidth = null) =>
        new(
            pdfId,
            AnnotationType.Ink,
            pageNumber,
            BuildPayload(strokes, color ?? DefaultColor, strokeWidth ?? DefaultStrokeWidth));

    public static IReadOnlyList<InkStroke> GetStrokes(Annotation annotation)
    {
        if (!annotation.Payload.TryGetValue(PayloadKeyStrokes, out var value) || value is null)
        {
            return Array.Empty<InkStroke>();
        }

        return value switch
        {
            IReadOnlyList<InkStroke> typed => typed,
            IEnumerable<InkStroke> enumerable => enumerable.ToList(),
            JsonElement element when element.ValueKind == JsonValueKind.Array =>
                element.Deserialize<List<InkStroke>>(JsonOptions) ?? new List<InkStroke>(),
            _ => Array.Empty<InkStroke>()
        };
    }

    public static string GetColor(Annotation annotation) =>
        GetString(annotation.Payload, PayloadKeyColor, DefaultColor);

    public static double GetStrokeWidth(Annotation annotation)
    {
        if (!annotation.Payload.TryGetValue(PayloadKeyStrokeWidth, out var value) || value is null)
        {
            return DefaultStrokeWidth;
        }
        return value switch
        {
            double d => d,
            float f => f,
            int i => i,
            JsonElement el when el.ValueKind == JsonValueKind.Number => el.GetDouble(),
            _ => DefaultStrokeWidth
        };
    }

    private static IReadOnlyDictionary<string, object?> BuildPayload(
        IReadOnlyList<InkStroke> strokes,
        string color,
        double strokeWidth) =>
        new Dictionary<string, object?>
        {
            [PayloadKeyStrokes] = strokes.ToList(),
            [PayloadKeyColor] = color,
            [PayloadKeyStrokeWidth] = strokeWidth
        };

    private static string GetString(
        IReadOnlyDictionary<string, object?> payload,
        string key,
        string fallback)
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return fallback;
        return value switch
        {
            string s => s,
            JsonElement el when el.ValueKind == JsonValueKind.String => el.GetString() ?? fallback,
            _ => value.ToString() ?? fallback
        };
    }
}
