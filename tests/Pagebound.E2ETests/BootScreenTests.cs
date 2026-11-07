using System.Text;
using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Boot-Bildschirm (wwwroot/js/boot.js): Eine PDF, die abgelegt wird, BEVOR die
/// WASM-Laufzeit bereit ist, muss danach im Reader offen sein. Damit das kein
/// Wettrennen gegen einen schnellen localhost-Boot ist, hält der Test das
/// Blazor-Startskript an, bis die Datei übergeben wurde.
/// </summary>
[Collection("web")]
public sealed class BootScreenTests
{
    private readonly WebAppFixture _fx;

    public BootScreenTests(WebAppFixture fx) => _fx = fx;

    private async Task<(IPage Page, TaskCompletionSource Release)> OpenWithHeldBootAsync()
    {
        var context = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { ServiceWorkers = ServiceWorkerPolicy.Block });
        var page = await context.NewPageAsync();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await page.RouteAsync("**/_framework/blazor.webassembly*.js", async route =>
        {
            await release.Task;
            await route.ContinueAsync();
        });
        await page.GotoAsync(_fx.BaseUrl + "/", new PageGotoOptions { WaitUntil = WaitUntilState.Commit });
        await page.Locator("#pb-boot-drop").WaitForAsync(new LocatorWaitForOptions { Timeout = 15_000 });
        return (page, release);
    }

    [SkippableFact]
    public async Task Vor_dem_Boot_abgelegte_PDF_ist_danach_im_Reader_offen()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var (page, release) = await OpenWithHeldBootAsync();

        await page.Locator("#pb-boot-file").SetInputFilesAsync(new FilePayload
        {
            Name = "boot.pdf",
            MimeType = "application/pdf",
            Buffer = MinimalPdf(pageCount: 2),
        });
        // Die Prüfung (MIME + Magic-Bytes) ist asynchron — auf ihr Ergebnis warten.
        // pendingFileName() liefert ein Promise (es wartet auf die Abholung aus
        // dem Freigabe-Parkplatz, siehe docs/contracts/datei-eintritt.md,
        // Nachtrag 1). Ein Vergleich mit dem Promise selbst wird NIE wahr —
        // deshalb auflösen, bevor verglichen wird.
        await page.WaitForFunctionAsync(
            "async () => (await pageboundBoot.pendingFileName()) === 'boot.pdf'",
            null,
            new PageWaitForFunctionOptions { Timeout = 10_000 });
        (await page.Locator("#pb-boot-drop-sub").TextContentAsync()).ShouldContain("boot.pdf");
        (await page.EvaluateAsync<string>("location.pathname")).ShouldBe("/reader");

        release.SetResult();
        await page.Locator("#pb-boot").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Detached, Timeout = 60_000 });
        await page.GetByText(new System.Text.RegularExpressions.Regex("(von|of) 2")).First
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
    }

    [SkippableFact]
    public async Task Nicht_PDF_wird_auf_dem_Boot_Bildschirm_abgewiesen()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var (page, release) = await OpenWithHeldBootAsync();

        await page.Locator("#pb-boot-file").SetInputFilesAsync(new FilePayload
        {
            Name = "fake.pdf",
            MimeType = "application/pdf",
            Buffer = Encoding.ASCII.GetBytes("Hallo, ich bin keine PDF."),
        });

        // Die Prüfung (MIME + Magic-Bytes) ist asynchron — auf ihr Ergebnis warten.
        await page.WaitForFunctionAsync("() => document.getElementById('pb-boot-drop-sub').classList.contains('is-error')", null, new PageWaitForFunctionOptions { Timeout = 10_000 });
        (await page.EvaluateAsync<string>("location.pathname")).ShouldBe("/");
        (await page.EvaluateAsync<string?>("pageboundBoot.pendingFileName()")).ShouldBeNull();
        release.SetResult();
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
