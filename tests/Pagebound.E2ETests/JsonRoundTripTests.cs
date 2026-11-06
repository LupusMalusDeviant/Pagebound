using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Reflexionsbasierte System.Text.Json-Pfade im veröffentlichten (gekürzten,
/// TrimMode=partial) Build: Sprachdateien, Sidecar-Export/-Import, IndexedDB-
/// Round-Trip über die Library, Designer-JSON. Genau diese Pfade bricht Trimming,
/// wenn es zu viel entfernt (Bean PDF-Tool-asm1) — die Unit-Tests laufen
/// ungekürzt und sehen das nicht.
/// Gegenprobe beim Einführen: ein Build mit TrimMode=full fiel hier durch.
/// </summary>
[Collection("web")]
public sealed class JsonRoundTripTests
{
    private readonly WebAppFixture _fx;

    public JsonRoundTripTests(WebAppFixture fx) => _fx = fx;

    private async Task<(IBrowserContext Ctx, IPage Page, List<string> Errors)> NewPageAsync()
    {
        var ctx = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = 1400, Height = 1000 },
            AcceptDownloads = true,
        });
        // FSA-API ausblenden → InputFile-/Download-Fallbacks, die Playwright bedienen kann.
        await ctx.AddInitScriptAsync("delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete window.showDirectoryPicker;");
        var page = await ctx.NewPageAsync();
        var errors = new List<string>();
        page.Console += (_, m) => { if (m.Type == "error" || m.Text.Contains("crit:")) errors.Add(m.Text); };
        page.PageError += (_, e) => errors.Add(e);
        return (ctx, page, errors);
    }

    private async Task OpenPdfAsync(IPage page)
    {
        await page.GotoAsync(_fx.BaseUrl + "/reader");
        await page.Locator("main h1").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
        await page.Locator("input[type=file]").First.SetInputFilesAsync(new FilePayload
        {
            Name = "roundtrip.pdf", MimeType = "application/pdf", Buffer = MinimalPdf(2),
        });
        await page.GetByText(new Regex("(von|of) 2")).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
    }

    private static async Task MenuAsync(IPage page, string menu, string item)
    {
        await page.GetByRole(AriaRole.Button, new() { Name = menu, Exact = true }).First.ClickAsync();
        await page.Locator(".pb-menuitem:visible", new() { HasText = item }).First.ClickAsync();
    }

    /// <summary>Sichtbarer Teil des Seitenbilds (die Seite ist höher als das Fenster).</summary>
    private static async Task<(float X, float Y, float W, float H)> PageBoxAsync(IPage page)
    {
        var img = page.Locator("main img").First;
        await img.ScrollIntoViewIfNeededAsync();
        var b = (await img.BoundingBoxAsync())!;
        return (b.X, b.Y, b.Width, Math.Min(b.Height, 1000 - b.Y - 20));
    }

    private static async Task DrawStrokeAsync(IPage page)
    {
        await MenuAsync(page, "Zeichnen", "Stift");
        var (x, y, w, h) = await PageBoxAsync(page);
        await page.Mouse.MoveAsync(x + w * 0.3f, y + h * 0.4f);
        await page.Mouse.DownAsync();
        await page.Mouse.MoveAsync(x + w * 0.5f, y + h * 0.45f, new() { Steps = 10 });
        await page.Mouse.UpAsync();
        await page.WaitForTimeoutAsync(500);
        await page.Keyboard.PressAsync("Escape");
    }

    private static async Task<(string Path, JsonDocument Json)> ExportSidecarAsync(IPage page)
    {
        var download = await page.RunAndWaitForDownloadAsync(() => MenuAsync(page, "Export", "Sidecar speichern"));
        var path = Path.Combine(Path.GetTempPath(), $"pb-sidecar-{Guid.NewGuid():N}.json");
        await download.SaveAsAsync(path);
        return (path, JsonDocument.Parse(await File.ReadAllTextAsync(path)));
    }

    private static int[] AnnotationTypes(JsonDocument sidecar) =>
        sidecar.RootElement.GetProperty("annotations").EnumerateArray()
            .Select(a => a.GetProperty("type").GetInt32()).OrderBy(t => t).ToArray();

    [SkippableFact]
    public async Task Sprachwechsel_laedt_das_andere_Bundle_und_bleibt_nach_Reload()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var (ctx, page, errors) = await NewPageAsync();
        await page.GotoAsync(_fx.BaseUrl + "/library");
        await page.Locator("main h1").First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
        (await page.Locator("nav").First.InnerTextAsync()).ShouldContain("SAMMLUNG", Case.Insensitive);

        await page.GetByRole(AriaRole.Button, new() { Name = "Sprache umschalten" }).First.ClickAsync();
        await page.GetByText("COLLECTION", new() { Exact = false }).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 15_000 });
        await page.ReloadAsync();
        await page.GetByText("COLLECTION", new() { Exact = false }).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });

        errors.ShouldBeEmpty();
        await ctx.CloseAsync();
    }

    [SkippableFact]
    public async Task Sidecar_mit_Stift_und_getippter_Signatur_exportieren_und_in_frische_Sitzung_importieren()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        // Export: Stift-Strich + getippte Signatur (Integritäts-Hash wird serialisiert).
        var (ctx, page, errors) = await NewPageAsync();
        await OpenPdfAsync(page);
        await DrawStrokeAsync(page);
        await MenuAsync(page, "Signatur", "zeichnen / tippen");
        await page.Locator("#pb-sigpad-tab-type").ClickAsync();
        await page.Locator("#pb-sigpad-name").FillAsync("Erika Mustermann");
        await page.GetByRole(AriaRole.Button, new() { NameRegex = new Regex("Übernehmen|Use") }).ClickAsync();
        var (x, y, w, h) = await PageBoxAsync(page);
        await page.Mouse.ClickAsync(x + w * 0.6f, y + h * 0.7f);
        await page.WaitForTimeoutAsync(800);

        var (path, sidecar) = await ExportSidecarAsync(page);
        var types = AnnotationTypes(sidecar);
        types.Length.ShouldBe(2, "Stift + Signatur erwartet");
        var signature = sidecar.RootElement.GetProperty("annotations").EnumerateArray()
            .Single(a => a.GetProperty("payload").TryGetProperty("integrityHash", out _));
        signature.GetProperty("payload").GetProperty("integrityHash").GetString().ShouldNotBeNullOrWhiteSpace();
        errors.ShouldBeEmpty();
        await ctx.CloseAsync();

        // Import in eine frische Sitzung (Deserialisierung), dann erneut exportieren.
        var (ctx2, page2, errors2) = await NewPageAsync();
        await OpenPdfAsync(page2);
        await page2.GetByRole(AriaRole.Button, new() { Name = "Export", Exact = true }).First.ClickAsync();
        await page2.Locator("input[name=sidecar-import]").SetInputFilesAsync(path);
        await page2.GetByText(new Regex("Sidecar importiert: 2")).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 15_000 });
        await page2.Mouse.ClickAsync(5, 5);
        var (_, again) = await ExportSidecarAsync(page2);
        AnnotationTypes(again).ShouldBe(types);
        errors2.ShouldBeEmpty();
        await ctx2.CloseAsync();
        File.Delete(path);
    }

    [SkippableFact]
    public async Task Annotationen_ueberleben_den_Weg_ueber_IndexedDB_und_Library()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var (ctx, page, errors) = await NewPageAsync();
        await OpenPdfAsync(page);
        await DrawStrokeAsync(page);
        await page.WaitForTimeoutAsync(1500); // Autosave in IndexedDB

        await page.GotoAsync(_fx.BaseUrl + "/library");
        var entry = page.GetByText("roundtrip", new() { Exact = false }).First;
        await entry.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
        await entry.ClickAsync();
        await page.GetByText(new Regex("(von|of) 2")).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
        await page.WaitForTimeoutAsync(1500);

        var (path, sidecar) = await ExportSidecarAsync(page);
        AnnotationTypes(sidecar).Length.ShouldBe(1, "der Stift-Strich muss aus IndexedDB zurückkommen");
        errors.ShouldBeEmpty();
        await ctx.CloseAsync();
        File.Delete(path);
    }

    [SkippableFact]
    public async Task Designer_JSON_exportieren_und_wieder_importieren()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var (ctx, page, errors) = await NewPageAsync();
        await page.GotoAsync(_fx.BaseUrl + "/editor");
        await page.GetByRole(AriaRole.Button, new() { Name = "Mindmap", Exact = true }).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
        await page.GetByRole(AriaRole.Button, new() { Name = "Mindmap", Exact = true }).First.ClickAsync();
        await page.WaitForTimeoutAsync(1000);

        var download = await page.RunAndWaitForDownloadAsync(() =>
            page.GetByRole(AriaRole.Button, new() { Name = "JSON", Exact = true }).First.ClickAsync());
        var path = Path.Combine(Path.GetTempPath(), $"pb-design-{Guid.NewGuid():N}.json");
        await download.SaveAsAsync(path);
        using var json = JsonDocument.Parse(await File.ReadAllTextAsync(path));
        json.RootElement.GetProperty("pages").GetArrayLength().ShouldBeGreaterThan(0);

        // [0] Theme-Import, [1] Dokument-Import
        await page.Locator("input[type=file][accept*=json]").Nth(1).SetInputFilesAsync(path);
        await page.GetByText(new Regex("Import erfolgreich|Import successful")).First.WaitForAsync(new LocatorWaitForOptions { Timeout = 15_000 });
        errors.ShouldBeEmpty();
        await ctx.CloseAsync();
        File.Delete(path);
    }

    /// <summary>Kleinste gültige PDF mit korrekter xref-Tabelle (n leere A4-Seiten).</summary>
    private static byte[] MinimalPdf(int pageCount)
    {
        var objs = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            $"<< /Type /Pages /Count {pageCount} /Kids [{string.Join(" ", Enumerable.Range(0, pageCount).Select(i => $"{3 + i} 0 R"))}] >>",
        };
        for (var i = 0; i < pageCount; i++) objs.Add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>");
        var sb = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var i = 0; i < objs.Count; i++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(sb.ToString()));
            sb.Append($"{i + 1} 0 obj\n{objs[i]}\nendobj\n");
        }
        var xref = Encoding.ASCII.GetByteCount(sb.ToString());
        sb.Append($"xref\n0 {objs.Count + 1}\n0000000000 65535 f \n");
        foreach (var o in offsets) sb.Append($"{o:D10} 00000 n \n");
        sb.Append($"trailer\n<< /Size {objs.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(sb.ToString());
    }
}
