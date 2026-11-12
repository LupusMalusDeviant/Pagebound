using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Telefon-Layout im Designer: der Abstand zwischen zwei Blättern muss die
/// Kopfleiste tragen, die über jedem Blatt sitzt.
///
/// <para><b>Warum das einen eigenen Test braucht.</b>
/// <c>MobileTouchTargetTests</c> misst, ob die Knöpfe der Kopfleiste
/// fingerbreit sind — und das waren sie. Dass die Leiste dabei in das Blatt
/// darüber hineinragt, sieht diese Messung strukturell nicht: sie prüft
/// Kantenlängen, nicht Abstände. Die dritte Codex-Runde fand den Fehler
/// deshalb am Code und nicht am Test (Befund 7).</para>
///
/// <para><b>Was schiefging.</b> <c>print-document.css</c> steht in
/// <c>index.html</c> NACH <c>app.css</c> und setzt dort
/// <c>.pb-zoom { gap: 40px }</c> — gleiche Spezifität, späteres Blatt, also
/// gewinnt es. Eine Medienabfrage zählt für die Spezifität nicht mit, die
/// Telefon-Regel in <c>app.src.css</c> war damit wirkungslos. Bei zoom 0,442
/// blieben rund 18 Schirm-Pixel zwischen zwei Blättern, während die
/// vergrösserte Leiste 48 braucht.</para>
///
/// <para><b>Das Prüfsignal.</b> Verglichen wird in SCHIRM-Pixeln: der
/// aufgelöste <c>row-gap</c> mal dem Zoomfaktor gegen die gemessene Höhe der
/// Kopfleiste. Nur der Vergleich sieht den Fehler — der nackte
/// <c>row-gap</c>-Wert allein sagt nichts, solange man ihn nicht gegen den
/// Zoom rechnet, und die reine Kantenlänge der Knöpfe sagt gar nichts.</para>
/// </summary>
[Collection("web")]
public sealed class MobilePageGapTests
{
    private readonly WebAppFixture _fx;

    public MobilePageGapTests(WebAppFixture fx) => _fx = fx;

    /// <summary>iPhone-X-Format — dieselbe Größe wie in <see cref="MobileTouchTargetTests"/>.</summary>
    private static readonly ViewportSize Phone = new() { Width = 375, Height = 812 };

    /// <summary>
    /// Liefert drei Zahlen als Text, durch <c>|</c> getrennt: Zoomfaktor,
    /// aufgelöster row-gap (im gezoomten Raum) und Höhe der Kopfleiste (in
    /// Schirm-Pixeln). Ein <c>-</c> steht für „Element nicht da".
    ///
    /// <para>Ein zusammengesetzter Rückgabewert ginge nicht: Playwright baut
    /// ihn über <c>Activator.CreateInstance</c> und braucht einen
    /// parameterlosen Konstruktor.</para>
    /// </summary>
    private const string MessJs = """
        () => {
          const wrap = document.querySelector('.pb-zoom');
          const head = document.querySelector('.pb-page-head');
          if (!wrap || !head) return '-|-|-';
          const cs = getComputedStyle(wrap);
          // `zoom` ist aus getComputedStyle NICHT auslesbar — deshalb schreibt
          // pageboundWysiwyg.applyZoom denselben Wert als Custom Property.
          const z = parseFloat(cs.getPropertyValue('--pb-zoom')) || 1;
          const gap = parseFloat(cs.rowGap) || 0;
          const kopf = head.getBoundingClientRect().height;
          return z + '|' + gap + '|' + kopf;
        }
        """;

    [SkippableFact]
    public async Task Der_Abstand_zwischen_den_Blaettern_traegt_die_Kopfleiste()
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var context = await _fx.Browser!.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = Phone,
            IsMobile = true,
            HasTouch = true,
            ServiceWorkers = ServiceWorkerPolicy.Block,
        });
        try
        {
            var page = await context.NewPageAsync();
            await page.GotoAsync(_fx.BaseUrl + "/editor");
            await page.Locator("button, a").First.WaitForAsync(
                new LocatorWaitForOptions { Timeout = 30_000 });
            await page.WaitForTimeoutAsync(1_500);

            var roh = await page.EvaluateAsync<string>(MessJs);
            var teile = roh.Split('|');
            teile.Length.ShouldBe(3, $"unerwartete Messung: {roh}");
            teile[0].ShouldNotBe("-", "weder .pb-zoom noch .pb-page-head gefunden — die Messung sagt dann nichts");

            var zoom = double.Parse(teile[0], System.Globalization.CultureInfo.InvariantCulture);
            var gapImZoom = double.Parse(teile[1], System.Globalization.CultureInfo.InvariantCulture);
            var kopfHoehe = double.Parse(teile[2], System.Globalization.CultureInfo.InvariantCulture);

            kopfHoehe.ShouldBeGreaterThan(0, "die Kopfleiste hat keine Höhe — dann prüft der Vergleich nichts");

            var abstandAufDemSchirm = gapImZoom * zoom;
            abstandAufDemSchirm.ShouldBeGreaterThanOrEqualTo(kopfHoehe,
                $"der Abstand zwischen zwei Blättern ist auf dem Telefon {abstandAufDemSchirm:0.0} px, "
                + $"die Kopfleiste darüber aber {kopfHoehe:0.0} px hoch — sie ragt in das Blatt davor. "
                + $"(zoom={zoom:0.000}, row-gap im gezoomten Raum={gapImZoom:0.0} px)");
        }
        finally
        {
            await context.CloseAsync();
        }
    }
}
