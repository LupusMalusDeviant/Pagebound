namespace Pagebound.Core.Domain;

/// <summary>
/// Mitgelieferte Standard-Designs für den Design-Ordner: fertige, thematisierte
/// Schablonen (Flyer, Postkarte, Speisekarte …), die der Nutzer per Knopfdruck
/// als <c>*.pbdesign.json</c> in seinen Ordner legen kann. Reine Daten — die
/// Factories liefern jedes Mal ein frisches Dokument (Schablonen-Semantik).
/// </summary>
public static class EditorDesignDefaults
{
    /// <summary>Ein Standard-Design: Dateiname (ohne Suffix) + Dokument-Factory.</summary>
    public sealed record DefaultDesign(string FileBaseName, Func<EditorDocument> Create);

    public static IReadOnlyList<DefaultDesign> All { get; } = new[]
    {
        new DefaultDesign("event-flyer-din-lang", EventFlyerDinLong),
        new DefaultDesign("party-flyer-dunkel", PartyFlyerDark),
        new DefaultDesign("postkarte-a6", PostcardA6),
        new DefaultDesign("speisekarte", MenuCard),
        new DefaultDesign("vereins-flyer", ClubFlyer)
    };

    // --- Bausteine (wie EditorTemplates, hier lokal gehalten) -----------------
    private static EditorBlock H(string text, int level = 1, string align = "left", int? sizePt = null) =>
        new() { Type = EditorBlockType.Heading, Text = text, Level = level, Align = align, FontSizePt = sizePt };

    private static EditorBlock P(string html, string align = "left", int? sizePt = null) =>
        new() { Type = EditorBlockType.Paragraph, Text = html, Align = align, FontSizePt = sizePt };

    private static EditorBlock Fill(string color, int heightPx) =>
        new() { Type = EditorBlockType.Shape, Shape = "rectangle", Color = color, HeightPx = heightPx, Fill = true };

    private static EditorBlock Divider() =>
        new() { Type = EditorBlockType.Shape, Shape = "divider" };

    private static EditorBlock Img(string alt, int widthPercent = 60) =>
        new() { Type = EditorBlockType.Image, Alt = alt, WidthPercent = widthPercent, Align = "center" };

    private static EditorBlock Spacer(int heightPx) =>
        new() { Type = EditorBlockType.Spacer, HeightPx = heightPx };

    private static EditorBlock Tbl(bool header, params string[][] rows) =>
        new() { Type = EditorBlockType.Table, HeaderRow = header, Rows = rows.Select(r => r.ToList()).ToList() };

    private static EditorPage Page(params EditorBlock[] blocks) => new() { Blocks = blocks.ToList() };

    private static EditorDocument Doc(string title, PageLayout layout, string themeName, params EditorPage[] pages) => new()
    {
        Title = title,
        Layout = layout,
        Theme = EditorThemes.Presets.FirstOrDefault(t => t.Name == themeName)?.Clone(),
        Pages = pages.ToList()
    };

    // --- Event-Flyer im DIN-lang-Format (klassischer Auslage-Flyer) -----------
    private static EditorDocument EventFlyerDinLong() => Doc(
        "Event-Flyer (DIN lang)", PageLayout.DinLong, "Modern",
        Page(
            Fill("#2563eb", 6),
            Spacer(12),
            H("Sommerfest 2026", 1, "center"),
            P("Musik · Essen · Mitmachaktionen", "center"),
            Spacer(8),
            Img("Veranstaltungsbild", 90),
            Spacer(8),
            P("<strong>Samstag, 18. Juli</strong><br>ab 14 Uhr · Stadtpark", "center"),
            Divider(),
            P("Eintritt frei · www.beispiel.de", "center", 9)),
        Page(
            H("Programm", 2, "center"),
            Tbl(true,
                new[] { "Zeit", "Punkt" },
                new[] { "14:00", "Eröffnung" },
                new[] { "15:30", "Live-Musik" },
                new[] { "18:00", "Tombola" }),
            Spacer(12),
            Divider(),
            P("Veranstalter · Adresse · Kontakt<br>kontakt@beispiel.de · 0123 456789", "center", 9),
            Spacer(8),
            Fill("#2563eb", 6)));

    // --- Party-Flyer (dunkel, plakativ) ---------------------------------------
    private static EditorDocument PartyFlyerDark() => Doc(
        "Party-Flyer (dunkel)", PageLayout.A4Portrait, "Dunkel",
        Page(
            Spacer(40),
            H("NACHT // KLANG", 1, "center", 44),
            Fill("#f59e0b", 4),
            Spacer(16),
            P("DJ-Line-up · Visuals · Specials", "center", 14),
            Spacer(24),
            Img("Artwork", 80),
            Spacer(24),
            P("<strong>Fr 31.10. · 23 Uhr · Halle 7</strong>", "center", 16),
            P("Tickets: www.beispiel.de · Abendkasse", "center"),
            Spacer(32),
            Fill("#f59e0b", 4)));

    // --- Postkarte A6 quer (Vorder-/Rückseite) --------------------------------
    private static EditorDocument PostcardA6() => Doc(
        "Postkarte (A6 quer)", PageLayout.A6Landscape, "Editorial",
        Page(
            Spacer(8),
            H("Liebe Grüße", 1, "center"),
            P("aus dem schönen Musterstadt", "center"),
            Spacer(8),
            Img("Motiv", 70)),
        Page(
            P("Hier ist Platz für eine persönliche Nachricht …", "left", 10),
            Spacer(24),
            Divider(),
            P("An:<br>Vorname Nachname<br>Straße 1<br>12345 Stadt", "right", 10)));

    // --- Speisekarte (elegant) -------------------------------------------------
    private static EditorDocument MenuCard() => Doc(
        "Speisekarte", PageLayout.A4Portrait, "Elegant",
        Page(
            H("Ristorante Esempio", 1, "center"),
            P("Cucina italiana · seit 1987", "center"),
            Divider(),
            Spacer(8),
            H("Antipasti", 3, "left"),
            Tbl(false,
                new[] { "Bruschetta al pomodoro", "6,50 €" },
                new[] { "Vitello tonnato", "11,00 €" }),
            Spacer(8),
            H("Primi", 3, "left"),
            Tbl(false,
                new[] { "Tagliatelle al ragù", "13,50 €" },
                new[] { "Risotto ai funghi", "14,00 €" }),
            Spacer(8),
            H("Dolci", 3, "left"),
            Tbl(false,
                new[] { "Tiramisù della casa", "6,00 €" },
                new[] { "Panna cotta", "5,50 €" }),
            Spacer(12),
            Divider(),
            P("Alle Preise inkl. MwSt. · Allergene auf Anfrage", "center", 9)));

    // --- Vereins-/Info-Flyer (frisch) ------------------------------------------
    private static EditorDocument ClubFlyer() => Doc(
        "Vereins-Flyer", PageLayout.A4Portrait, "Frisch",
        Page(
            H("SV Beispielhausen", 1, "center"),
            P("Sport · Gemeinschaft · Ehrenamt", "center"),
            Img("Vereinslogo", 40),
            Divider(),
            H("Jetzt Mitglied werden!", 2, "left"),
            P("Wir bieten Training für alle Altersgruppen, von Jugend bis Senioren. Schnuppertraining jederzeit möglich — komm einfach vorbei."),
            Tbl(true,
                new[] { "Gruppe", "Training", "Ort" },
                new[] { "Jugend", "Di 17–18:30", "Halle A" },
                new[] { "Erwachsene", "Do 19–21", "Halle A" },
                new[] { "Senioren", "Mo 10–11:30", "Halle B" }),
            Spacer(12),
            Divider(),
            P("SV Beispielhausen e. V. · www.beispiel.de · info@beispiel.de", "center", 9)));
}
