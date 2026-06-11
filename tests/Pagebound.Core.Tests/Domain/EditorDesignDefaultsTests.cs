using System.Text.Json;
using System.Text.Json.Serialization;
using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class EditorDesignDefaultsTests
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    [Fact]
    public void All_HasUniqueSafeFileNames()
    {
        EditorDesignDefaults.All.Count.ShouldBeGreaterThanOrEqualTo(5);
        var names = EditorDesignDefaults.All.Select(d => d.FileBaseName).ToList();
        names.Distinct(StringComparer.OrdinalIgnoreCase).Count().ShouldBe(names.Count);
        foreach (var name in names)
        {
            name.ShouldNotBeNullOrWhiteSpace();
            // Dateiname-sicher: keine Pfade, keine Sonderzeichen
            name.All(c => char.IsLetterOrDigit(c) || c is '-' or '_').ShouldBeTrue(name);
        }
    }

    [Fact]
    public void Designs_AreValid_AndUseExistingThemes()
    {
        foreach (var def in EditorDesignDefaults.All)
        {
            var doc = def.Create();
            doc.Title.ShouldNotBeNullOrWhiteSpace(def.FileBaseName);
            doc.Pages.ShouldNotBeEmpty(def.FileBaseName);
            doc.Pages.SelectMany(p => p.Blocks).ShouldNotBeEmpty(def.FileBaseName);
            doc.Theme.ShouldNotBeNull(def.FileBaseName);
            EditorThemes.Presets.ShouldContain(p => p.Name == doc.Theme.Name, def.FileBaseName);

            foreach (var block in doc.Pages.SelectMany(p => p.Blocks))
            {
                EditorThemes.SanitizeColor(block.Color, "FAIL").ShouldNotBe("FAIL", def.FileBaseName);
                if (block.FontSizePt is int pt) pt.ShouldBeInRange(6, 120);
                block.WidthPercent.ShouldBeInRange(10, 100);
                block.HeightPx.ShouldBeInRange(1, 400);
            }
        }
    }

    [Fact]
    public void Create_ReturnsFreshInstances_StencilSemantics()
    {
        var def = EditorDesignDefaults.All[0];
        var a = def.Create();
        var b = def.Create();
        ReferenceEquals(a, b).ShouldBeFalse();
        a.Pages[0].Blocks[0].Text = "verändert";
        b.Pages[0].Blocks[0].Text.ShouldNotBe("verändert");
    }

    [Fact]
    public void Designs_SurviveJsonRoundtrip()
    {
        foreach (var def in EditorDesignDefaults.All)
        {
            var doc = def.Create();
            var back = JsonSerializer.Deserialize<EditorDocument>(JsonSerializer.Serialize(doc, Json), Json);
            back.ShouldNotBeNull(def.FileBaseName);
            back.Title.ShouldBe(doc.Title);
            back.Layout.ShouldBe(doc.Layout);
            back.Pages.Count.ShouldBe(doc.Pages.Count);
            back.Theme!.Name.ShouldBe(doc.Theme!.Name);
        }
    }
}
