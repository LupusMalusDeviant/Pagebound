using Microsoft.Playwright;
using Shouldly;

namespace Pagebound.E2ETests;

/// <summary>
/// Telefon-Layout: keine waagerechte Überlaufkante, und was auf dem Schirm
/// steht, ist mit dem Finger zu treffen.
///
/// <para><b>Warum das hier steht und nicht in einem Komponententest.</b> Die
/// Größe eines Bedienelements entsteht erst im Browser — aus CSS, Flex-Layout
/// und, im Designer, aus <c>zoom</c>. Ein .NET-Test sieht davon nichts.</para>
///
/// <para><b>Das Prüfsignal gegen den Fehler, um den es geht.</b> Gemessen wird
/// <c>getBoundingClientRect</c>, nicht <c>getComputedStyle</c>. Der Designer
/// passt eine A4-Seite per <c>zoom</c> auf die Schirmbreite ein (gemessen
/// 0,442 bei 375 px); die Seiten-Kopfleiste liegt INNERHALB dieser Hülle und
/// schrumpfte dadurch auf 18 px Kantenlänge — während
/// <c>getComputedStyle</c> brav die 40 px der CSS-Regel meldete. Wer mit der
/// zweiten Methode misst, sieht genau diesen Fehler nicht.</para>
///
/// <para>Gezählt wird nur, was im Sichtfenster liegt: die Werkzeug-Schublade
/// des Designers steht im DOM, auch wenn sie zu ist, und ihre Einträge wären
/// sonst Treffer ohne Bedeutung.</para>
///
/// Plan: <c>docs/plans/2026-11-08-smartphone-layout.md</c>.
/// </summary>
[Collection("web")]
public sealed class MobileTouchTargetTests
{
    private readonly WebAppFixture _fx;

    public MobileTouchTargetTests(WebAppFixture fx) => _fx = fx;

    /// <summary>
    /// Die Untergrenze, die dieses Projekt tatsächlich zusagt.
    ///
    /// <para>Apple empfiehlt 44 pt, Google 48 dp. Pagebound setzt in Listen
    /// bewusst <b>40 px</b> (<c>.btn-side</c>, <c>.btn-fmt</c> in
    /// <c>app.src.css</c>) — eine Zeile mehr pro Schirm gegen vier Pixel
    /// Zielfläche. Werkzeugleisten und die Seiten-Kopfleiste des Designers
    /// liegen bei 44.</para>
    ///
    /// <para>Geprüft wird gegen die 40, nicht gegen die 44: ein Test, der die
    /// Hausgröße für einen Fehler hält, meldet bei jedem Lauf dasselbe und
    /// wird weggesehen. Was <b>unter</b> 40 liegt, ist dagegen durch jede
    /// Regel gefallen — genau das soll hier auffallen.</para>
    /// </summary>
    private const int MinTouchPx = 40;

    /// <summary>iPhone-X-Format — dieselbe Größe, mit der der Plan gemessen hat.</summary>
    private static readonly ViewportSize Phone = new() { Width = 375, Height = 812 };

    /// <summary>
    /// Die sichtbaren Bedienelemente einsammeln. Steht einmal da und wird für
    /// beide Messungen unten eingesetzt.
    /// </summary>
    private const string SichtbareJs = """
        const sel = 'button, a, input, select, textarea, [role=button]';
        const sichtbar = Array.from(document.querySelectorAll(sel)).filter((e) => {
          // Dieselben Ausnahmen wie die Telefon-Regeln in app.src.css:
          // Kontrollkästchen, Radios, Schieber, Farb- und Dateifelder zeichnet
          // der Browser selbst. Beim Dateifeld ist die klickbare Fläche der
          // native Knopf darin, nicht das Element — eine Mindesthöhe darauf
          // ergäbe nur toten Rand.
          if (e.tagName === 'INPUT'
              && ['checkbox', 'radio', 'range', 'color', 'file'].includes(e.type)) return false;
          const r = e.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          // Nur was wirklich im Sichtfenster steht: die Werkzeug-Schublade des
          // Designers hängt auch zugeklappt im DOM.
          return r.right > 0 && r.left < window.innerWidth
              && r.bottom > 0 && r.top < window.innerHeight;
        });
        """;

    private const string UeberlaufJs =
        "() => document.documentElement.scrollWidth - window.innerWidth";

    private const string ZahlJs = "() => { " + SichtbareJs + " return sichtbar.length; }";

    private const string ZuKleinJs = "() => { " + SichtbareJs + """
          return sichtbar
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width < 40 || r.height < 40;
            })
            .map((e) => {
              const r = e.getBoundingClientRect();
              const name = e.getAttribute('title') || e.getAttribute('aria-label')
                || (e.textContent || '').trim().slice(0, 20) || e.tagName;
              return name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
            });
        }
        """;

    private sealed record Probe(int Ueberlauf, int Sichtbar, string[] Klein);

    private async Task<Probe> MessenAsync(string route)
    {
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
            await page.GotoAsync(_fx.BaseUrl + route);
            // Blazor muss fertig sein, sonst misst man die Boot-Seite.
            await page.Locator("button, a").First.WaitForAsync(
                new LocatorWaitForOptions { Timeout = 30_000 });
            await page.WaitForTimeoutAsync(1_500);

            // Drei einzelne Auswertungen statt eines Objekts: Playwright baut
            // ein zusammengesetztes Ergebnis über Activator.CreateInstance und
            // braucht dafür einen parameterlosen Konstruktor — ein Record hat
            // keinen.
            return new Probe(
                await page.EvaluateAsync<int>(UeberlaufJs),
                await page.EvaluateAsync<int>(ZahlJs),
                await page.EvaluateAsync<string[]>(ZuKleinJs));
        }
        finally
        {
            await context.CloseAsync();
        }
    }

    [SkippableTheory]
    [InlineData("/")]
    [InlineData("/library")]
    [InlineData("/reader")]
    [InlineData("/editor")]
    [InlineData("/organize")]
    [InlineData("/split")]
    [InlineData("/batch")]
    public async Task Keine_Route_laeuft_auf_dem_Telefon_waagerecht_ueber(string route)
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var probe = await MessenAsync(route);

        probe.Ueberlauf.ShouldBeLessThanOrEqualTo(0,
            $"{route} läuft um {probe.Ueberlauf} px über die Schirmbreite hinaus");
    }

    [SkippableTheory]
    [InlineData("/")]
    [InlineData("/library")]
    [InlineData("/reader")]
    [InlineData("/editor")]
    [InlineData("/organize")]
    [InlineData("/split")]
    [InlineData("/batch")]
    public async Task Sichtbare_Bedienflaechen_sind_mindestens_fingerbreit(string route)
    {
        Skip.IfNot(_fx.Available, _fx.SkipReason);

        var probe = await MessenAsync(route);

        probe.Sichtbar.ShouldBeGreaterThan(0, $"{route} zeigt gar keine Bedienelemente — die Messung sagt dann nichts");
        probe.Klein.ShouldBeEmpty(
            $"{route}: {probe.Klein.Length} von {probe.Sichtbar} sichtbaren Zielen sind kleiner als "
            + $"{MinTouchPx} px — {string.Join(", ", probe.Klein)}");
    }
}
