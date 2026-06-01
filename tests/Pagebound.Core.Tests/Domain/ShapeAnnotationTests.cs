using System.Text.Json;
using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class ShapeAnnotationTests
{
    private static readonly PdfId TestPdf = new("shape123");

    [Fact]
    public void Create_SetsTypeAndPage()
    {
        var n = ShapeAnnotation.Create(TestPdf, 2, ShapeKind.Arrow, 0.1, 0.2, 0.3, 0.4);

        n.Type.ShouldBe(AnnotationType.Shape);
        n.PageNumber.ShouldBe(2);
    }

    [Fact]
    public void Create_RoundTripsAllFields()
    {
        var ann = Make(ShapeAnnotation.Create(TestPdf, 1, ShapeKind.Line, 0.1, 0.2, 0.7, 0.8, "#00ff00", 0.01));

        ShapeAnnotation.GetShape(ann).ShouldBe(ShapeKind.Line);
        ShapeAnnotation.GetColor(ann).ShouldBe("#00ff00");
        ShapeAnnotation.GetStrokeWidth(ann).ShouldBe(0.01);
        ShapeAnnotation.GetStartX(ann).ShouldBe(0.1);
        ShapeAnnotation.GetStartY(ann).ShouldBe(0.2);
        ShapeAnnotation.GetEndX(ann).ShouldBe(0.7);
        ShapeAnnotation.GetEndY(ann).ShouldBe(0.8);
    }

    [Theory]
    [InlineData(ShapeKind.Rectangle)]
    [InlineData(ShapeKind.Arrow)]
    [InlineData(ShapeKind.Line)]
    public void GetShape_RoundTripsEachKind(ShapeKind kind)
    {
        var ann = Make(ShapeAnnotation.Create(TestPdf, 1, kind, 0, 0, 1, 1));

        ShapeAnnotation.GetShape(ann).ShouldBe(kind);
    }

    [Fact]
    public void Create_DefaultColorAndWidth()
    {
        var ann = Make(ShapeAnnotation.Create(TestPdf, 1, ShapeKind.Rectangle, 0, 0, 1, 1));

        ShapeAnnotation.GetColor(ann).ShouldBe(ShapeAnnotation.DefaultColor);
        ShapeAnnotation.GetStrokeWidth(ann).ShouldBe(ShapeAnnotation.DefaultStrokeWidth);
    }

    [Theory]
    [InlineData("rect", ShapeKind.Rectangle)]
    [InlineData("RECTANGLE", ShapeKind.Rectangle)]
    [InlineData("arrow", ShapeKind.Arrow)]
    [InlineData("line", ShapeKind.Line)]
    [InlineData("wobble", ShapeKind.Rectangle)] // Unbekannt -> Rechteck
    public void GetShape_ParsesRawString(string raw, ShapeKind expected)
    {
        var ann = WithPayload(new Dictionary<string, object?> { ["shape"] = raw });

        ShapeAnnotation.GetShape(ann).ShouldBe(expected);
    }

    [Fact]
    public void GetShape_FromJsonElement()
    {
        var ann = WithPayload(new Dictionary<string, object?>
        {
            ["shape"] = JsonSerializer.SerializeToElement("arrow")
        });

        ShapeAnnotation.GetShape(ann).ShouldBe(ShapeKind.Arrow);
    }

    [Fact]
    public void GetShape_MissingKey_DefaultsToRectangle()
    {
        ShapeAnnotation.GetShape(WithPayload(new Dictionary<string, object?>()))
            .ShouldBe(ShapeKind.Rectangle);
    }

    [Fact]
    public void GetDouble_MissingKeys_ReturnZero()
    {
        var ann = WithPayload(new Dictionary<string, object?>());

        ShapeAnnotation.GetStartX(ann).ShouldBe(0);
        ShapeAnnotation.GetStartY(ann).ShouldBe(0);
        ShapeAnnotation.GetEndX(ann).ShouldBe(0);
        ShapeAnnotation.GetEndY(ann).ShouldBe(0);
    }

    [Fact]
    public void GetDouble_CoercesNumericTypes()
    {
        var ann = WithPayload(new Dictionary<string, object?>
        {
            ["startX"] = 1,                                       // int
            ["startY"] = 2L,                                      // long
            ["endX"] = 3.5f,                                      // float
            ["endY"] = JsonSerializer.SerializeToElement(0.42)    // JsonElement number
        });

        ShapeAnnotation.GetStartX(ann).ShouldBe(1);
        ShapeAnnotation.GetStartY(ann).ShouldBe(2);
        ShapeAnnotation.GetEndX(ann).ShouldBe(3.5, 0.0001);
        ShapeAnnotation.GetEndY(ann).ShouldBe(0.42);
    }

    private static Annotation Make(NewAnnotation n) =>
        new(new AnnotationId("shape-ann"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);

    private static Annotation WithPayload(IReadOnlyDictionary<string, object?> payload) =>
        new(new AnnotationId("shape-x"), TestPdf, AnnotationType.Shape, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, payload);
}
