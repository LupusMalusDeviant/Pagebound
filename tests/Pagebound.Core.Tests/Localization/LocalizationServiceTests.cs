using System.Net;
using System.Text;
using Microsoft.JSInterop;
using NSubstitute;
using Pagebound.Infrastructure.Localization;
using Shouldly;

namespace Pagebound.Core.Tests.Localization;

public sealed class LocalizationServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private const string DeJson = """{ "plain": "Text", "greeting": "Hallo {name}", "idx": "Seite {0}" }""";
    private const string EnJson = """{ "plain": "Text EN" }""";

    /// <summary>Serviert je Pfad eine vorgegebene JSON-Antwort, sonst 404.</summary>
    private sealed class StubHandler(IReadOnlyDictionary<string, string> byPath) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath.TrimStart('/');
            return Task.FromResult(byPath.TryGetValue(path, out var json)
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    private static LocalizationService New(
        IReadOnlyDictionary<string, string> resources, string? storedLang = null)
    {
        var http = new HttpClient(new StubHandler(resources)) { BaseAddress = new Uri("http://localhost/") };
        var js = Substitute.For<IJSRuntime>();
        js.InvokeAsync<string?>("pageboundShortcuts.getStorage", Arg.Any<CancellationToken>(), Arg.Any<object?[]>())
            .Returns(new ValueTask<string?>(storedLang));
        return new LocalizationService(http, js);
    }

    private static Dictionary<string, string> De() => new() { ["resources/de.json"] = DeJson };

    [Fact]
    public async Task Initialize_DefaultsToGerman_AndResolvesKeys()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        svc.CurrentLanguage.ShouldBe("de");
        svc.T("plain").ShouldBe("Text");
    }

    [Fact]
    public async Task T_InterpolatesNamedAndIndexedArgs()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        svc.T("greeting", new Dictionary<string, object> { ["name"] = "Welt" }).ShouldBe("Hallo Welt");
        svc.T("idx", new Dictionary<string, object> { ["0"] = 7 }).ShouldBe("Seite 7");
    }

    [Fact]
    public async Task T_MissingKey_ReturnsKey()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        svc.T("does.not.exist").ShouldBe("does.not.exist");
    }

    [Fact]
    public async Task T_NoArgs_ReturnsTemplateVerbatim()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        svc.T("greeting").ShouldBe("Hallo {name}");
    }

    [Fact]
    public async Task Initialize_HonorsStoredLanguage()
    {
        var svc = New(
            new Dictionary<string, string> { ["resources/de.json"] = DeJson, ["resources/en.json"] = EnJson },
            storedLang: "en");
        await svc.InitializeAsync(Ct);

        svc.CurrentLanguage.ShouldBe("en");
        svc.T("plain").ShouldBe("Text EN");
    }

    [Fact]
    public async Task Initialize_IgnoresUnknownStoredLanguage()
    {
        var svc = New(De(), storedLang: "fr");
        await svc.InitializeAsync(Ct);

        svc.CurrentLanguage.ShouldBe("de");
    }

    [Fact]
    public void AvailableLanguages_AreDeAndEn()
    {
        New(new Dictionary<string, string>()).AvailableLanguages.ShouldBe(new[] { "de", "en" });
    }

    [Fact]
    public async Task SetLanguage_Unavailable_IsIgnored()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        await Should.NotThrowAsync(() => svc.SetLanguageAsync("fr", Ct));
        svc.CurrentLanguage.ShouldBe("de");
    }

    [Fact]
    public async Task SetLanguage_AvailableDifferent_PersistsAndReloads()
    {
        var svc = New(De());
        await svc.InitializeAsync(Ct);

        // Löst (gemockt) Storage-Write + Reload aus — wir prüfen nur, dass es nicht wirft.
        await Should.NotThrowAsync(() => svc.SetLanguageAsync("en", Ct));
    }

    [Fact]
    public async Task T_MissingBundle_ReturnsKey()
    {
        // de.json fehlt im Stub -> Bundle-Load schlägt still fehl, T() liefert Keys 1:1.
        var svc = New(new Dictionary<string, string>());
        await svc.InitializeAsync(Ct);

        svc.T("plain").ShouldBe("plain");
    }
}
