using System.Text;
using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Teilen-Ziel (<c>share_target</c>): „Teilen → Pagebound" auf Android schickt
/// einen <c>POST /share-target</c> als NAVIGATION. Der Service Worker fängt ihn
/// ab, parkt die Datei und antwortet mit einer Umleitung auf den Reader.
///
/// Warum das hier und nicht in Node geprüft wird: der Prüfstand in
/// <c>tests-js/service-worker.test.mjs</c> ruft <c>onFetch</c> direkt auf. Er
/// kann nicht zeigen, dass der Service Worker die POST-Navigation überhaupt
/// kontrolliert, dass ein echter Browser der Umleitung auf eine Navigation
/// folgt (die Härtung aus c4b7bfb verbietet genau das für gecachte Antworten),
/// dass der Body nach <c>cache.delete</c> noch lesbar ist und dass der Reader
/// die Datei am Ende wirklich öffnet. Jeder dieser Schritte kann im Browser
/// scheitern, während alle Node-Prüfungen grün bleiben — der Vertrag verlangt
/// diese Strecke deshalb ausdrücklich (docs/contracts/datei-eintritt.md).
/// </summary>
[Collection("web")]
public sealed class ShareTargetTests
{
    private readonly WebAppFixture _fx;

    /// <summary>
    /// Die Form einer erfolgreichen Freigabe-Umleitung: <c>?share=&lt;kennung&gt;</c>
    /// mit einer UUID oder 32 Hexzeichen (Nachtrag 4.1). Bewusst streng — eine
    /// Fehlerkennung (failed/rejected/toobig) darf hier nicht durchfallen, und
    /// eine laufende Nummer ist keine Kennung mehr.
    /// </summary>
    private const string ShareKennung =
        @"^\?share=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$";

    public ShareTargetTests(WebAppFixture fx) => _fx = fx;

    /// <summary>
    /// Baut eine Seite, deren Service Worker die Kontrolle hat. Ohne Kontrolle
    /// ginge der POST an den Server, und geprüft wäre der nginx-Rückfall, nicht
    /// das Teilen-Ziel.
    /// </summary>
    private async Task<IPage> OpenControlledAsync()
    {
        var context = await _fx.Browser!.NewContextAsync();
        var page = await context.NewPageAsync();
        await page.GotoAsync(_fx.BaseUrl + "/", new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
        await page.WaitForFunctionAsync(
            """
            async () => {
              if (!('serviceWorker' in navigator)) return false;
              await navigator.serviceWorker.ready;
              return !!navigator.serviceWorker.controller;
            }
            """,
            null,
            new PageWaitForFunctionOptions { Timeout = 60_000 });
        return page;
    }

    /// <summary>
    /// Sendet die Freigabe als echte Formular-Navigation: ein
    /// <c>&lt;input type="file"&gt;</c>, über <c>DataTransfer</c> gefüllt (der
    /// einzige Weg, der im Browser erlaubt ist), und <c>form.submit()</c>.
    /// Ein <c>fetch()</c> würde zwar denselben Handler treffen, aber nicht die
    /// Navigation — und genau an der hängt die Umleitung.
    /// </summary>
    private static async Task ShareAsync(IPage page, string name, byte[] pdf)
    {
        var script = """
            ([name, b64]) => {
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const dt = new DataTransfer();
              dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
              const form = document.createElement('form');
              form.method = 'POST';
              form.action = '/share-target';
              form.enctype = 'multipart/form-data';
              const input = document.createElement('input');
              input.type = 'file';
              input.name = 'file';
              form.appendChild(input);
              document.body.appendChild(form);
              input.files = dt.files;
              form.submit();
            }
            """;
        await page.EvaluateAsync(script, new object[] { name, Convert.ToBase64String(pdf) });
    }

    [SkippableFact]
    public async Task Geteilte_PDF_landet_im_Reader_und_der_Parkplatz_ist_danach_leer()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var page = await OpenControlledAsync();

        // Die Fehlerkennung steht nur in der URL, auf die der Service Worker
        // umleitet; `boot.js` räumt sie danach per history.replaceState weg. Eine
        // Prüfung auf `location.search` konnte deshalb nicht mehr rot werden —
        // und sie sah nur `failed` an, nicht `rejected` oder `toobig`. Die
        // beobachtete Navigation ist eindeutig.
        var navigationen = new List<string>();
        page.FrameNavigated += (_, frame) =>
        {
            if (frame == page.MainFrame) navigationen.Add(frame.Url);
        };

        await ShareAsync(page, "geteilt.pdf", MinimalPdf(pageCount: 2));

        // Die Umleitung muss der Browser auf eine Navigation befolgen.
        await page.WaitForURLAsync(u => new Uri(u).AbsolutePath == "/reader", new PageWaitForURLOptions { Timeout = 30_000 });

        var ziel = navigationen.FirstOrDefault(u => new Uri(u).AbsolutePath == "/reader");
        ziel.ShouldNotBeNull("keine Navigation auf /reader beobachtet");
        // Erfolg heißt: ?share=<kennung> mit der Kennung des geparkten Eintrags
        // (Nachtrag 3.1, Form aus 4.1 — UUID oder 32 Hexzeichen). Eine
        // Fehlerkennung (failed/rejected/toobig) ist kein Erfolg, und eine leere
        // Query hieße, dass die Kennung fehlt.
        new Uri(ziel).Query.ShouldMatch(ShareKennung,
            $"der Service Worker hat die Freigabe nicht übernommen: umgeleitet auf {ziel}");

        // Der Reader öffnet die Datei: die Seitenzahl des Dokuments erscheint.
        await page.GetByText(new System.Text.RegularExpressions.Regex("(von|of) 2")).First
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });

        // Und der Parkplatz ist geleert — sonst käme die Datei bei jedem Start wieder.
        var rest = await page.EvaluateAsync<int>(
            """
            async () => {
              if (!(await caches.has('pb-share'))) return 0;
              const c = await caches.open('pb-share');
              return (await c.keys()).length;
            }
            """);
        rest.ShouldBe(0, "der Eintrag liegt noch im Freigabe-Parkplatz");
    }

    [SkippableFact]
    public async Task Geteiltes_JSON_wird_nicht_als_Entwurf_geparkt()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        var page = await OpenControlledAsync();

        // Dass am Ende nichts geparkt ist, wäre auch wahr, wenn der Service
        // Worker die Freigabe gar nicht erst angenommen hätte
        // (?share=failed/rejected) — der Test wäre dann grün, obwohl das
        // Teilen-Ziel kaputt ist. Also die Übernahme eigens belegen, und zwar an
        // der Umleitung selbst: die Kennung steht nur in der URL, auf die der
        // Worker umleitet, und boot.js räumt sie danach mit
        // history.replaceState weg. Eine Prüfung auf `location.search` gewinnt
        // oder verliert je nach Zeitpunkt; die Navigation ist eindeutig.
        //
        // Auch die Fehlermeldung taugt dafür nicht: eine ist hier RICHTIG („Das
        // ist keine PDF-Datei."), weil die Datei angekommen und zu Recht
        // abgelehnt wurde. Sie unterscheidet nicht, ob die Freigabe ankam.
        var navigationen = new List<string>();
        page.FrameNavigated += (_, frame) =>
        {
            if (frame == page.MainFrame) navigationen.Add(frame.Url);
        };

        // Ein JSON mit .pdf-Namen: früher landete es im Design-Parkplatz, der
        // Reader bekam nichts — und beim nächsten Wechsel in den Designer
        // ersetzte es dessen Dokument, ohne dass jemand es gewählt hatte.
        await ShareAsync(page, "daten.pdf", Encoding.UTF8.GetBytes("{\"version\":1,\"elements\":[]}"));
        await page.WaitForURLAsync(u => new Uri(u).AbsolutePath == "/reader", new PageWaitForURLOptions { Timeout = 30_000 });

        var ziel = navigationen.FirstOrDefault(u => new Uri(u).AbsolutePath == "/reader");
        ziel.ShouldNotBeNull("keine Navigation auf /reader beobachtet");
        // Erfolg heißt: ?share=<kennung> mit der Kennung des geparkten Eintrags
        // (Nachtrag 3.1, Form aus 4.1). Eine Fehlerkennung
        // (failed/rejected/toobig) ist kein Erfolg, und eine leere Query hieße,
        // dass die Kennung fehlt.
        new Uri(ziel).Query.ShouldMatch(ShareKennung,
            $"der Service Worker hat die Freigabe nicht übernommen: umgeleitet auf {ziel}");

        await page.WaitForFunctionAsync(
            "async () => (await pageboundBoot.pendingFileName()) === null",
            null,
            new PageWaitForFunctionOptions { Timeout = 30_000 });
        (await page.EvaluateAsync<string?>("pageboundBoot.takePendingDesign()")).ShouldBeNull();
    }

    [SkippableFact]
    public async Task Ohne_Service_Worker_leitet_der_Server_um_statt_405()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);
        // Website-Daten gelöscht, installierte App noch da: der POST landet beim
        // Server. try_files auf eine statische Datei antwortet einem POST mit
        // 405 — der Nutzer sähe eine Fehlerseite statt der App.
        //
        // Direkt über HttpClient, nicht über den Browser: so ist garantiert kein
        // Service Worker im Spiel, und genau dieser Fall soll geprüft werden.
        using var http = new HttpClient(new HttpClientHandler
        {
            AllowAutoRedirect = false,
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        });
        using var form = new MultipartFormDataContent();
        var datei = new ByteArrayContent(MinimalPdf(pageCount: 1));
        datei.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        form.Add(datei, "file", "geteilt.pdf");

        using var response = await http.PostAsync(_fx.BaseUrl + "/share-target", form);

        ((int)response.StatusCode).ShouldBe(303, $"HTTP {(int)response.StatusCode} statt 303 — der Server beantwortet den POST nicht selbst");
        response.Headers.Location!.ToString().ShouldContain("/reader");
    }

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
