using Pagebound.Core.Domain;
using Pagebound.Core.Tests.Helpers;
using Pagebound.Infrastructure.Pdf;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

/// <summary>
/// Round-Trip-Tests für <see cref="BatchRuleStore"/> (FA-052) gegen die
/// In-Memory-Storage-Attrappe. Verifiziert ID-/Timestamp-Vergabe, Persistenz,
/// Sortierung (neueste zuerst) und Löschen.
/// </summary>
public sealed class BatchRuleStoreTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (BatchRuleStore Svc, InMemoryStorage Store) New()
    {
        var store = new InMemoryStorage();
        return (new BatchRuleStore(store), store);
    }

    [Fact]
    public async Task Save_AssignsId_AndUpdatedAt()
    {
        var (svc, _) = New();
        var rule = new BatchRule { Name = "Komprimieren + Schützen", Operation = "CompressEncrypt" };

        await svc.SaveAsync(rule, Ct);

        rule.Id.ShouldNotBeNullOrEmpty();
        rule.UpdatedAt.ShouldNotBe(default);
    }

    [Fact]
    public async Task Save_Then_List_ReturnsRule()
    {
        var (svc, _) = New();
        await svc.SaveAsync(new BatchRule { Name = "Nur Text", Operation = "ToText" }, Ct);

        var all = await svc.ListAsync(Ct);

        all.Count.ShouldBe(1);
        all[0].Name.ShouldBe("Nur Text");
        all[0].Operation.ShouldBe("ToText");
    }

    [Fact]
    public async Task List_OrdersByUpdatedAtDescending()
    {
        // UpdatedAt direkt setzen (Save würde es überschreiben) und über den Store
        // ablegen — die Liste muss die neueste Regel zuerst liefern.
        var (svc, store) = New();
        await store.SetAsync(
            "batch:rule:old",
            new BatchRule { Id = "old", Name = "Alt", Operation = "Compress", UpdatedAt = DateTimeOffset.UtcNow.AddMinutes(-5) },
            Ct);
        await store.SetAsync(
            "batch:rule:new",
            new BatchRule { Id = "new", Name = "Neu", Operation = "Encrypt", UpdatedAt = DateTimeOffset.UtcNow },
            Ct);

        var all = await svc.ListAsync(Ct);

        all.Count.ShouldBe(2);
        all[0].Id.ShouldBe("new");
    }

    [Fact]
    public async Task Delete_RemovesRule()
    {
        var (svc, _) = New();
        var rule = new BatchRule { Name = "X", Operation = "Compress" };
        await svc.SaveAsync(rule, Ct);

        await svc.DeleteAsync(rule.Id, Ct);

        (await svc.ListAsync(Ct)).ShouldBeEmpty();
    }
}
