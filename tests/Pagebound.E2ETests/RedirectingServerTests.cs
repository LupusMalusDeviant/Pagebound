using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Regressionstest für die Redirect-Härtung im Service Worker (Bean PDF-Tool-vp2u):
/// Leitet der Server <c>/index.html</c> um, darf der SW die umgeleitete Antwort
/// nicht so cachen, dass sie später Navigationen beantwortet — sonst bricht Chrome
/// jede Navigation mit <c>net::ERR_FAILED</c> ab, sobald der SW aktiv ist.
///
/// Läuft gegen einen absichtlich umleitenden Server (<c>PAGEBOUND_REDIRECT_URL</c>,
/// in der CI: <c>redirect-adversary.nginx.conf</c> im Auslieferungs-Image). Ohne
/// diese URL überspringt sich der Test lokal; mit <c>PAGEBOUND_REQUIRE_SERVER=1</c>
/// scheitert er — die CI muss den Gegenspieler stellen.
/// </summary>
[Collection("web")]
public sealed class RedirectingServerTests
{
    private readonly WebAppFixture _fx;

    public RedirectingServerTests(WebAppFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task Service_Worker_haelt_die_App_am_Leben_wenn_der_Server_index_html_umleitet()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var baseUrl = Environment.GetEnvironmentVariable("PAGEBOUND_REDIRECT_URL")?.TrimEnd('/');
        WebAppFixture.RequireOrSkip(!string.IsNullOrEmpty(baseUrl),
            "PAGEBOUND_REDIRECT_URL nicht gesetzt — kein umleitender Gegenspieler-Server.");

        // Erst belegen, dass der Gegenspieler wirklich umleitet. Täte er das nicht
        // (Konfiguration nicht geladen, falscher Port), wäre der Rest grün, ohne
        // die Härtung je berührt zu haben.
        using (var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }))
        {
            var probe = await http.GetAsync(baseUrl + "/index.html");
            ((int)probe.StatusCode).ShouldBeInRange(301, 308, "Gegenspieler leitet /index.html nicht um");
            probe.Headers.Location?.OriginalString.ShouldBe("/");
        }

        var context = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { IgnoreHTTPSErrors = true });
        try
        {
            var page = await context.NewPageAsync();
            await page.GotoAsync(baseUrl + "/");
            await page.Locator("main h1").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });

            var swScript = await page.EvaluateAsync<string>("async () => (await (await fetch('/service-worker.js')).text())");
            WebAppFixture.RequireOrSkip(swScript.Contains("offlineAssetsInclude"),
                "Dev-Service-Worker (dotnet run) — der Test braucht den veröffentlichten.");

            // Installation abwarten: index.html liegt im Cache — und zwar NICHT als
            // umgeleitete Antwort (die wäre für Navigationen unbrauchbar).
            await OfflineTests.PollAsync(page, "async () => !!(await navigator.serviceWorker.getRegistration())?.active", TimeSpan.FromSeconds(120));
            await OfflineTests.PollAsync(page, "async () => !!(await caches.match('/index.html'))", TimeSpan.FromSeconds(120));
            (await page.EvaluateAsync<bool>("async () => (await caches.match('/index.html')).redirected"))
                .ShouldBeFalse("index.html liegt als umgeleitete Antwort im SW-Cache");

            // Jetzt beantwortet der SW Navigationen aus diesem Eintrag. Vorher scheiterte
            // genau hier jede Navigation mit net::ERR_FAILED.
            await page.ReloadAsync();
            await page.WaitForFunctionAsync("() => !!navigator.serviceWorker.controller", null, new PageWaitForFunctionOptions { Timeout = 60_000 });
            await page.GotoAsync(baseUrl + "/reader");
            await page.Locator("main h1").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
            (await page.EvaluateAsync<bool>("() => !!navigator.serviceWorker.controller"))
                .ShouldBeTrue("/reader wurde nicht vom Service Worker ausgeliefert — der Test hätte nichts geprüft");
        }
        finally
        {
            await context.CloseAsync();
        }
    }
}
