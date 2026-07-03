using System.Text;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Sidecars;
using Shouldly;

namespace Pagebound.Core.Tests.Sidecars;

public sealed class JsonSidecarServiceTests
{
    private readonly JsonSidecarService _sut = new();
    private static readonly PdfMeta TestMeta = new("doc.pdf", "hash123", 1234, 3);

    private static Annotation Ann(string id, AnnotationType type) =>
        new(new AnnotationId(id), new PdfId("hash123"), type, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, new Dictionary<string, object?>());

    private static Sidecar SidecarWith(params Annotation[] annotations) =>
        new(
            SchemaVersion: Sidecar.CurrentSchemaVersion,
            CreatedBy: "Test",
            CreatedAt: DateTimeOffset.UtcNow,
            UpdatedAt: DateTimeOffset.UtcNow,
            PdfMeta: TestMeta,
            LibraryEntry: new LibraryEntry(
                Id: LibraryEntryId.NewId(),
                PdfPath: string.Empty,
                Title: "doc",
                Author: null,
                Tags: Array.Empty<string>(),
                Rating: null,
                AddedAt: DateTimeOffset.UtcNow,
                LastOpenedAt: null,
                Progress: null,
                PdfMeta: TestMeta),
            Annotations: annotations,
            Integrity: null);

    private async Task<SidecarParseResult> RoundTripAsync(Sidecar sidecar)
    {
        var json = await _sut.SerializeAsync(sidecar, default);
        await using var ms = new MemoryStream(Encoding.UTF8.GetBytes(json));
        return await _sut.ParseAsync(ms, default);
    }

    [Fact]
    public async Task ParseAsync_UnknownAnnotationType_PreservedAndReported()
    {
        // Künstlicher, in dieser App-Version unbekannter Typ-Ordinal (99).
        var sidecar = SidecarWith(
            Ann("a1", AnnotationType.Highlight),
            Ann("a2", (AnnotationType)99),
            Ann("a3", AnnotationType.FreeText));

        var result = await RoundTripAsync(sidecar);

        result.Sidecar.ShouldNotBeNull();
        result.Sidecar!.Annotations.Count.ShouldBe(3);   // NICHT verworfen
        result.UnknownAnnotationCount.ShouldBe(1);        // gemeldet
        result.HasUnknownAnnotations.ShouldBeTrue();
        // Der unbekannte Ordinal-Wert überlebt den Round-Trip (Ordinal-Serialisierung).
        result.Sidecar.Annotations.ShouldContain(a => (int)a.Type == 99);
    }

    [Fact]
    public async Task ParseAsync_AllKnownTypes_NoUnknownReported()
    {
        var sidecar = SidecarWith(
            Ann("a1", AnnotationType.Highlight),
            Ann("a2", AnnotationType.StickyNote));

        var result = await RoundTripAsync(sidecar);

        result.Sidecar.ShouldNotBeNull();
        result.UnknownAnnotationCount.ShouldBe(0);
        result.HasUnknownAnnotations.ShouldBeFalse();
    }

    [Fact]
    public async Task ParseAsync_InvalidJson_ReturnsInvalidResult()
    {
        await using var ms = new MemoryStream(Encoding.UTF8.GetBytes("{ not valid json"));

        var result = await _sut.ParseAsync(ms, default);

        result.Sidecar.ShouldBeNull();
        result.UnknownAnnotationCount.ShouldBe(0);
    }
}
