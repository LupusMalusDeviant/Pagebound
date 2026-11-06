using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Große JS-Bridges werden erst bei Bedarf geladen (wwwroot/js/lazy-bridges.js,
/// Bean PDF-Tool-brg1). Geprüft: die Lade-Mechanik selbst (mit gefälschten,
/// verzögerten Bridges — deterministisch), dass die Startseite sie nicht vor dem
/// App-Start lädt, und eine echte Funktion über die nachgeladene Bridge.
/// </summary>
[Collection("web")]
public sealed class LazyBridgeTests
{
    private readonly WebAppFixture _fx;

    public LazyBridgeTests(WebAppFixture fx) => _fx = fx;

    private static readonly string[] LazyFiles = { "pdfjs-bridge.js", "pdf-manipulator-bridge.js", "sign-bridge.js" };

    [SkippableFact]
    public async Task Platzhalter_laedt_beim_ersten_Aufruf_und_reicht_ihn_durch()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var ctx = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { ServiceWorkers = ServiceWorkerPolicy.Block });
        // Vorab-Laden im Leerlauf abschalten — sonst verbraucht es den 404-Versuch
        // unten und der Fehlerpfad wäre nicht deterministisch prüfbar.
        await ctx.AddInitScriptAsync("window.requestIdleCallback = function () { return 0; };");
        var page = await ctx.NewPageAsync();

        // Gefälschte Bridges, verzögert ausgeliefert. pdfjs scheitert beim ersten Mal.
        var pdfjsAttempts = 0;
        await page.RouteAsync("**/js/sign-bridge.js", async r =>
        {
            await Task.Delay(800);
            await r.FulfillAsync(new() { ContentType = "application/javascript", Body = "var pageboundSign = { add: function (a, b) { return a + b; } };" });
        });
        await page.RouteAsync("**/js/pdf-manipulator-bridge.js", r =>
            r.FulfillAsync(new() { ContentType = "application/javascript", Body = "var pageboundPdfManipulator = { ping: function () { return 'pong'; } };" }));
        await page.RouteAsync("**/js/pdfjs-bridge.js", async r =>
        {
            if (Interlocked.Increment(ref pdfjsAttempts) == 1) { await r.FulfillAsync(new() { Status = 404, Body = "nope" }); return; }
            await r.FulfillAsync(new() { ContentType = "application/javascript", Body = "var pageboundPdf = { version: function () { return 42; } };" });
        });

        // Eine Seite ohne Blazor (Landingpage) + der echte Lader aus dem Publish.
        await page.GotoAsync(_fx.BaseUrl + "/pdf-schwaerzen/");
        await page.AddScriptTagAsync(new() { Url = _fx.BaseUrl + "/js/lazy-bridges.js" });

        (await page.EvaluateAsync<string[]>("pageboundLazyBridges.loaded()")).ShouldBeEmpty();
        (await page.EvaluateAsync<bool>("typeof pageboundSign.then === 'undefined'")).ShouldBeTrue("Platzhalter darf kein Thenable sein");

        // Erster Aufruf: lädt (verzögert) und reicht Argumente + Ergebnis durch.
        (await page.EvaluateAsync<int>("pageboundSign.add(2, 3)")).ShouldBe(5);
        (await page.EvaluateAsync<string[]>("pageboundLazyBridges.loaded()")).ShouldContain("pageboundSign");
        // Danach das echte Objekt: synchroner Aufruf liefert direkt den Wert.
        (await page.EvaluateAsync<int>("pageboundSign.add(4, 5)")).ShouldBe(9);

        // Ladefehler: verständliche Meldung — und der nächste Aufruf versucht es neu.
        var err = await page.EvaluateAsync<string>("pageboundPdf.version().then(() => 'ok', e => String(e.message))");
        err.ShouldContain("konnte nicht geladen werden");
        pdfjsAttempts.ShouldBe(1);
        (await page.EvaluateAsync<int>("pageboundPdf.version()")).ShouldBe(42);
        await ctx.CloseAsync();
    }

    [SkippableFact]
    public async Task Startseite_laedt_die_grossen_Bridges_erst_nach_dem_App_Start()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var ctx = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { ServiceWorkers = ServiceWorkerPolicy.Block });
        // Beide Zeitpunkte IM Browser auf derselben Uhr messen (performance.now):
        // wann der Boot-Bildschirm verschwindet, und wann die Bridge-Requests starten.
        // (Von außen beobachtet käme das Verschwinden verspätet an — das Vorab-Laden
        // direkt danach sähe dann fälschlich „zu früh" aus.)
        await ctx.AddInitScriptAsync(@"
            new MutationObserver((_, obs) => {
                if (document.getElementById('app') && !document.getElementById('pb-boot') && window.__pbBootGone == null) {
                    window.__pbBootGone = performance.now(); obs.disconnect();
                }
            }).observe(document, { childList: true, subtree: true });");
        var page = await ctx.NewPageAsync();

        await page.GotoAsync(_fx.BaseUrl + "/");
        await page.WaitForFunctionAsync("() => window.__pbBootGone != null", null, new() { Timeout = 60_000 });
        // Danach im Leerlauf vorab geladen.
        await page.WaitForFunctionAsync("() => pageboundLazyBridges.loaded().length === 3", null, new() { Timeout = 30_000 });

        var bootGone = await page.EvaluateAsync<double>("window.__pbBootGone");
        // Als JSON-String zurückgeben: ein JS-Objekt kam als Dictionary<string,double>
        // still LEER an (Playwright-Deserialisierung) — der Test scheiterte daran.
        var startsJson = await page.EvaluateAsync<string>(@"(files) => JSON.stringify(Object.fromEntries(
            performance.getEntriesByType('resource')
                .filter(e => files.some(f => e.name.endsWith('/js/' + f)))
                .map(e => [e.name.split('/').pop(), e.startTime])))", LazyFiles);
        var starts = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, double>>(startsJson)!;

        starts.Keys.ShouldBe(LazyFiles, ignoreOrder: true);
        foreach (var (file, at) in starts)
            at.ShouldBeGreaterThanOrEqualTo(bootGone, $"{file} startete {bootGone - at:F0} ms VOR dem App-Start");
        await ctx.CloseAsync();
    }

    [SkippableFact]
    public async Task Einbrennen_ueber_die_nachgeladene_Manipulator_Bridge_liefert_eine_PDF()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var ctx = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = 1400, Height = 1000 }, AcceptDownloads = true,
        });
        await ctx.AddInitScriptAsync("delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete window.showDirectoryPicker;");
        var page = await ctx.NewPageAsync();
        var errors = new List<string>();
        page.PageError += (_, e) => errors.Add(e);
        page.Console += (_, m) => { if (m.Type == "error") errors.Add(m.Text); };

        await page.GotoAsync(_fx.BaseUrl + "/reader");
        await page.Locator("main h1").First.WaitForAsync(new() { Timeout = 60_000 });
        await page.Locator("input[type=file]").First.SetInputFilesAsync(new FilePayload { Name = "flatten.pdf", MimeType = "application/pdf", Buffer = MinimalPdf() });
        await page.GetByText(new Regex("(von|of) 1")).First.WaitForAsync(new() { Timeout = 30_000 });

        // Eine Annotation, damit es etwas einzubrennen gibt.
        await page.GetByRole(AriaRole.Button, new() { Name = "Zeichnen", Exact = true }).First.ClickAsync();
        await page.Locator(".pb-menuitem:visible", new() { HasText = "Stift" }).First.ClickAsync();
        var img = page.Locator("main img").First;
        await img.ScrollIntoViewIfNeededAsync();
        var b = (await img.BoundingBoxAsync())!;
        await page.Mouse.MoveAsync(b.X + b.Width * 0.3f, b.Y + 150);
        await page.Mouse.DownAsync();
        await page.Mouse.MoveAsync(b.X + b.Width * 0.6f, b.Y + 200, new() { Steps = 8 });
        await page.Mouse.UpAsync();
        await page.Keyboard.PressAsync("Escape");

        var download = await page.RunAndWaitForDownloadAsync(async () =>
        {
            await page.GetByRole(AriaRole.Button, new() { Name = "Export", Exact = true }).First.ClickAsync();
            await page.Locator(".pb-menuitem:visible", new() { HasText = "Einbrennen" }).First.ClickAsync();
        }, new() { Timeout = 60_000 });
        var path = Path.Combine(Path.GetTempPath(), $"pb-flat-{Guid.NewGuid():N}.pdf");
        await download.SaveAsAsync(path);
        var bytes = await File.ReadAllBytesAsync(path);
        Encoding.ASCII.GetString(bytes, 0, 5).ShouldBe("%PDF-");
        bytes.Length.ShouldBeGreaterThan(MinimalPdf().Length, "eingebrannte PDF muss den Strich enthalten");
        (await page.EvaluateAsync<string[]>("pageboundLazyBridges.loaded()")).ShouldContain("pageboundPdfManipulator");
        errors.ShouldBeEmpty();
        File.Delete(path);
        await ctx.CloseAsync();
    }

    private static byte[] MinimalPdf()
    {
        const string objs1 = "<< /Type /Catalog /Pages 2 0 R >>";
        const string objs2 = "<< /Type /Pages /Count 1 /Kids [3 0 R] >>";
        const string objs3 = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>";
        var objs = new[] { objs1, objs2, objs3 };
        var sb = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var i = 0; i < objs.Length; i++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(sb.ToString()));
            sb.Append($"{i + 1} 0 obj\n{objs[i]}\nendobj\n");
        }
        var xref = Encoding.ASCII.GetByteCount(sb.ToString());
        sb.Append($"xref\n0 {objs.Length + 1}\n0000000000 65535 f \n");
        foreach (var o in offsets) sb.Append($"{o:D10} 00000 n \n");
        sb.Append($"trailer\n<< /Size {objs.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(sb.ToString());
    }
}
