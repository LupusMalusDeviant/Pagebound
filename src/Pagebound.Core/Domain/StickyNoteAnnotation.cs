using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Hilfsklasse für Sticky-Note-Annotationen (FA-011).
/// Solange Annotation noch über das generische Payload-Dictionary persistiert
/// wird, kapselt dieser Helper die Payload-Struktur (Schlüssel,
/// JsonElement→Wert-Konvertierung) an einer Stelle. Sobald wir mehr
/// Annotation-Typen haben, wird Annotation auf polymorphe Records refactoriert
/// (siehe ADR-001 — austauschbar bleibt das Interface, nicht die Payload-Form).
/// </summary>
public static class StickyNoteAnnotation
{
    public const string PayloadKeyX = "x";
    public const string PayloadKeyY = "y";
    public const string PayloadKeyContent = "contentMarkdown";
    public const string PayloadKeyColor = "color";

    /// <summary>Default-Farbe (Tailwind amber-200).</summary>
    public const string DefaultColor = "#fde68a";

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        double x,
        double y,
        string contentMarkdown,
        string? color = null) =>
        new(
            pdfId,
            AnnotationType.StickyNote,
            pageNumber,
            BuildPayload(x, y, contentMarkdown, color ?? DefaultColor));

    public static Annotation WithContent(Annotation existing, string newContent)
    {
        var payload = BuildPayload(GetX(existing), GetY(existing), newContent, GetColor(existing));
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static Annotation WithPosition(Annotation existing, double x, double y)
    {
        var payload = BuildPayload(x, y, GetContent(existing), GetColor(existing));
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static double GetX(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyX);
    public static double GetY(Annotation annotation) => AnnotationPayload.GetDouble(annotation.Payload, PayloadKeyY);
    public static string GetContent(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyContent);
    public static string GetColor(Annotation annotation) => AnnotationPayload.GetString(annotation.Payload, PayloadKeyColor, DefaultColor);

    private static IReadOnlyDictionary<string, object?> BuildPayload(
        double x,
        double y,
        string content,
        string color) =>
        new Dictionary<string, object?>
        {
            [PayloadKeyX] = x,
            [PayloadKeyY] = y,
            [PayloadKeyContent] = content,
            [PayloadKeyColor] = color
        };
}
