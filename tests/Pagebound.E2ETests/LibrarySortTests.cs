using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Die App läuft ohne ICU (InvariantGlobalization, Bean PDF-Tool-icu1). Dort
/// sortiert ein kulturabhängiger Vergleich rein ordinal — „Äpfel" landete hinter
/// „Zebra". Geprüft im veröffentlichten Build: Titel A–Z mit Umlauten.
/// </summary>
[Collection("web")]
public sealed class LibrarySortTests
{
    private readonly WebAppFixture _fx;

    public LibrarySortTests(WebAppFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task Titel_A_bis_Z_sortiert_Umlaute_beim_Grundbuchstaben()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var ctx = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions { Locale = "de-DE" });
        await ctx.AddInitScriptAsync("delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete window.showDirectoryPicker;");
        var page = await ctx.NewPageAsync();
        var errors = new List<string>();
        page.PageError += (_, e) => errors.Add(e);

        await page.GotoAsync(_fx.BaseUrl + "/reader");
        await page.Locator("main h1").First.WaitForAsync(new() { Timeout = 60_000 });
        foreach (var name in new[] { "Zebra", "Äpfel", "Birne", "Über" })
        {
            await page.Locator("input[type=file]").First.SetInputFilesAsync(new FilePayload
            {
                Name = name + ".pdf", MimeType = "application/pdf", Buffer = TitledPdf(name),
            });
            await page.GetByText(name).First.WaitForAsync(new() { Timeout = 30_000 });
        }

        await page.GotoAsync(_fx.BaseUrl + "/library");
        await page.GetByText("Zebra").First.WaitForAsync(new() { Timeout = 30_000 });
        await page.Locator("main select").First.SelectOptionAsync("TitleAsc");
        await page.WaitForTimeoutAsync(800);

        var text = await page.Locator("main").InnerTextAsync();
        int Pos(string t) => text.IndexOf(t, StringComparison.Ordinal);
        var order = new[] { "Äpfel", "Birne", "Über", "Zebra" }.OrderBy(Pos).ToArray();
        foreach (var t in new[] { "Äpfel", "Birne", "Über", "Zebra" })
            Pos(t).ShouldBeGreaterThanOrEqualTo(0, $"'{t}' fehlt in der Library");
        order.ShouldBe(new[] { "Äpfel", "Birne", "Über", "Zebra" });
        errors.ShouldBeEmpty();
        await ctx.CloseAsync();
    }

    /// <summary>Einseitige PDF mit /Title im Info-Dictionary (Library zeigt den Titel).</summary>
    private static byte[] TitledPdf(string title)
    {
        // Titel als UTF-16BE-Hexstring (mit BOM), damit Umlaute korrekt ankommen.
        var hex = "FEFF" + string.Concat(Encoding.BigEndianUnicode.GetBytes(title).Select(b => b.ToString("X2")));
        var objs = new[]
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
            $"<< /Title <{hex}> >>",
        };
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
        sb.Append($"trailer\n<< /Size {objs.Length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(sb.ToString());
    }
}
