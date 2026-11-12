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

        await svc.DeleteAsync(Pdf, ann.Id, Ct);

        (await svc.GetForDocumentAsync(Pdf, Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Delete_UnknownId_NoThrow()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        await svc.CreateAsync(NewAnn(), Ct);

        await Should.NotThrowAsync(() => svc.DeleteAsync(Pdf, new AnnotationId("nope"), Ct));
    }

    // -------------------------------------------------------------------------
    // Codex-Runde 3, Befund 1: seit ImportAsync die Id aus dem /NM-Feld der PDF
    // übernimmt, sind Ids NICHT mehr dokumentübergreifend eindeutig. Dieser
    // Test scheitert an der alten Fassung (Suche über alle geladenen Puffer) —
    // genau der Fehler, den er finden soll.
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Delete_SameIdInTwoDocuments_RemovesOnlyTheNamedOne()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        var a = new PdfId("pdf-a");
        var b = new PdfId("pdf-b");

        // Beide PDFs bringen eine Annotation namens „note1" mit — ein völlig
        // gewöhnlicher /NM-Wert.
        var kollision = new AnnotationId("note1");
        static Annotation Mit(AnnotationId id, PdfId pdf) =>
            new(id, pdf, AnnotationType.StickyNote, 1,
                DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch,
                new Dictionary<string, object?> { ["content"] = pdf.Value });

        await svc.ImportAsync(Mit(kollision, a), Ct);
        await svc.ImportAsync(Mit(kollision, b), Ct);

        await svc.DeleteAsync(b, kollision, Ct);

        (await svc.GetForDocumentAsync(b, Ct)).ShouldBeEmpty();
        var uebrig = await svc.GetForDocumentAsync(a, Ct);
        uebrig.Count.ShouldBe(1);
        uebrig[0].Payload["content"].ShouldBe("pdf-a");
    }

    [Fact]
    public async Task GetForDocument_EmptyForUnknownPdf()
    {
        var svc = new AnnotationService(new InMemoryStorage());

        (await svc.GetForDocumentAsync(new PdfId("other"), Ct)).ShouldBeEmpty();
    }

    // =========================================================================
    // Import: Identität und Zeitpunkt kommen MIT (Codex-Runde 2, Befund 3).
    //
    // Warum das geprüft wird: vorgefundene /Annots bringen /NM und /M mit.
    // Lief der Import über CreateAsync, bekam die Annotation eine neue Id —
    // und beim nächsten Speichern fand der Ersetzen-Schritt das Original in
    // der Datei nicht mehr, so dass beide Fassungen darin standen. Die
    // JS-Prüfungen zum Ersetzen laufen an diesem .NET-Weg vorbei und können
    // den Fehler strukturell nicht sehen.
    // =========================================================================

    private static Annotation Fremd(string id, DateTimeOffset when, string text = "aus der Datei") =>
        new(new AnnotationId(id), Pdf, AnnotationType.StickyNote, 1, when, when,
            new Dictionary<string, object?> { ["content"] = text });

    [Fact]
    public async Task Import_BehaeltMitgebrachteIdUndZeitpunkt()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        var when = new DateTimeOffset(2026, 11, 12, 8, 0, 0, TimeSpan.Zero);

        var ann = await svc.ImportAsync(Fremd("ann-ausDerDatei", when), Ct);

        ann.Id.Value.ShouldBe("ann-ausDerDatei");
        ann.UpdatedAt.ShouldBe(when);
        ann.CreatedAt.ShouldBe(when);

        var list = await svc.GetForDocumentAsync(Pdf, Ct);
        list.Count.ShouldBe(1);
        list[0].Id.Value.ShouldBe("ann-ausDerDatei");
        list[0].UpdatedAt.ShouldBe(when);
    }

    [Fact]
    public async Task Import_ZweimalDieselbeDatei_VerdoppeltNichts()
    {
        var svc = new AnnotationService(new InMemoryStorage());
        var when = new DateTimeOffset(2026, 11, 12, 8, 0, 0, TimeSpan.Zero);

        await svc.ImportAsync(Fremd("ann-gleich", when, "erste Lesung"), Ct);
        await svc.ImportAsync(Fremd("ann-gleich", when, "zweite Lesung"), Ct);

        var list = await svc.GetForDocumentAsync(Pdf, Ct);
        list.Count.ShouldBe(1);
        list[0].Payload["content"].ShouldBe("zweite Lesung");
    }

    [Fact]
    public async Task Import_UeberlebtDenDienstwechsel()
    {
        var store = new InMemoryStorage();
        var when = new DateTimeOffset(2026, 11, 12, 8, 0, 0, TimeSpan.Zero);
        await new AnnotationService(store).ImportAsync(Fremd("ann-bleibt", when), Ct);

        var list = await new AnnotationService(store).GetForDocumentAsync(Pdf, Ct);
        list.Count.ShouldBe(1);
        list[0].Id.Value.ShouldBe("ann-bleibt");
        list[0].UpdatedAt.ShouldBe(when);
    }

    [Fact]
    public async Task Create_VergibtWeiterhin_EineNeueId()
    {
        // Die Gegenprobe: ImportAsync ist der Sonderweg, CreateAsync bleibt,
        // wie es war. Ohne diese Prüfung könnte man den Unterschied
        // versehentlich einebnen.
        var svc = new AnnotationService(new InMemoryStorage());
        var vorher = DateTimeOffset.UtcNow.AddSeconds(-1);

        var ann = await svc.CreateAsync(NewAnn(), Ct);

        ann.Id.Value.ShouldStartWith("ann-");
        ann.UpdatedAt.ShouldBeGreaterThan(vorher);
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
