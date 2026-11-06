using System.Globalization;
using Pagebound.Core.Text;
using Shouldly;

namespace Pagebound.Core.Tests.Text;

/// <summary>
/// Die App läuft mit InvariantGlobalization (Bean PDF-Tool-icu1). Sortierung und
/// Größenanzeige dürfen deshalb nicht von der Kultur abhängen. Diese Tests laufen
/// in der CI zusätzlich mit DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 — wie im Browser.
/// </summary>
public sealed class TextFormattingTests
{
    private static string[] Sorted(params string[] titles) => titles.OrderBy(t => t, TitleComparer.Instance).ToArray();

    [Fact]
    public void Umlaute_stehen_beim_Grundbuchstaben_nicht_hinter_Z()
    {
        Sorted("Zebra", "Äpfel", "Birne", "Öl", "Ufer", "Über", "Apfel")
            .ShouldBe(new[] { "Apfel", "Äpfel", "Birne", "Öl", "Über", "Ufer", "Zebra" });
    }

    [Fact]
    public void Gross_und_Kleinschreibung_ist_egal()
    {
        Sorted("banane", "Apfel", "cITRONE").ShouldBe(new[] { "Apfel", "banane", "cITRONE" });
    }

    [Fact]
    public void Eszett_zaehlt_wie_ss_und_Akzente_wie_Grundbuchstaben()
    {
        Sorted("Strasse", "Straße", "Strand").ShouldBe(new[] { "Strand", "Strasse", "Straße" });
        Sorted("Eclair", "Église", "Ecke", "Élan").ShouldBe(new[] { "Ecke", "Eclair", "Église", "Élan" });
    }

    [Fact]
    public void Reihenfolge_ist_total_und_stabil()
    {
        TitleComparer.Instance.Compare("Äpfel", "Apfel").ShouldBeGreaterThan(0);
        TitleComparer.Instance.Compare("apfel", "Apfel").ShouldNotBe(0);
        TitleComparer.Instance.Compare(null, "a").ShouldBeLessThan(0);
        TitleComparer.Instance.Compare("x", "x").ShouldBe(0);
    }

    [Theory]
    [InlineData("tr-TR")] // berüchtigt: i/İ
    [InlineData("de-DE")]
    [InlineData("en-US")]
    public void Ergebnis_haengt_nicht_von_der_aktuellen_Kultur_ab(string culture)
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            try { CultureInfo.CurrentCulture = new CultureInfo(culture); }
            catch (CultureNotFoundException) { return; } // invarianter Modus: es gibt nur eine Kultur
            Sorted("ılık", "Istanbul", "iglu", "Zebra", "Äpfel")
                .ShouldBe(new[] { "Äpfel", "iglu", "ılık", "Istanbul", "Zebra" });
            ByteSizeFormatter.Format(1_572_864, "en").ShouldBe("1.5 MB");
            ByteSizeFormatter.Format(1_572_864, "de").ShouldBe("1,5 MB");
        }
        finally { CultureInfo.CurrentCulture = before; }
    }

    [Theory]
    [InlineData(0, "de", "0 B")]
    [InlineData(1023, "de", "1023 B")]
    [InlineData(1024, "de", "1 KB")]
    [InlineData(524_288, "en", "512 KB")]
    [InlineData(1_572_864, "de", "1,5 MB")]
    [InlineData(1_572_864, "en", "1.5 MB")]
    [InlineData(1_572_864, null, "1.5 MB")]
    [InlineData(5_637_144_576, "de", "5,25 GB")]
    [InlineData(-5, "de", "0 B")]
    public void Dateigroessen_folgen_der_App_Sprache(long bytes, string? lang, string expected)
    {
        ByteSizeFormatter.Format(bytes, lang).ShouldBe(expected);
    }
}
