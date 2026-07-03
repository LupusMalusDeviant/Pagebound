using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class FreeTextAnnotationTests
{
    private static readonly PdfId TestPdf = new("abc789");

    [Fact]
    public void Create_SetsCorrectType()
    {
        var result = FreeTextAnnotation.Create(TestPdf, 2, 0.5, 0.5, "Hello");

        result.Type.ShouldBe(AnnotationType.FreeText);
        result.PageNumber.ShouldBe(2);
    }

    [Fact]
    public void Create_StoresPositionAndText()
    {
        var newAnnotation = FreeTextAnnotation.Create(TestPdf, 1, 0.25, 0.75, "03.07.2026");
        var annotation = MakeAnnotation(newAnnotation);

        FreeTextAnnotation.GetX(annotation).ShouldBe(0.25);
        FreeTextAnnotation.GetY(annotation).ShouldBe(0.75);
        FreeTextAnnotation.GetText(annotation).ShouldBe("03.07.2026");
    }

    [Fact]
    public void Create_Defaults_AreApplied()
    {
        var newAnnotation = FreeTextAnnotation.Create(TestPdf, 1, 0, 0, "x");
        var annotation = MakeAnnotation(newAnnotation);

        FreeTextAnnotation.GetFontSize(annotation).ShouldBe(FreeTextAnnotation.DefaultFontSize);
        FreeTextAnnotation.GetColor(annotation).ShouldBe(FreeTextAnnotation.DefaultColor);
    }

    [Fact]
    public void Create_CustomStyle_IsStored()
    {
        var newAnnotation = FreeTextAnnotation.Create(TestPdf, 1, 0, 0, "x", 0.03, "#dc2626");
        var annotation = MakeAnnotation(newAnnotation);

        FreeTextAnnotation.GetFontSize(annotation).ShouldBe(0.03);
        FreeTextAnnotation.GetColor(annotation).ShouldBe("#dc2626");
    }

    [Fact]
    public void WithText_UpdatesTextKeepsRest()
    {
        var annotation = MakeAnnotation(FreeTextAnnotation.Create(TestPdf, 1, 0.1, 0.2, "old", 0.03, "#2563eb"));

        var updated = FreeTextAnnotation.WithText(annotation, "new");

        FreeTextAnnotation.GetText(updated).ShouldBe("new");
        FreeTextAnnotation.GetX(updated).ShouldBe(0.1);
        FreeTextAnnotation.GetY(updated).ShouldBe(0.2);
        FreeTextAnnotation.GetFontSize(updated).ShouldBe(0.03);
        FreeTextAnnotation.GetColor(updated).ShouldBe("#2563eb");
    }

    [Fact]
    public void WithPosition_UpdatesPositionKeepsText()
    {
        var annotation = MakeAnnotation(FreeTextAnnotation.Create(TestPdf, 1, 0.1, 0.2, "text"));

        var updated = FreeTextAnnotation.WithPosition(annotation, 0.8, 0.9);

        FreeTextAnnotation.GetX(updated).ShouldBe(0.8);
        FreeTextAnnotation.GetY(updated).ShouldBe(0.9);
        FreeTextAnnotation.GetText(updated).ShouldBe("text");
    }

    [Fact]
    public void WithStyle_UpdatesFontSizeAndColor()
    {
        var annotation = MakeAnnotation(FreeTextAnnotation.Create(TestPdf, 1, 0.1, 0.2, "text"));

        var updated = FreeTextAnnotation.WithStyle(annotation, 0.015, "#dc2626");

        FreeTextAnnotation.GetFontSize(updated).ShouldBe(0.015);
        FreeTextAnnotation.GetColor(updated).ShouldBe("#dc2626");
        FreeTextAnnotation.GetText(updated).ShouldBe("text");
    }

    [Fact]
    public void WithTextAndStyle_UpdatesTextFontSizeAndColorKeepsPosition()
    {
        var annotation = MakeAnnotation(FreeTextAnnotation.Create(TestPdf, 1, 0.1, 0.2, "old", 0.02, "#000000"));

        var updated = FreeTextAnnotation.WithTextAndStyle(annotation, "new", 0.03, "#dc2626");

        FreeTextAnnotation.GetText(updated).ShouldBe("new");
        FreeTextAnnotation.GetFontSize(updated).ShouldBe(0.03);
        FreeTextAnnotation.GetColor(updated).ShouldBe("#dc2626");
        FreeTextAnnotation.GetX(updated).ShouldBe(0.1);
        FreeTextAnnotation.GetY(updated).ShouldBe(0.2);
    }

    [Fact]
    public void GetFontSize_MissingOrZero_ReturnsDefault()
    {
        var annotation = new Annotation(
            new AnnotationId("test"),
            TestPdf,
            AnnotationType.FreeText,
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            new Dictionary<string, object?>());

        FreeTextAnnotation.GetFontSize(annotation).ShouldBe(FreeTextAnnotation.DefaultFontSize);
    }

    [Fact]
    public void GetText_MissingKey_ReturnsEmpty()
    {
        var annotation = new Annotation(
            new AnnotationId("test"),
            TestPdf,
            AnnotationType.FreeText,
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            new Dictionary<string, object?>());

        FreeTextAnnotation.GetText(annotation).ShouldBe(string.Empty);
    }

    private static Annotation MakeAnnotation(NewAnnotation n) =>
        new(new AnnotationId("ann-test3"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);
}
