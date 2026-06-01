using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Smoke-Level-E2E: prüft, dass die Pagebound-PWA im echten Browser lädt.
/// Läuft gegen die unter <see cref="WebAppFixture.BaseUrl"/> laufende App;
/// ist sie nicht erreichbar oder fehlt der Browser, überspringen sich die Tests
/// (siehe <see cref="WebAppFixture"/>) — die Suite bleibt grün.
/// </summary>
[Collection("web")]
public sealed class AppLaunchTests
{
    private readonly WebAppFixture _fx;

    public AppLaunchTests(WebAppFixture fx) => _fx = fx;

    /// <summary>Öffnet eine frische Browser-Seite und lädt die App, bis die Shell (h1) steht.</summary>
    private async Task<IPage> OpenAppAsync()
    {
        var context = await _fx.Browser!.NewContextAsync();
        var page = await context.NewPageAsync();
        await page.GotoAsync(_fx.BaseUrl);
        // WASM bootet asynchron — auf die gerenderte Shell warten statt auf NetworkIdle
        // (der Dev-Server hält eine Live-Reload-Verbindung offen, NetworkIdle träfe nie).
        await page.Locator("main h1").First.WaitForAsync(
            new LocatorWaitForOptions { Timeout = 30_000 });
        return page;
    }

    [SkippableFact]
    public async Task App_Loads_TitleContainsPagebound()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var page = await OpenAppAsync();

        var title = await page.TitleAsync();
        title.ShouldContain("Pagebound");
    }

    [SkippableFact]
    public async Task App_Loads_ShowsAnEntryPoint()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var page = await OpenAppAsync();

        // Editoriale Startseite bietet einen Einstieg ins PDF: primärer Reader-CTA
        // (Anker) oder — falls die Startseite mal direkt der Reader ist — ein Datei-Eingang.
        var entry = await page.Locator(
            "[data-testid='drop-zone'], .drop-zone, input[type='file'], " +
            "a[href$='reader'], a.btn.primary, " +
            "button:has-text('Öffnen'), a:has-text('Öffnen'), a:has-text('Open')")
            .CountAsync();

        entry.ShouldBeGreaterThan(0, "Startseite sollte einen Einstieg (Reader-CTA oder Datei-Eingang) zeigen");
    }

    [SkippableFact]
    public async Task App_Loads_DoesNotHaveJavaScriptErrors()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var context = await _fx.Browser!.NewContextAsync();
        var page = await context.NewPageAsync();
        var errors = new List<string>();
        page.PageError += (_, e) => errors.Add(e);

        await page.GotoAsync(_fx.BaseUrl);
        await page.Locator("main h1").First.WaitForAsync(
            new LocatorWaitForOptions { Timeout = 30_000 });

        errors.ShouldBeEmpty($"Unerwartete JS-Fehler: {string.Join("; ", errors)}");
    }
}
