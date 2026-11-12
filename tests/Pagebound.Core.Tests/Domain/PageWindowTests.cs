using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

/// <summary>
/// Das Fenster der Seitenbilder (Vertrag <c>docs/contracts/seitenbilder-speicher.md</c>).
///
/// Warum das geprüft wird: der alte Reader hielt jedes gerenderte Seitenbild
/// bis zum Dateiwechsel. Diese Rechnung entscheidet, wie viele Bilder
/// gleichzeitig leben — läuft sie falsch, ist entweder der Fehler zurück
/// (alles bleibt stehen) oder die sichtbare Seite wird weggeworfen.
///
/// Das Prüfsignal: die ANZAHL und die Grenzen, nicht „sieht gut aus". Ein
/// Bildschirmfoto hätte den alten Fehler nie gefunden.
/// </summary>
public sealed class PageWindowTests
{
    /// <summary>
    /// Rückfall aus dem Codex-Review vom 2026-11-12 (Befund 13): das Fenster
    /// spannte sich über die ganze sichtbare Spanne UND beide Puffer. Drei
    /// gleichzeitig sichtbare Seiten ergaben 8..14 — sieben Bilder statt der
    /// vertraglich zugesagten fünf. Der Vertrag sagt „die sichtbare Seite plus
    /// ein Puffer in beide Richtungen (Fenster also ≤ 5)".
    /// </summary>
    [Fact]
    public void Fenster_haengt_an_einer_Seite_auch_wenn_mehrere_sichtbar_sind()
    {
        var (from, to) = PageWindow.Compute(new[] { 10, 11, 12 }, buffer: 2, pageCount: 100);

        from.ShouldBe(9);
        to.ShouldBe(13);
        (to - from + 1).ShouldBe(5);
    }

    [Fact]
    public void Fenster_bleibt_bei_fuenf_egal_wie_viele_Seiten_sichtbar_sind()
    {
        // Stark herausgezoomt: der Browser meldet acht Seiten auf einmal. Die
        // Speichergrenze steht über der Lückenlosigkeit.
        var (from, to) = PageWindow.Compute(
            new[] { 20, 21, 22, 23, 24, 25, 26, 27 }, buffer: 2, pageCount: 100);

        (to - from + 1).ShouldBe(5);
    }

    [Fact]
    public void Bei_gerader_Anzahl_sichtbarer_Seiten_ist_die_Wahl_bestimmt()
    {
        // Unterer Median: zwei sichtbare Seiten → die kleinere trägt das Fenster.
        var (from, to) = PageWindow.Compute(new[] { 10, 11 }, buffer: 2, pageCount: 100);

        from.ShouldBe(8);
        to.ShouldBe(12);
    }

    [Fact]
    public void Doppelte_Meldungen_verschieben_den_Mittelpunkt_nicht()
    {
        var once = PageWindow.Compute(new[] { 10, 11, 12 }, buffer: 2, pageCount: 100);
        var twice = PageWindow.Compute(new[] { 12, 10, 11, 11, 10, 12 }, buffer: 2, pageCount: 100);

        twice.ShouldBe(once);
    }

    [Fact]
    public void Fenster_laeuft_nicht_unter_die_erste_Seite()
    {
        var (from, to) = PageWindow.Compute(new[] { 1 }, buffer: 2, pageCount: 100);

        from.ShouldBe(1);
        to.ShouldBe(3);
    }

    [Fact]
    public void Fenster_laeuft_nicht_ueber_die_letzte_Seite()
    {
        var (from, to) = PageWindow.Compute(new[] { 100 }, buffer: 2, pageCount: 100);

        from.ShouldBe(98);
        to.ShouldBe(100);
    }

    [Fact]
    public void Ohne_sichtbare_Seiten_gibt_es_kein_Fenster()
    {
        var (from, to) = PageWindow.Compute(Array.Empty<int>(), buffer: 2, pageCount: 100);

        // From > To heißt ausdrücklich „nichts rendern" — nicht „Seite 1".
        to.ShouldBeLessThan(from);
        PageWindow.RenderOrder(from, to).ShouldBeEmpty();
    }

    [Fact]
    public void Seitenzahlen_ausserhalb_des_Dokuments_reissen_das_Fenster_nicht_auf()
    {
        // Die Meldungen kommen aus der Oberfläche; ein Rest aus einem vorigen,
        // längeren Dokument darf nicht 900 Seiten rendern lassen.
        var (from, to) = PageWindow.Compute(new[] { 0, 5, 900, -3 }, buffer: 2, pageCount: 10);

        from.ShouldBe(3);
        to.ShouldBe(7);
    }

    [Fact]
    public void Nur_ungueltige_Seitenzahlen_ergeben_kein_Fenster()
    {
        var (from, to) = PageWindow.Compute(new[] { 0, 900 }, buffer: 2, pageCount: 10);

        to.ShouldBeLessThan(from);
    }

    [Fact]
    public void Aussserhalb_liefert_genau_die_verdraengten_Seiten()
    {
        var held = new[] { 1, 2, 3, 8, 9, 10, 11 };

        PageWindow.Outside(held, from: 8, to: 10).ShouldBe(new[] { 1, 2, 3, 11 });
    }

    [Fact]
    public void Aussserhalb_ist_leer_wenn_alles_im_Fenster_liegt()
    {
        PageWindow.Outside(new[] { 8, 9, 10 }, from: 8, to: 10).ShouldBeEmpty();
    }

    [Fact]
    public void Renderreihenfolge_geht_von_der_Mitte_nach_aussen()
    {
        // Die sichtbare Seite kommt vor ihrem Puffer: wer nach unten scrollt,
        // soll nicht warten, bis zwei Seiten über ihm fertig sind.
        PageWindow.RenderOrder(from: 8, to: 12).ShouldBe(new[] { 10, 9, 11, 8, 12 });
    }

    [Fact]
    public void Renderreihenfolge_ist_bestimmt_auch_bei_gerader_Breite()
    {
        PageWindow.RenderOrder(from: 1, to: 4).ShouldBe(new[] { 2, 1, 3, 4 });
    }

    [Fact]
    public void Renderreihenfolge_einer_einzelnen_Seite()
    {
        PageWindow.RenderOrder(from: 7, to: 7).ShouldBe(new[] { 7 });
    }

    /// <summary>
    /// Die Zahl, um die es geht. Der alte Code hielt nach dem Durchscrollen
    /// eines 200-Seiten-Dokuments 200 Bilder; mit dem Fenster sind es höchstens
    /// 2·Puffer+1 — unabhängig davon, wie weit jemand scrollt.
    /// </summary>
    [Fact]
    public void Durchscrollen_haelt_hoechstens_zwei_Puffer_plus_eins()
    {
        const int pages = 200;
        const int buffer = 2;
        var held = new HashSet<int>();
        var maxHeld = 0;

        for (var current = 1; current <= pages; current++)
        {
            // Mehrere Seiten gleichzeitig im Blick — so meldet es der Browser
            // beim Scrollen wirklich. Mit nur EINER gemeldeten Seite hätte
            // dieser Test den Befund 13 strukturell nicht finden können.
            var visible = new[] { current - 1, current, current + 1 }
                .Where(p => p >= 1 && p <= pages)
                .ToArray();
            var (from, to) = PageWindow.Compute(visible, buffer, pages);
            foreach (var p in PageWindow.Outside(held, from, to)) held.Remove(p);
            foreach (var p in PageWindow.RenderOrder(from, to)) held.Add(p);
            maxHeld = Math.Max(maxHeld, held.Count);
        }

        maxHeld.ShouldBe(2 * buffer + 1);

        // Am Ende sind 199 und 200 im Blick, der untere Median ist 199 — das
        // Fenster 197..201 wird auf 197..200 beschnitten.
        held.OrderBy(p => p).ShouldBe(new[] { 197, 198, 199, 200 });
    }

    [Fact]
    public void Ein_Sprung_ans_Dokumentende_laesst_nichts_vom_Anfang_stehen()
    {
        var held = new HashSet<int> { 1, 2, 3 };

        var (from, to) = PageWindow.Compute(new[] { 200 }, buffer: 2, pageCount: 200);
        foreach (var p in PageWindow.Outside(held, from, to)) held.Remove(p);

        held.ShouldBeEmpty();
    }
}
