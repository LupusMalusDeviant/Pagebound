using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class EditorDocumentSnapshotTests
{
    private static EditorDocument SampleDoc()
    {
        var doc = EditorDocument.NewEmpty("Test", PageLayout.DinLong);
        doc.Theme = EditorThemes.Presets[0].Clone();
        doc.Pages[0].Background = "#fff8e1";
        doc.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Heading, Text = "H", Level = 1 });
        doc.Pages[0].Blocks.Add(new EditorBlock
        {
            Type = EditorBlockType.Table,
            Rows = new List<List<string>> { new() { "a", "b" }, new() { "c", "d" } }
        });
        return doc;
    }

    [Fact]
    public void Snapshot_PreservesIds_UnlikeClone()
    {
        var doc = SampleDoc();
        var snap = doc.Snapshot();

        snap.Id.ShouldBe(doc.Id);
        snap.Pages[0].Id.ShouldBe(doc.Pages[0].Id);
        snap.Pages[0].Blocks[0].Id.ShouldBe(doc.Pages[0].Blocks[0].Id);

        var duplicate = doc.Pages[0].Blocks[0].Clone();
        duplicate.Id.ShouldNotBe(doc.Pages[0].Blocks[0].Id);
    }

    [Fact]
    public void Snapshot_IsDeep_MutationsDoNotLeak()
    {
        var doc = SampleDoc();
        var snap = doc.Snapshot();

        doc.Pages[0].Blocks[0].Text = "geändert";
        doc.Pages[0].Blocks[1].Rows![0][0] = "geändert";
        doc.Pages[0].Background = "#000000";
        doc.Theme!.AccentColor = "#000000";
        doc.Pages.Add(new EditorPage());

        snap.Pages.Count.ShouldBe(1);
        snap.Pages[0].Blocks[0].Text.ShouldBe("H");
        snap.Pages[0].Blocks[1].Rows![0][0].ShouldBe("a");
        snap.Pages[0].Background.ShouldBe("#fff8e1");
        snap.Theme!.AccentColor.ShouldNotBe("#000000");
    }

    [Fact]
    public void NewLayouts_HaveSensibleDimensions()
    {
        var dl = EditorLayouts.For(PageLayout.DinLong);
        dl.WidthMm.ShouldBe(105);
        dl.HeightMm.ShouldBe(210);
        dl.CssPageSize.ShouldBe("105mm 210mm");

        var a6 = EditorLayouts.For(PageLayout.A6Landscape);
        a6.WidthMm.ShouldBe(148);
        a6.HeightMm.ShouldBe(105);
    }

    [Fact]
    public void FlyerTemplate_CarriesModernTheme()
    {
        var flyer = EditorTemplates.Create(EditorTemplates.TemplateKind.Flyer);
        flyer.Theme.ShouldNotBeNull();
        flyer.Theme.Name.ShouldBe("Modern");
    }
}
