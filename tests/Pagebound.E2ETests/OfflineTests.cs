using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Offline-Start der PWA (Bean PDF-Tool-off1): Nach einem Online-Besuch muss die
/// App auch ohne Netz mit echten Texten und Schriften starten. Vorher cachte der
/// Service Worker weder resources/*.json noch .woff2 — offline erschienen rohe
/// Schlüssel wie „reader.heading".
/// Braucht den veröffentlichten Service Worker (dotnet publish), nicht dotnet run.
/// </summary>
[Collection("web")]
public sealed class OfflineTests
{
    private readonly WebAppFixture _fx;

    public OfflineTests(WebAppFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task Nach_einem_Online_Besuch_startet_die_App_offline_mit_Texten_und_Schriften()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var context = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { IgnoreHTTPSErrors = true });
        var page = await context.NewPageAsync();
        await page.GotoAsync(_fx.BaseUrl + "/");
        await page.Locator("main h1").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });

        var hasSw = await page.EvaluateAsync<bool>("() => 'serviceWorker' in navigator && location.protocol !== 'file:'");
        Skip.IfNot(hasSw, "Kein Service Worker verfügbar.");
        var swScript = await page.EvaluateAsync<string>("async () => (await (await fetch('/service-worker.js')).text())");
        Skip.If(!swScript.Contains("offlineAssetsInclude"), "Dev-Service-Worker (dotnet run) — Offline-Test braucht den veröffentlichten.");

        // Warten, bis der SW die Seite kontrolliert und Sprachdatei + Schrift im Cache liegen.
        await PollAsync(page, "async () => !!(await navigator.serviceWorker.getRegistration())?.active", TimeSpan.FromSeconds(120));
        await page.ReloadAsync();
        await page.WaitForFunctionAsync("() => !!navigator.serviceWorker.controller", null, new PageWaitForFunctionOptions { Timeout = 60_000 });
        await PollAsync(page, @"async () => {
            let json = false, font = false;
            for (const k of await caches.keys()) {
                for (const r of await (await caches.open(k)).keys()) {
                    const p = new URL(r.url).pathname;
                    if (p === '/resources/de.json') json = true;
                    if (p.endsWith('.woff2')) font = true;
                }
            }
            return json && font;
        }", TimeSpan.FromSeconds(120));

        var failed = new List<string>();
        page.RequestFailed += (_, r) => failed.Add(new Uri(r.Url).AbsolutePath);
        await context.SetOfflineAsync(true);
        try
        {
            await page.GotoAsync(_fx.BaseUrl + "/reader");
            var h1 = page.Locator("main h1").First;
            await h1.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
            await page.WaitForTimeoutAsync(1000);

            (await h1.TextContentAsync())!.Trim().ShouldNotBe("reader.heading", "offline erscheinen rohe Lokalisierungsschlüssel");
            (await page.TitleAsync()).ShouldNotContain("reader.pageTitle");
            // Schriften kommen ohne Netzversuch aus dem Cache. (Die Sprachdatei wird
            // bewusst zuerst vom Netz versucht — dieser Versuch scheitert offline
            // erwartungsgemäß; dass der Cache-Rückfall greift, belegen h1/Titel oben.)
            failed.Where(p => p.EndsWith(".woff2")).ShouldBeEmpty("Schriften offline nicht verfügbar");
            (await page.EvaluateAsync<bool>(
                "async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.includes('Hanken Grotesk') && f.status === 'loaded'); }"))
                .ShouldBeTrue("UI-Schrift offline nicht geladen");
        }
        finally
        {
            await context.SetOfflineAsync(false);
            await context.CloseAsync();
        }
    }

    /// <summary>
    /// Wartet, bis eine ASYNCHRONE Bedingung im Browser true liefert.
    /// Nicht WaitForFunctionAsync: das wertet das zurückgegebene Promise sofort
    /// als „wahr" und wartet gar nicht (so beobachtet — der Test lief gegen den
    /// alten Service Worker ohne jeden Cache-Eintrag weiter).
    /// </summary>
    private static async Task PollAsync(IPage page, string asyncPredicate, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            if (await page.EvaluateAsync<bool>(asyncPredicate)) return;
            if (DateTime.UtcNow > deadline) throw new TimeoutException($"Bedingung nicht erfüllt nach {timeout.TotalSeconds:F0} s: {asyncPredicate[..Math.Min(80, asyncPredicate.Length)]}");
            await Task.Delay(500);
        }
    }
}
