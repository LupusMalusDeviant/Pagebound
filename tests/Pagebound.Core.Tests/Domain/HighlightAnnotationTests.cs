using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class HighlightAnnotationTests
{
    private static readonly PdfId TestPdf = new("abc123");

    [Fact]
    public void Create_WithRects_BuildsCorrectPayload()
    {
        var rects = new[] { new HighlightRect(0.1, 0.2, 0.3, 0.04) };
        var result = HighlightAnnotation.Create(TestPdf, 1, rects, "Hello world");

        result.Type.ShouldBe(AnnotationType.Highlight);
        result.PageNumber.ShouldBe(1);
        result.PdfId.ShouldBe(TestPdf);
    }

    [Fact]
    public void Create_DefaultColor_IsYellow()
    {
        var rects = new[] { new HighlightRect(0, 0, 1, 0.05) };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 1, rects, "text");

        var annotation = MakeAnnotation(newAnnotation);
        HighlightAnnotation.GetColor(annotation).ShouldBe(HighlightAnnotation.DefaultColor);
    }

    [Fact]
    public void Create_CustomColor_IsStored()
    {
        var rects = new[] { new HighlightRect(0, 0, 1, 0.05) };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 1, rects, "text", "#ff0000");

        var annotation = MakeAnnotation(newAnnotation);
        HighlightAnnotation.GetColor(annotation).ShouldBe("#ff0000");
    }

    [Fact]
    public void GetText_ReturnsExtractedText()
    {
        var rects = new[] { new HighlightRect(0, 0, 1, 0.05) };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 2, rects, "Sample text for highlight");
        var annotation = MakeAnnotation(newAnnotation);

        HighlightAnnotation.GetText(annotation).ShouldBe("Sample text for highlight");
    }

    [Fact]
    public void GetRects_ReturnsCorrectRects()
    {
        var rects = new[]
        {
            new HighlightRect(0.1, 0.2, 0.3, 0.04),
            new HighlightRect(0.0, 0.3, 0.8, 0.04)
        };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 1, rects, "text");
        var annotation = MakeAnnotation(newAnnotation);

        var result = HighlightAnnotation.GetRects(annotation);
        result.Count.ShouldBe(2);
        result[0].X.ShouldBe(0.1);
        result[1].Y.ShouldBe(0.3);
    }

    [Fact]
    public void GetRects_EmptyPayload_ReturnsEmptyList()
    {
        var annotation = new Annotation(
            new AnnotationId("test"),
            TestPdf,
            AnnotationType.Highlight,
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            new Dictionary<string, object?>());

        HighlightAnnotation.GetRects(annotation).ShouldBeEmpty();
    }

    [Fact]
    public void WithColor_ChangesColor()
    {
        var rects = new[] { new HighlightRect(0, 0, 1, 0.05) };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 1, rects, "text");
        var annotation = MakeAnnotation(newAnnotation);

        var updated = HighlightAnnotation.WithColor(annotation, "#00ff00");

        HighlightAnnotation.GetColor(updated).ShouldBe("#00ff00");
        HighlightAnnotation.GetText(updated).ShouldBe("text");
    }

    [Fact]
    public void WithColor_PreservesRects()
    {
        var rects = new[] { new HighlightRect(0.1, 0.2, 0.3, 0.04) };
        var newAnnotation = HighlightAnnotation.Create(TestPdf, 1, rects, "text");
        var annotation = MakeAnnotation(newAnnotation);

        var updated = HighlightAnnotation.WithColor(annotation, "#0000ff");
        var updatedRects = HighlightAnnotation.GetRects(updated);

        updatedRects.Count.ShouldBe(1);
        updatedRects[0].X.ShouldBe(0.1);
    }

    private static Annotation MakeAnnotation(NewAnnotation n) =>
        new(new AnnotationId("ann-test1"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);
}
