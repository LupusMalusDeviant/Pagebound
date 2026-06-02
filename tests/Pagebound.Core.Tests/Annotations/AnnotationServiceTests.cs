using Pagebound.Core.Domain;
using Pagebound.Core.Tests.Helpers;
using Pagebound.Infrastructure.Annotations;
using Shouldly;

namespace Pagebound.Core.Tests.Annotations;

public sealed class AnnotationServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly PdfId Pdf = new("pdf-1");

    private static NewAnnotation NewAnn(int page = 1) =>
        new(Pdf, AnnotationType.StickyNote, page,
            new Dictionary<string, object?> { ["content"] = "hi" });

    [Fact]
    public async Task Create_AssignsId_AndPersists()
    {
        var svc = new AnnotationService(new InMemoryStorage());

        var ann = await svc.CreateAsync(NewAnn(), Ct);

        ann.Id.Value.ShouldNotBeNullOrEmpty();
        ann.PdfId.ShouldBe(Pdf);

        var list = await svc.GetForDocumentAsync(Pdf, Ct);
        list.Count.ShouldBe(1);
        list[0].Id.Value.ShouldBe(ann.Id.Value);
    }

    [Fact]
    public async Task Create_PersistsAcrossInstances()
    {
        var store = new InMemoryStorage();
        await new AnnotationService(store).CreateAsync(NewAnn(), Ct);

        var svc2 = new AnnotationService(store);
        (await svc2.GetForDocumentAsync(Pdf, Ct)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Update_ChangesPayload_AndBumpsUpdatedAt()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        var ann = await svc.CreateAsync(NewAnn(), Ct);

        var edited = ann with { Payload = new Dictionary<string, object?> { ["content"] = "edited" } };
        var updated = await svc.UpdateAsync(edited, Ct);

        updated.Payload["content"].ShouldBe("edited");
        updated.UpdatedAt.ShouldBeGreaterThanOrEqualTo(ann.UpdatedAt);

        var reloaded = (await svc.GetForDocumentAsync(Pdf, Ct))[0];
        reloaded.Payload["content"].ShouldBe("edited");
    }

    [Fact]
    public async Task Update_UnknownId_Throws()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        await svc.CreateAsync(NewAnn(), Ct); // Bucket laden

        var ghost = new Annotation(new AnnotationId("ghost"), Pdf, AnnotationType.StickyNote, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, new Dictionary<string, object?>());

        await Should.ThrowAsync<InvalidOperationException>(() => svc.UpdateAsync(ghost, Ct));
    }

    [Fact]
    public async Task Delete_RemovesAnnotation()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        var ann = await svc.CreateAsync(NewAnn(), Ct);

        await svc.DeleteAsync(ann.Id, Ct);

        (await svc.GetForDocumentAsync(Pdf, Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Delete_UnknownId_NoThrow()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        await svc.CreateAsync(NewAnn(), Ct);

        await Should.NotThrowAsync(() => svc.DeleteAsync(new AnnotationId("nope"), Ct));
    }

    [Fact]
    public async Task GetForDocument_EmptyForUnknownPdf()
    {
        var svc = new AnnotationService(new InMemoryStorage());

        (await svc.GetForDocumentAsync(new PdfId("other"), Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task ObserveChanges_YieldsNothing()
    {
        var svc = new AnnotationService(new InMemoryStorage());

        var count = 0;
        await foreach (var _ in svc.ObserveChanges(Pdf)) count++;

        count.ShouldBe(0);
    }
}
