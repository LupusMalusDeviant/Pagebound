using Pagebound.Core.Domain;
using Pagebound.Core.Tests.Helpers;
using Pagebound.Infrastructure.Library;
using Shouldly;

namespace Pagebound.Core.Tests.Library;

public sealed class LibraryServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static LibraryEntry Entry(
        string id, string title, string[]? tags = null, DateTimeOffset? added = null,
        DateTimeOffset? lastOpened = null, string? hash = null, string? author = null) =>
        new(new LibraryEntryId(id), $"/pdfs/{id}.pdf", title, author,
            tags ?? Array.Empty<string>(), null,
            added ?? DateTimeOffset.UtcNow, lastOpened, null,
            hash is null ? null : new PdfMeta($"{id}.pdf", hash, 1234, 10));

    private static (LibraryService Svc, InMemoryStorage Store) New()
    {
        var store = new InMemoryStorage();
        return (new LibraryService(store), store);
    }

    [Fact]
    public async Task AddOrUpdate_NewEntry_IsRetrievable()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "Doc A"), Ct);

        (await svc.GetAsync(new LibraryEntryId("a"), Ct))!.Title.ShouldBe("Doc A");
    }

    [Fact]
    public async Task AddOrUpdate_SameId_Merges_KeepsAddedAt_UpdatesTitle()
    {
        var (svc, _) = New();
        var added = DateTimeOffset.UtcNow.AddDays(-5);
        await svc.AddOrUpdateAsync(Entry("a", "Old", added: added), Ct);
        await svc.AddOrUpdateAsync(Entry("a", "New", added: DateTimeOffset.UtcNow), Ct);

        var got = await svc.GetAsync(new LibraryEntryId("a"), Ct);
        got!.Title.ShouldBe("New");
        got.AddedAt.ShouldBe(added);
    }

    [Fact]
    public async Task AddOrUpdate_SameHashDifferentId_MergesOntoExisting()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "Doc", hash: "HASH1"), Ct);
        await svc.AddOrUpdateAsync(Entry("b", "Doc Renamed", hash: "HASH1"), Ct);

        var all = await svc.QueryAsync(new LibraryQuery(), Ct);
        all.Count.ShouldBe(1);
        all[0].Id.Value.ShouldBe("a");
        all[0].Title.ShouldBe("Doc Renamed");
    }

    [Fact]
    public async Task Query_FullText_MatchesTitleAuthorTag()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "Annual Report", author: "Acme"), Ct);
        await svc.AddOrUpdateAsync(Entry("b", "Recipes", tags: new[] { "cooking" }), Ct);

        (await svc.QueryAsync(new LibraryQuery(FullTextSearch: "report"), Ct)).Count.ShouldBe(1);
        (await svc.QueryAsync(new LibraryQuery(FullTextSearch: "acme"), Ct)).Count.ShouldBe(1);
        (await svc.QueryAsync(new LibraryQuery(FullTextSearch: "cooking"), Ct)).Count.ShouldBe(1);
        (await svc.QueryAsync(new LibraryQuery(FullTextSearch: "zzz"), Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Query_TagFilter_CaseInsensitive()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "A", tags: new[] { "work", "tax" }), Ct);
        await svc.AddOrUpdateAsync(Entry("b", "B", tags: new[] { "fun" }), Ct);

        var r = await svc.QueryAsync(new LibraryQuery(Tags: new[] { "TAX" }), Ct);
        r.Count.ShouldBe(1);
        r[0].Id.Value.ShouldBe("a");
    }

    [Fact]
    public async Task Query_SortsAndPaginates()
    {
        var (svc, _) = New();
        var t0 = DateTimeOffset.UtcNow;
        await svc.AddOrUpdateAsync(Entry("a", "Charlie", added: t0.AddMinutes(1)), Ct);
        await svc.AddOrUpdateAsync(Entry("b", "alpha", added: t0.AddMinutes(2)), Ct);
        await svc.AddOrUpdateAsync(Entry("c", "Bravo", added: t0.AddMinutes(3)), Ct);

        var titleAsc = await svc.QueryAsync(new LibraryQuery(Sort: LibrarySort.TitleAsc), Ct);
        titleAsc.Select(e => e.Title).ShouldBe(new[] { "alpha", "Bravo", "Charlie" });

        var addedDesc = await svc.QueryAsync(new LibraryQuery(Sort: LibrarySort.AddedDesc), Ct);
        addedDesc[0].Id.Value.ShouldBe("c");

        var page = await svc.QueryAsync(new LibraryQuery(Sort: LibrarySort.TitleAsc, Skip: 1, Take: 1), Ct);
        page.Count.ShouldBe(1);
        page[0].Title.ShouldBe("Bravo");
    }

    [Fact]
    public async Task GetAllTags_DistinctSortedCaseInsensitive()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "A", tags: new[] { "Zeta", "alpha" }), Ct);
        await svc.AddOrUpdateAsync(Entry("b", "B", tags: new[] { "ALPHA", "mid" }), Ct);

        var tags = await svc.GetAllTagsAsync(Ct);
        tags.Count.ShouldBe(3);
        tags[0].ShouldBe("alpha");
        tags[^1].ShouldBe("Zeta");
    }

    [Fact]
    public async Task FindByHash_ReturnsMatch_OrNull()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "A", hash: "DEADBEEF"), Ct);

        (await svc.FindByHashAsync("deadbeef", Ct))!.Id.Value.ShouldBe("a");
        (await svc.FindByHashAsync("nope", Ct)).ShouldBeNull();
        (await svc.FindByHashAsync("", Ct)).ShouldBeNull();
    }

    [Fact]
    public async Task TouchLastOpened_SetsTimestamp()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "A"), Ct);

        await svc.TouchLastOpenedAsync(new LibraryEntryId("a"), Ct);

        (await svc.GetAsync(new LibraryEntryId("a"), Ct))!.LastOpenedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task TouchLastOpened_UnknownId_NoThrow()
    {
        var (svc, _) = New();
        await Should.NotThrowAsync(() => svc.TouchLastOpenedAsync(new LibraryEntryId("ghost"), Ct));
    }

    [Fact]
    public async Task Remove_DeletesEntry()
    {
        var (svc, _) = New();
        await svc.AddOrUpdateAsync(Entry("a", "A"), Ct);

        await svc.RemoveAsync(new LibraryEntryId("a"), Ct);

        (await svc.GetAsync(new LibraryEntryId("a"), Ct)).ShouldBeNull();
        (await svc.QueryAsync(new LibraryQuery(), Ct)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Index_PersistsAcrossServiceInstances()
    {
        var store = new InMemoryStorage();
        await new LibraryService(store).AddOrUpdateAsync(Entry("a", "Persisted"), Ct);

        var svc2 = new LibraryService(store);
        (await svc2.QueryAsync(new LibraryQuery(), Ct)).Count.ShouldBe(1);
    }
}
