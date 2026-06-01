using System.Text.Json;
using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class InkAnnotationTests
{
    private static readonly PdfId TestPdf = new("ink123");

    private static readonly IReadOnlyList<InkStroke> Sample = new List<InkStroke>
    {
        new(new List<InkPoint> { new(0.1, 0.2), new(0.3, 0.4) }),
        new(new List<InkPoint> { new(0.5, 0.6) })
    };

    private static readonly JsonSerializerOptions Camel =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [Fact]
    public void Create_SetsTypePageAndPdf()
    {
        var n = InkAnnotation.Create(TestPdf, 4, Sample);

        n.Type.ShouldBe(AnnotationType.Ink);
        n.PageNumber.ShouldBe(4);
        n.PdfId.ShouldBe(TestPdf);
    }

    [Fact]
    public void Create_RoundTripsStrokes()
    {
        var ann = Make(InkAnnotation.Create(TestPdf, 1, Sample));

        var strokes = InkAnnotation.GetStrokes(ann);

        strokes.Count.ShouldBe(2);
        strokes[0].Points.Count.ShouldBe(2);
        strokes[0].Points[0].X.ShouldBe(0.1);
        strokes[0].Points[1].Y.ShouldBe(0.4);
        strokes[1].Points.Count.ShouldBe(1);
    }

    [Fact]
    public void Create_DefaultColorAndWidth()
    {
        var ann = Make(InkAnnotation.Create(TestPdf, 1, Sample));

        InkAnnotation.GetColor(ann).ShouldBe(InkAnnotation.DefaultColor);
        InkAnnotation.GetStrokeWidth(ann).ShouldBe(InkAnnotation.DefaultStrokeWidth);
    }

    [Fact]
    public void Create_CustomColorAndWidth()
    {
        var ann = Make(InkAnnotation.Create(TestPdf, 1, Sample, "#ff0000", 0.02));

        InkAnnotation.GetColor(ann).ShouldBe("#ff0000");
        InkAnnotation.GetStrokeWidth(ann).ShouldBe(0.02);
    }

    [Fact]
    public void GetStrokes_MissingKey_ReturnsEmpty()
    {
        InkAnnotation.GetStrokes(Empty()).ShouldBeEmpty();
    }

    [Fact]
    public void GetStrokes_FromJsonElement_Deserializes()
    {
        // Simuliert eine aus JSON (Sidecar/IndexedDB) deserialisierte Payload.
        var element = JsonSerializer.SerializeToElement(Sample, Camel);
        var ann = WithPayload(new Dictionary<string, object?> { ["strokes"] = element });

        var strokes = InkAnnotation.GetStrokes(ann);

        strokes.Count.ShouldBe(2);
        strokes[0].Points[0].X.ShouldBe(0.1);
        strokes[1].Points[0].Y.ShouldBe(0.6);
    }

    [Fact]
    public void GetColor_FromJsonElement()
    {
        var ann = WithPayload(new Dictionary<string, object?>
        {
            ["color"] = JsonSerializer.SerializeToElement("#abcdef")
        });

        InkAnnotation.GetColor(ann).ShouldBe("#abcdef");
    }

    [Fact]
    public void GetStrokeWidth_CoercesIntAndJsonElement()
    {
        InkAnnotation.GetStrokeWidth(
            WithPayload(new Dictionary<string, object?> { ["strokeWidth"] = 2 })).ShouldBe(2.0);

        InkAnnotation.GetStrokeWidth(
            WithPayload(new Dictionary<string, object?>
            {
                ["strokeWidth"] = JsonSerializer.SerializeToElement(0.015)
            })).ShouldBe(0.015);
    }

    [Fact]
    public void Getters_MissingKeys_ReturnDefaults()
    {
        InkAnnotation.GetColor(Empty()).ShouldBe(InkAnnotation.DefaultColor);
        InkAnnotation.GetStrokeWidth(Empty()).ShouldBe(InkAnnotation.DefaultStrokeWidth);
    }

    private static Annotation Make(NewAnnotation n) =>
        new(new AnnotationId("ink-ann"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);

    private static Annotation Empty() => WithPayload(new Dictionary<string, object?>());

    private static Annotation WithPayload(IReadOnlyDictionary<string, object?> payload) =>
        new(new AnnotationId("ink-x"), TestPdf, AnnotationType.Ink, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, payload);
}
