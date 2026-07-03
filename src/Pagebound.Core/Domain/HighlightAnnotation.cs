using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Ein hervorgehobener Bereich einer PDF-Seite, in normalisierten
/// Page-Koordinaten (0..1) — damit ist die Position bei jedem Zoom-Level
/// und für jede Render-Auflösung gültig.
/// </summary>
public sealed record HighlightRect(double X, double Y, double Width, double Height);

/// <summary>
/// Hilfsklasse für Highlight-Annotationen (FA-010).
/// Payload-Struktur:
///   color:           CSS-Farbwert (Default: gelb)
///   extractedText:   der hervorgehobene Text (für Markdown-Export / Suche)
///   rects:           Liste der einzelnen Highlight-Rechtecke
/// </summary>
public static class HighlightAnnotation
{
    public const string PayloadKeyRects = "rects";
    public const string PayloadKeyText = "extractedText";
    public const string PayloadKeyColor = "color";

    /// <summary>Default-Highlight-Farbe (Tailwind yellow-200 mit Alpha).</summary>
    public const string DefaultColor = "#fef08a";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        IReadOnlyList<HighlightRect> rects,
        string extractedText,
        string? color = null) =>
        new(
            pdfId,
            AnnotationType.Highlight,
            pageNumber,
            BuildPayload(rects, extractedText, color ?? DefaultColor));

    public static Annotation WithColor(Annotation existing, string newColor)
    {
        var payload = BuildPayload(GetRects(existing), GetText(existing), newColor);
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static IReadOnlyList<HighlightRect> GetRects(Annotation annotation)
    {
        if (!annotation.Payload.TryGetValue(PayloadKeyRects, out var value) || value is null)
        {
            return Array.Empty<HighlightRect>();
        }

        return value switch
        {
            IReadOnlyList<HighlightRect> typed => typed,
            IEnumerable<HighlightRect> enumerable => enumerable.ToList(),
            JsonElement element when element.ValueKind == JsonValueKind.Array =>
                element.Deserialize<List<HighlightRect>>(JsonOptions) ?? new List<HighlightRect>(),
            _ => Array.Empty<HighlightRect>()
        };
    }

    public static string GetText(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyText);
    public static string GetColor(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyColor, DefaultColor);

    private static IReadOnlyDictionary<string, object?> BuildPayload(
        IReadOnlyList<HighlightRect> rects,
        string extractedText,
        string color) =>
        new Dictionary<string, object?>
        {
            [PayloadKeyRects] = rects.ToList(),
            [PayloadKeyText] = extractedText,
            [PayloadKeyColor] = color
        };
}
