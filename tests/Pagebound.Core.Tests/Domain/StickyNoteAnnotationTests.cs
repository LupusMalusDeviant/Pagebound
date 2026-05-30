using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class StickyNoteAnnotationTests
{
    private static readonly PdfId TestPdf = new("def456");

    [Fact]
    public void Create_SetsCorrectType()
    {
        var result = StickyNoteAnnotation.Create(TestPdf, 3, 0.5, 0.5, "My note");

        result.Type.ShouldBe(AnnotationType.StickyNote);
        result.PageNumber.ShouldBe(3);
    }

    [Fact]
    public void Create_StoresPosition()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0.25, 0.75, "content");
        var annotation = MakeAnnotation(newAnnotation);

        StickyNoteAnnotation.GetX(annotation).ShouldBe(0.25);
        StickyNoteAnnotation.GetY(annotation).ShouldBe(0.75);
    }

    [Fact]
    public void Create_StoresContent()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0, 0, "**bold** note");
        var annotation = MakeAnnotation(newAnnotation);

        StickyNoteAnnotation.GetContent(annotation).ShouldBe("**bold** note");
    }

    [Fact]
    public void Create_DefaultColor_IsAmber()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0, 0, "note");
        var annotation = MakeAnnotation(newAnnotation);

        StickyNoteAnnotation.GetColor(annotation).ShouldBe(StickyNoteAnnotation.DefaultColor);
    }

    [Fact]
    public void Create_CustomColor_IsStored()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0, 0, "note", "#ff00ff");
        var annotation = MakeAnnotation(newAnnotation);

        StickyNoteAnnotation.GetColor(annotation).ShouldBe("#ff00ff");
    }

    [Fact]
    public void WithContent_UpdatesContent()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0.1, 0.2, "original");
        var annotation = MakeAnnotation(newAnnotation);

        var updated = StickyNoteAnnotation.WithContent(annotation, "updated content");

        StickyNoteAnnotation.GetContent(updated).ShouldBe("updated content");
        StickyNoteAnnotation.GetX(updated).ShouldBe(0.1);
        StickyNoteAnnotation.GetY(updated).ShouldBe(0.2);
    }

    [Fact]
    public void WithPosition_UpdatesPosition()
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, 1, 0.1, 0.2, "note");
        var annotation = MakeAnnotation(newAnnotation);

        var updated = StickyNoteAnnotation.WithPosition(annotation, 0.8, 0.9);

        StickyNoteAnnotation.GetX(updated).ShouldBe(0.8);
        StickyNoteAnnotation.GetY(updated).ShouldBe(0.9);
        StickyNoteAnnotation.GetContent(updated).ShouldBe("note");
    }

    [Fact]
    public void GetX_MissingKey_ReturnsZero()
    {
        var annotation = new Annotation(
            new AnnotationId("test"),
            TestPdf,
            AnnotationType.StickyNote,
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            new Dictionary<string, object?>());

        StickyNoteAnnotation.GetX(annotation).ShouldBe(0);
        StickyNoteAnnotation.GetY(annotation).ShouldBe(0);
    }

    [Fact]
    public void GetContent_MissingKey_ReturnsEmpty()
    {
        var annotation = new Annotation(
            new AnnotationId("test"),
            TestPdf,
            AnnotationType.StickyNote,
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            new Dictionary<string, object?>());

        StickyNoteAnnotation.GetContent(annotation).ShouldBe(string.Empty);
    }

    private static Annotation MakeAnnotation(NewAnnotation n) =>
        new(new AnnotationId("ann-test2"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);
}
