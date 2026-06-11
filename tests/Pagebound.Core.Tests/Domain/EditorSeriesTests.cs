using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class EditorSeriesTests
{
    [Fact]
    public void ParseCsv_HandlesQuotesDelimitersAndEmptyLines()
    {
        var rows = EditorSeries.ParseCsv("name,ort\n\"Müller, Anna\",Berlin\n\nBob,\"Sankt \"\"Augustin\"\"\"\n");
        rows.Count.ShouldBe(2);
        rows[0]["name"].ShouldBe("Müller, Anna");
        rows[0]["ORT"].ShouldBe("Berlin"); // case-insensitiv
        rows[1]["ort"].ShouldBe("Sankt \"Augustin\"");
    }

    [Fact]
    public void ParseCsv_DetectsSemicolonDelimiter()
    {
        var rows = EditorSeries.ParseCsv("name;ort\r\nAnna;Berlin\r\n");
        rows.Count.ShouldBe(1);
        rows[0]["ort"].ShouldBe("Berlin");
    }

    [Fact]
    public void Expand_ReplacesTokens_EncodesHtml_AndKeepsTemplateUntouched()
    {
        var template = EditorDocument.NewEmpty("Einladung");
        template.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Heading, Text = "Hallo {{name}}!" });
        template.Pages[0].Blocks.Add(new EditorBlock
        {
            Type = EditorBlockType.Table,
            Rows = new List<List<string>> { new() { "Ort", "{{ort}}" } }
        });
        template.Pages[0].Overlays.Add(new EditorOverlay { Type = EditorOverlayType.Text, Text = "{{name}}" });

        var rows = EditorSeries.ParseCsv("name,ort\n<b>Anna</b>,Berlin\nBob,Köln\n");
        var result = EditorSeries.Expand(template, rows);

        result.Pages.Count.ShouldBe(2);
        result.Pages[0].Blocks[0].Text.ShouldBe("Hallo &lt;b&gt;Anna&lt;/b&gt;!"); // HTML-encodiert
        result.Pages[0].Blocks[1].Rows![0][1].ShouldBe("Berlin");
        result.Pages[0].Overlays[0].Text.ShouldBe("&lt;b&gt;Anna&lt;/b&gt;");
        result.Pages[1].Blocks[0].Text.ShouldBe("Hallo Bob!");
        // Vorlage unangetastet (Schablonen-Semantik)
        template.Pages.Count.ShouldBe(1);
        template.Pages[0].Blocks[0].Text.ShouldBe("Hallo {{name}}!");
    }

    [Fact]
    public void Expand_LeavesUnknownTokens()
    {
        var template = EditorDocument.NewEmpty("T");
        template.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Paragraph, Text = "{{unbekannt}}" });
        var result = EditorSeries.Expand(template, EditorSeries.ParseCsv("name\nAnna\n"));
        result.Pages[0].Blocks[0].Text.ShouldBe("{{unbekannt}}");
    }

    [Fact]
    public void FindTokens_CollectsFromAllTextSources()
    {
        var doc = EditorDocument.NewEmpty("{{titel}}");
        doc.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Columns, ColumnsHtml = new List<string> { "{{a}}", "x" } });
        doc.Pages[0].Overlays.Add(new EditorOverlay { Type = EditorOverlayType.Text, Text = "{{ b }}" });
        var tokens = EditorSeries.FindTokens(doc);
        tokens.ShouldBe(new[] { "a", "b", "titel" });
    }

    [Fact]
    public void OverlaySnapshot_PreservesId_CloneDoesNot()
    {
        var ov = new EditorOverlay { Type = EditorOverlayType.Shape, XPercent = 5, Color = "#ff0000" };
        ov.Snapshot().Id.ShouldBe(ov.Id);
        ov.Clone().Id.ShouldNotBe(ov.Id);
        ov.Snapshot().Color.ShouldBe("#ff0000");
    }

    [Fact]
    public void PageSnapshot_DeepCopiesOverlaysAndColumns()
    {
        var page = new EditorPage();
        page.Overlays.Add(new EditorOverlay { Type = EditorOverlayType.Text, Text = "A" });
        page.Blocks.Add(new EditorBlock { Type = EditorBlockType.Columns, ColumnsHtml = new List<string> { "c1" } });
        var snap = page.Snapshot();
        page.Overlays[0].Text = "geändert";
        page.Blocks[0].ColumnsHtml![0] = "geändert";
        snap.Overlays[0].Text.ShouldBe("A");
        snap.Blocks[0].ColumnsHtml![0].ShouldBe("c1");
    }
}
