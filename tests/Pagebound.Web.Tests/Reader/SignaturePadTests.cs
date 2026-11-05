using System.Text.Json;
using System.Text.RegularExpressions;
using Bunit;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Pagebound.Core.Abstractions;
using Pagebound.Web.Features.Reader;
using Shouldly;

namespace Pagebound.Web.Tests.Reader;

/// <summary>
/// SignaturePad: Zeichnen- und Tippen-Tab. Geprüft wird, was die Komponente
/// selbst entscheidet — welche JS-Funktion mit welchen (whitelisteten) Werten
/// aufgerufen wird und was beim Aufrufer ankommt. Das Pixel-Rendering liegt im
/// Browser (shortcuts-bridge.ts) und ist hier bewusst nicht Gegenstand.
/// </summary>
public sealed class SignaturePadTests : BunitContext
{
    private const string FakePng = "data:image/png;base64,iVBORw0KGgo=";

    public SignaturePadTests()
    {
        var l = Substitute.For<ILocalizationService>();
        l.T(Arg.Any<string>(), Arg.Any<IReadOnlyDictionary<string, object>?>()).Returns(ci => ci.ArgAt<string>(0));
        Services.AddSingleton(l);
        JSInterop.SetupVoid("pageboundShortcuts.initSignaturePad", _ => true);
        JSInterop.SetupVoid("pageboundShortcuts.clearSignaturePad", _ => true);
        JSInterop.SetupVoid("pageboundShortcuts.disposeSignaturePad", _ => true);
    }

    [Fact]
    public void Startet_im_Zeichnen_Tab_und_initialisiert_das_Canvas()
    {
        var cut = Render<SignaturePad>();

        cut.Find("#pb-sigpad-tab-draw").GetAttribute("aria-selected").ShouldBe("true");
        cut.FindAll("#pb-sigpad-name").ShouldBeEmpty();
        JSInterop.VerifyInvoke("pageboundShortcuts.initSignaturePad");
    }

    [Fact]
    public void Gezeichnete_Signatur_wird_als_nicht_getippt_uebergeben()
    {
        JSInterop.Setup<string?>("pageboundShortcuts.getSignatureDataUrl", _ => true).SetResult(FakePng);
        SignaturePad.SignatureResult? result = null;
        var cut = Render<SignaturePad>(p => p.Add(x => x.OnAccept, r => result = r));

        cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept")).Click();

        result.ShouldNotBeNull();
        result.DataUrl.ShouldBe(FakePng);
        result.Typed.ShouldBeFalse();
    }

    [Fact]
    public void Leere_Zeichnung_loest_nichts_aus()
    {
        JSInterop.Setup<string?>("pageboundShortcuts.getSignatureDataUrl", _ => true).SetResult(null);
        var called = false;
        var cut = Render<SignaturePad>(p => p.Add(x => x.OnAccept, _ => called = true));

        cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept")).Click();

        called.ShouldBeFalse();
    }

    [Fact]
    public void Tippen_Tab_uebernimmt_den_Unterzeichnernamen_als_Vorbelegung()
    {
        var cut = Render<SignaturePad>(p => p.Add(x => x.InitialName, "  Erika Mustermann "));

        cut.Find("#pb-sigpad-tab-type").Click();

        cut.Find("#pb-sigpad-name").GetAttribute("value").ShouldBe("Erika Mustermann");
        cut.Find(".pb-sigpad-preview").TextContent.Trim().ShouldBe("Erika Mustermann");
        // Canvas bleibt im DOM (nur ausgeblendet) — eine angefangene Zeichnung geht nicht verloren.
        cut.FindAll("#pb-sigpad").Count.ShouldBe(1);
    }

    [Fact]
    public void Getippte_Signatur_rendert_mit_gewaehlter_Schrift_und_Farbe()
    {
        var render = JSInterop.Setup<string?>("pageboundShortcuts.renderTypedSignature", _ => true);
        render.SetResult(FakePng);
        SignaturePad.SignatureResult? result = null;
        var cut = Render<SignaturePad>(p => p.Add(x => x.OnAccept, r => result = r));

        cut.Find("#pb-sigpad-tab-type").Click();
        cut.Find("#pb-sigpad-name").Input("Max Muster");
        cut.Find("#pb-sigpad-font").Change("vibes");
        cut.Find("#pb-sigpad-color").Change("blue");
        cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept")).Click();

        var call = render.Invocations.ShouldHaveSingleItem();
        call.Arguments[0].ShouldBe("Max Muster");
        call.Arguments[1].ShouldBe("Pb Sig Great Vibes");
        call.Arguments[2].ShouldBe("#1e3a8a");
        result.ShouldNotBeNull();
        result.Typed.ShouldBeTrue();
        result.DataUrl.ShouldBe(FakePng);
    }

    [Fact]
    public void Leerer_Name_deaktiviert_Uebernehmen()
    {
        var cut = Render<SignaturePad>();
        cut.Find("#pb-sigpad-tab-type").Click();

        var accept = cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept"));
        accept.HasAttribute("disabled").ShouldBeTrue();
    }

    [Fact]
    public void Nicht_ladbare_Schrift_meldet_Fehler_statt_still_Fallback_zu_liefern()
    {
        JSInterop.Setup<string?>("pageboundShortcuts.renderTypedSignature", _ => true).SetResult(null);
        var called = false;
        var cut = Render<SignaturePad>(p => p
            .Add(x => x.OnAccept, _ => called = true)
            .Add(x => x.InitialName, "Max"));

        cut.Find("#pb-sigpad-tab-type").Click();
        cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept")).Click();

        called.ShouldBeFalse();
        cut.Find("[role=alert]").TextContent.ShouldContain("reader.sig.type.fontError");
    }

    [Fact]
    public void Zu_langer_Name_wird_auf_Maximallaenge_gekuerzt()
    {
        var render = JSInterop.Setup<string?>("pageboundShortcuts.renderTypedSignature", _ => true);
        render.SetResult(FakePng);
        var cut = Render<SignaturePad>(p => p.Add(x => x.InitialName, new string('x', 200)));

        cut.Find("#pb-sigpad-tab-type").Click();
        cut.FindAll("button").Single(b => b.TextContent.Contains("reader.sig.draw.accept")).Click();

        ((string)render.Invocations.Single().Arguments[0]!).Length.ShouldBe(SignaturePad.MaxTypedLength);
    }

    [Fact]
    public void Alle_Schriften_haben_ein_font_face_und_eine_mitgelieferte_Datei()
    {
        var web = FindWebRoot();
        var css = File.ReadAllText(Path.Combine(web, "wwwroot", "css", "app.src.css"));
        foreach (var f in SignaturePad.Fonts)
        {
            var faces = Regex.Matches(css, $@"font-family:\s*""{Regex.Escape(f.Family)}"";[^}}]*src:\s*url\(""(/fonts/signature/[^""]+)""\)");
            faces.Count.ShouldBe(2, $"{f.Family}: latin + latin-ext erwartet");
            foreach (Match m in faces)
            {
                var file = Path.Combine(web, "wwwroot", m.Groups[1].Value.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                File.Exists(file).ShouldBeTrue($"fehlt: {file}");
            }
        }
    }

    [Theory]
    [InlineData("de")]
    [InlineData("en")]
    public void Alle_verwendeten_Texte_sind_uebersetzt(string lang)
    {
        var web = FindWebRoot();
        var razor = File.ReadAllText(Path.Combine(web, "Features", "Reader", "SignaturePad.razor"));
        var keys = Regex.Matches(razor, @"""(reader\.sig\.[a-zA-Z.]+|common\.[a-zA-Z.]+)""").Select(m => m.Groups[1].Value).Distinct().ToList();
        keys.ShouldNotBeEmpty();
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(web, "wwwroot", "resources", $"{lang}.json")));
        foreach (var key in keys)
            doc.RootElement.TryGetProperty(key, out _).ShouldBeTrue($"{lang}.json: Schlüssel fehlt: {key}");
    }

    private static string FindWebRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pagebound.slnx")))
            dir = dir.Parent;
        dir.ShouldNotBeNull("Repo-Wurzel (Pagebound.slnx) nicht gefunden");
        return Path.Combine(dir.FullName, "src", "Pagebound.Web");
    }
}
