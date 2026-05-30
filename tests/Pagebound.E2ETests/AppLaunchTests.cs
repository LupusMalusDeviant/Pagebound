using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Smoke-level E2E tests that verify the Pagebound PWA loads correctly.
/// Requires the app to be running at the URL defined by PAGEBOUND_URL env var
/// (defaults to http://localhost:5000 for local dev).
/// In CI, the publish step must run before these tests.
/// </summary>
public sealed class AppLaunchTests : IAsyncLifetime
{
    private IPlaywright _playwright = null!;
    private IBrowser _browser = null!;
    private IBrowserContext _context = null!;
    private IPage _page = null!;

    private static string AppUrl =>
        Environment.GetEnvironmentVariable("PAGEBOUND_URL") ?? "http://localhost:5000";

    public async Task InitializeAsync()
    {
        _playwright = await Playwright.CreateAsync();
        _browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = true
        });
        _context = await _browser.NewContextAsync();
        _page = await _context.NewPageAsync();
    }

    public async Task DisposeAsync()
    {
        await _context.DisposeAsync();
        await _browser.DisposeAsync();
        _playwright.Dispose();
    }

    [Fact]
    public async Task App_Loads_TitleContainsPagebound()
    {
        await _page.GotoAsync(AppUrl);
        await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);

        var title = await _page.TitleAsync();
        title.ShouldContain("Pagebound");
    }

    [Fact]
    public async Task App_Loads_HasDropZoneOrOpenButton()
    {
        await _page.GotoAsync(AppUrl);
        await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);

        // App should render a PDF drop zone or an open button — either is valid
        var hasDropZone = await _page.Locator("[data-testid='drop-zone'], .drop-zone, input[type='file']")
            .CountAsync() > 0;
        var hasOpenButton = await _page.Locator("button:has-text('Öffnen'), button:has-text('Open')")
            .CountAsync() > 0;

        (hasDropZone || hasOpenButton).ShouldBeTrue("App should render a way to open a PDF");
    }

    [Fact]
    public async Task App_Loads_DoesNotHaveJavaScriptErrors()
    {
        var errors = new List<string>();
        _page.PageError += (_, e) => errors.Add(e);

        await _page.GotoAsync(AppUrl);
        await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);

        errors.ShouldBeEmpty($"Unexpected JS errors: {string.Join("; ", errors)}");
    }
}
