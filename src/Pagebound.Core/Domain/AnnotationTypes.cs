namespace Pagebound.Core.Domain;

public readonly record struct AnnotationId(string Value)
{
    public static AnnotationId NewId() => new("ann-" + Guid.NewGuid().ToString("N")[..8]);
    public override string ToString() => Value;
}

public readonly record struct PdfId(string Value)
{
    public static PdfId FromHash(string sha256Hash) => new(sha256Hash);
    public override string ToString() => Value;
}

public enum AnnotationType
{
    Highlight,
    StickyNote,
    Ink,
    Shape,
    Signature,
    FreeText
}

public sealed record Rectangle(double X, double Y, double Width, double Height);

public sealed record Annotation(
    AnnotationId Id,
    PdfId PdfId,
    AnnotationType Type,
    int PageNumber,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyDictionary<string, object?> Payload);

public sealed record NewAnnotation(
    PdfId PdfId,
    AnnotationType Type,
    int PageNumber,
    IReadOnlyDictionary<string, object?> Payload);

public sealed record AnnotationChange(
    AnnotationId Id,
    AnnotationChangeKind Kind,
    Annotation? After);

public enum AnnotationChangeKind { Created, Updated, Deleted }
