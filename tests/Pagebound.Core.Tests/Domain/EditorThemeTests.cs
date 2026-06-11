using System.Text.Json;
using System.Text.Json.Serialization;
using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class EditorThemeTests
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    [Fact]
    public void Presets_HaveUniqueNames_AndValidValues()
    {
        EditorThemes.Presets.Select(p => p.Name).Distinct().Count().ShouldBe(EditorThemes.Presets.Count);
        foreach (var p in EditorThemes.Presets)
        {
            EditorThemes.FontStacks.ContainsKey(p.HeadingFont).ShouldBeTrue(p.Name);
            EditorThemes.FontStacks.ContainsKey(p.BodyFont).ShouldBeTrue(p.Name);
            EditorThemes.SanitizeColor(p.HeadingColor, "#000000").ShouldBe(p.HeadingColor);
            EditorThemes.SanitizeColor(p.AccentColor, "#000000").ShouldBe(p.AccentColor);
        }
    }

    [Fact]
    public void FontStack_UnknownKey_FallsBackToGeorgia()
    {
        EditorThemes.FontStack("comic-sans").ShouldBe(EditorThemes.FontStacks["georgia"]);
        EditorThemes.FontStack(null).ShouldBe(EditorThemes.FontStacks["georgia"]);
    }

    [Theory]
    [InlineData("#ff0000", "#ff0000")]
    [InlineData("#F00", "#f00")]
    [InlineData("red", "#fallback")]
    [InlineData("#12345", "#fallback")]
    [InlineData("url(javascript:1)", "#fallback")]
    [InlineData("#ff0000;background:url(x)", "#fallback")]
    [InlineData("", "#fallback")]
    public void SanitizeColor_AcceptsOnlyHex(string input, string expected)
    {
        EditorThemes.SanitizeColor(input, "#fallback").ShouldBe(expected);
    }

    [Fact]
    public void Sanitize_NormalizesHostileTheme()
    {
        var theme = new EditorTheme
        {
            Name = new string('x', 200),
            HeadingFont = "evil'); url(",
            BodyFont = "hanken",
            HeadingColor = "expression(alert(1))",
            BodyColor = "#111827",
            AccentColor = "#abc",
            PageBackground = "url(http://evil)"
        };

        var clean = EditorThemes.Sanitize(theme);

        clean.Name.Length.ShouldBe(60);
        clean.HeadingFont.ShouldBe("georgia");
        clean.BodyFont.ShouldBe("hanken");
        clean.HeadingColor.ShouldBe("#111827");
        clean.AccentColor.ShouldBe("#abc");
        clean.PageBackground.ShouldBe("#ffffff");
    }

    [Fact]
    public void MixWithWhite_ComputesSoftAccent()
    {
        EditorThemes.MixWithWhite("#000000", 0).ShouldBe("#ffffff");
        EditorThemes.MixWithWhite("#000000", 100).ShouldBe("#000000");
        EditorThemes.MixWithWhite("#ff0000", 50).ShouldBe("#ff8080");
        EditorThemes.MixWithWhite("#f00", 100).ShouldBe("#ff0000");
    }

    [Fact]
    public void Theme_JsonRoundtrip_PreservesAllFields()
    {
        var theme = EditorThemes.Presets.First(p => p.Name == "Editorial");
        var json = JsonSerializer.Serialize(theme, Json);
        var back = JsonSerializer.Deserialize<EditorTheme>(json, Json);

        back.ShouldNotBeNull();
        back.Name.ShouldBe(theme.Name);
        back.HeadingFont.ShouldBe(theme.HeadingFont);
        back.BodyFont.ShouldBe(theme.BodyFont);
        back.HeadingColor.ShouldBe(theme.HeadingColor);
        back.BodyColor.ShouldBe(theme.BodyColor);
        back.AccentColor.ShouldBe(theme.AccentColor);
        back.PageBackground.ShouldBe(theme.PageBackground);
    }

    [Fact]
    public void Document_JsonRoundtrip_KeepsThemeAndBackgroundSettings()
    {
        var doc = EditorDocument.NewEmpty("Flyer");
        doc.Theme = EditorThemes.Presets[1].Clone();
        doc.Pages[0].BackgroundImage = "data:image/png;base64,AAAA";
        doc.Pages[0].BackgroundOpacityPercent = 35;
        doc.Pages[0].BackgroundPosition = "bottom";
        doc.Pages[0].BackgroundRepeat = true;
        doc.Pages[0].Blocks.Add(new EditorBlock { Type = EditorBlockType.Heading, Text = "Hi", FontSizePt = 40 });

        var back = JsonSerializer.Deserialize<EditorDocument>(JsonSerializer.Serialize(doc, Json), Json);

        back.ShouldNotBeNull();
        back.Theme.ShouldNotBeNull();
        back.Theme.Name.ShouldBe(doc.Theme.Name);
        back.Pages[0].BackgroundOpacityPercent.ShouldBe(35);
        back.Pages[0].BackgroundPosition.ShouldBe("bottom");
        back.Pages[0].BackgroundRepeat.ShouldBeTrue();
        back.Pages[0].Blocks[0].FontSizePt.ShouldBe(40);
    }
}
