using System.Text.Json;
using System.Text.Json.Serialization;
using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

/// <summary>
/// Die Datenbindungs-Felder eines Blocks (when/unless/repeat) werden vom
/// MCP-Paket gesetzt und vom Designer NICHT ausgewertet — er muss sie aber
/// unversehrt durch Laden und Speichern tragen. Fiele eines davon weg, verlöre
/// eine im Editor geöffnete Rechnungsvorlage still ihre Logik: die bedingten
/// Blöcke für die beiden Umsatzsteuer-Fälle und die Positionstabelle.
/// </summary>
public sealed class EditorBlockDataBindingTests
{
    // Spiegelt die Optionen des Designers (DesignerPage.razor): CamelCase beim
    // Schreiben, case-insensitiv beim Lesen, Enums als Text.
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    /// <summary>Ausschnitt einer vom MCP erzeugten Vorlage (kind "invoice-data").</summary>
    private const string TemplateJson = """
    {
      "title": "Rechnung {{rechnung.nummer}}",
      "layout": "A4Portrait",
      "pages": [
        {
          "blocks": [
            { "type": "Paragraph", "text": "{{kunde.zusatz}}", "when": "kunde.zusatz" },
            { "type": "Paragraph", "text": "Gemäß § 19 UStG …", "when": "kleinunternehmer" },
            {
              "type": "Table",
              "headerRow": true,
              "unless": "kleinunternehmer",
              "repeat": "positionen",
              "rows": [["Pos.", "Bezeichnung"], ["{{index}}", "{{bezeichnung}}"]]
            }
          ]
        }
      ]
    }
    """;

    [Fact]
    public void Import_KeepsDataBindingFields()
    {
        var doc = JsonSerializer.Deserialize<EditorDocument>(TemplateJson, Json);

        doc.ShouldNotBeNull();
        var blocks = doc!.Pages[0].Blocks;
        blocks.Count.ShouldBe(3);

        blocks[0].When.ShouldBe("kunde.zusatz");
        blocks[1].When.ShouldBe("kleinunternehmer");
        blocks[2].Unless.ShouldBe("kleinunternehmer");
        blocks[2].Repeat.ShouldBe("positionen");
    }

    [Fact]
    public void RoundTrip_SurvivesSaveAndReload()
    {
        var loaded = JsonSerializer.Deserialize<EditorDocument>(TemplateJson, Json)!;

        // Speichern → erneut laden, so wie der Designer es tut.
        var saved = JsonSerializer.Serialize(loaded, Json);
        var reloaded = JsonSerializer.Deserialize<EditorDocument>(saved, Json)!;

        var table = reloaded.Pages[0].Blocks[2];
        table.Unless.ShouldBe("kleinunternehmer");
        table.Repeat.ShouldBe("positionen");
        table.Rows!.Count.ShouldBe(2);
        table.Rows[1][0].ShouldBe("{{index}}");

        // Und die Platzhalter im Text bleiben ebenfalls unangetastet.
        reloaded.Title.ShouldBe("Rechnung {{rechnung.nummer}}");
        reloaded.Pages[0].Blocks[0].When.ShouldBe("kunde.zusatz");
    }

    [Fact]
    public void Export_DoesNotAddEmptyFieldsToPlainDesigns()
    {
        // Ein Design ohne Datenbindung darf durch die neuen Felder nicht wachsen —
        // sonst änderte sich jede bestehende Export-Datei ohne Anlass.
        var doc = EditorDocument.NewEmpty("Ohne Bindung");
        doc.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Paragraph, Text = "Text" });

        var json = JsonSerializer.Serialize(doc, Json);

        json.ShouldNotContain("\"when\"");
        json.ShouldNotContain("\"unless\"");
        json.ShouldNotContain("\"repeat\"");
    }

    [Fact]
    public void CloneAndSnapshot_CarryTheDataBinding()
    {
        var block = new EditorBlock
        {
            Type = EditorBlockType.Table,
            When = "a.b",
            Unless = "c",
            Repeat = "positionen",
            Rows = [["{{index}}"]]
        };

        var clone = block.Clone();
        clone.Id.ShouldNotBe(block.Id); // Clone vergibt eine neue Id …
        clone.When.ShouldBe("a.b");
        clone.Unless.ShouldBe("c");
        clone.Repeat.ShouldBe("positionen");

        var snapshot = block.Snapshot();
        snapshot.Id.ShouldBe(block.Id); // … Snapshot behält sie (Undo)
        snapshot.When.ShouldBe("a.b");
        snapshot.Unless.ShouldBe("c");
        snapshot.Repeat.ShouldBe("positionen");
    }
}
