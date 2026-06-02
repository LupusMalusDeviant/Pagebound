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
///   <item>Der Playwright-Chromium wird einmalig per <c>playwright install</c> sichergestellt.</item>
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

    public async Task InitializeAsync()
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
