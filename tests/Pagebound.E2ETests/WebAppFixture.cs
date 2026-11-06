using Microsoft.Playwright;

namespace Pagebound.E2ETests;

/// <summary>
/// Geteilte Fixture für die Browser-Smoke-Tests. Macht den Harness <i>lauffähig</i>
/// (NFA-072), ohne den Standard-<c>dotnet test</c>-Lauf rot zu färben:
///
/// <list type="bullet">
///   <item>Ziel-URL kommt aus <c>PAGEBOUND_URL</c> (Default <c>http://localhost:5099</c>,
///         der lokale Dev-/Preview-Port). Die App muss laufen — lokal z. B.
///         <c>dotnet run --project src/Pagebound.Web</c>, in CI als eigener Schritt.</item>
///   <item>Der Playwright-Chromium wird einmalig per <c>playwright install</c> sichergestellt —
///         oder per <c>PAGEBOUND_CHROMIUM</c> (Pfad zu einem vorhandenen Chromium) ersetzt.</item>
///   <item>Fehlt der Server oder der Browser, wird <see cref="Available"/> = false gesetzt
///         und die Tests <b>überspringen</b> sich (SkippableFact) statt zu scheitern.</item>
/// </list>
///
/// So ist die Suite per Default grün und läuft trotzdem echt durch, sobald die App
/// erreichbar und der Browser installiert ist.
/// </summary>
public sealed class WebAppFixture : IAsyncLifetime
{
    public string BaseUrl { get; private set; } = "";
    public bool Available { get; private set; }
    public string SkipReason { get; private set; } = "";
    public IBrowser? Browser { get; private set; }

    private IPlaywright? _playwright;

    /// <summary>
    /// <c>PAGEBOUND_REQUIRE_SERVER=1</c>: Die Suite darf sich NICHT wegskippen.
    /// Ohne das wäre der CI-Job grün, obwohl kein einziger Test gelaufen ist —
    /// genau das verbietet die Leitplanke „E2E-Smokes dürfen nicht still
    /// weg-skippen" (CLAUDE.md). Lokal bleibt das Skip-Verhalten, damit
    /// <c>dotnet test</c> ohne laufende App nicht rot wird.
    /// </summary>
    private static bool ServerRequired =>
        Environment.GetEnvironmentVariable("PAGEBOUND_REQUIRE_SERVER") is "1" or "true";

    public async Task InitializeAsync()
    {
        await TryInitializeAsync();

        if (!Available && ServerRequired)
        {
            throw new InvalidOperationException(
                "PAGEBOUND_REQUIRE_SERVER ist gesetzt, die E2E-Suite kann aber nicht laufen: "
                + SkipReason);
        }
    }

    private async Task TryInitializeAsync()
    {
        BaseUrl = (Environment.GetEnvironmentVariable("PAGEBOUND_URL")
                   ?? "http://localhost:5099").TrimEnd('/');

        if (!await IsReachableAsync(BaseUrl, TimeSpan.FromSeconds(20)))
        {
            SkipReason =
                $"App unter {BaseUrl} nicht erreichbar. App starten " +
                "(z. B. `dotnet run --project src/Pagebound.Web`) und ggf. PAGEBOUND_URL setzen.";
            return;
        }

        // Optional: vorhandenen Chromium nutzen statt herunterzuladen (Umgebungen ohne
        // Zugriff auf das Playwright-CDN, z. B. Sandboxes mit vorinstalliertem Browser).
        var chromium = Environment.GetEnvironmentVariable("PAGEBOUND_CHROMIUM");
        if (!string.IsNullOrWhiteSpace(chromium))
        {
            try
            {
                _playwright = await Playwright.CreateAsync();
                Browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
                {
                    Headless = true,
                    ExecutablePath = chromium,
                    Args = new[] { "--no-sandbox" },
                });
                Available = true;
            }
            catch (Exception ex)
            {
                SkipReason = $"Chromium unter PAGEBOUND_CHROMIUM ({chromium}) startet nicht: " + ex.Message;
            }
            return;
        }

        // Chromium sicherstellen (idempotent; lädt beim allerersten Mal ~150 MB nach).
        try
        {
            var exit = Microsoft.Playwright.Program.Main(new[] { "install", "chromium" });
            if (exit != 0)
            {
                SkipReason = $"`playwright install chromium` schlug fehl (Exit {exit}).";
                return;
            }
        }
        catch (Exception ex)
        {
            SkipReason = "Playwright-Browser-Installation fehlgeschlagen: " + ex.Message;
            return;
        }

        try
        {
            _playwright = await Playwright.CreateAsync();
            Browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = true });
        }
        catch (Exception ex)
        {
            SkipReason = "Chromium-Start fehlgeschlagen: " + ex.Message;
            return;
        }

        Available = true;
    }

    public async Task DisposeAsync()
    {
        if (Browser is not null) await Browser.DisposeAsync();
        _playwright?.Dispose();
    }

    /// <summary>Pollt die URL, bis sie eine HTTP-Antwort &lt; 500 liefert oder das Timeout greift.</summary>
    private static async Task<bool> IsReachableAsync(string url, TimeSpan timeout)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var response = await http.GetAsync(url);
                if ((int)response.StatusCode < 500) return true;
            }
            catch
            {
                // Server noch nicht oben — weiter pollen.
            }
            await Task.Delay(1000);
        }
        return false;
    }
}

/// <summary>xUnit-Collection, die <see cref="WebAppFixture"/> einmal pro Testlauf teilt
/// (Browser-Start ist teuer).</summary>
[CollectionDefinition("web")]
public sealed class WebCollection : ICollectionFixture<WebAppFixture>;
