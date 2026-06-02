namespace Pagebound.Core.Domain;

/// <summary>
/// Vordefinierte, lokale Dokument-Vorlagen (LF-04): Rechnung (Kleinunternehmer
/// §19 UStG), Geschäftsbrief nach DIN 5008, Flyer (Vorder- + Rückseite) und
/// 16:9-Folie. Reine Daten — keine UI-Abhängigkeit, damit gut testbar und
/// wiederverwendbar.
/// </summary>
public static class EditorTemplates
{
    public enum TemplateKind { Blank, Invoice, Letter, Flyer, Slide }

    public static EditorDocument Create(TemplateKind kind) => kind switch
    {
        TemplateKind.Invoice => Invoice(),
        TemplateKind.Letter => Letter(),
        TemplateKind.Flyer => Flyer(),
        TemplateKind.Slide => Slide(),
        _ => EditorDocument.NewEmpty("Unbenanntes Dokument")
    };

    private static EditorBlock H(string text, int level = 1, string align = "left") =>
        new() { Type = EditorBlockType.Heading, Text = text, Level = level, Align = align };

    private static EditorBlock P(string html, string align = "left") =>
        new() { Type = EditorBlockType.Paragraph, Text = html, Align = align };

    private static EditorBlock Divider() =>
        new() { Type = EditorBlockType.Shape, Shape = "divider" };

    private static EditorBlock Rect(string color, int heightPx) =>
        new() { Type = EditorBlockType.Shape, Shape = "rectangle", Color = color, HeightPx = heightPx };

    private static EditorBlock Img(string alt) =>
        new() { Type = EditorBlockType.Image, Alt = alt, WidthPercent = 60, Align = "center" };

    private static EditorBlock Spacer(int heightPx) =>
        new() { Type = EditorBlockType.Spacer, HeightPx = heightPx };

    private static EditorBlock Tbl(bool header, params string[][] rows) =>
        new() { Type = EditorBlockType.Table, HeaderRow = header, Rows = rows.Select(r => r.ToList()).ToList() };

    private static EditorPage Page(params EditorBlock[] blocks) =>
        new() { Blocks = blocks.ToList() };

    private static EditorDocument Doc(string title, PageLayout layout, params EditorPage[] pages) =>
        new() { Title = title, Layout = layout, Pages = pages.ToList() };

    // --- Rechnung (Kleinunternehmer §19 UStG) --------------------------------
    private static EditorDocument Invoice() => Doc(
        "Rechnung", PageLayout.A4Portrait,
        Page(
            P("Max Mustermann · Musterstraße 1 · 12345 Musterstadt", "left"),
            P("<br>Firma Kundenname GmbH<br>Frau/Herr Vorname Nachname<br>Kundenstraße 2<br>54321 Kundenstadt"),
            P("Musterstadt, 01.06.2026", "right"),
            H("Rechnung LMD-2026-0001", 1),
            P("Sehr geehrte Damen und Herren,<br>vielen Dank für Ihren Auftrag. Wir berechnen Ihnen die folgenden Leistungen:"),
            Tbl(true,
                new[] { "Pos.", "Beschreibung", "Menge", "Einzelpreis", "Gesamt" },
                new[] { "1", "Leistung / Artikel", "1", "0,00 €", "0,00 €" },
                new[] { "2", "Weitere Position", "1", "0,00 €", "0,00 €" }),
            P("<strong>Gesamtbetrag: 0,00 €</strong>", "right"),
            P("Gemäß § 19 UStG wird keine Umsatzsteuer ausgewiesen (Kleinunternehmerregelung)."),
            Divider(),
            P("Zahlbar innerhalb von 14 Tagen ohne Abzug auf folgendes Konto:<br>Bank · IBAN DE00 0000 0000 0000 0000 00 · BIC XXXXXXXX")));

    // --- Geschäftsbrief nach DIN 5008 ----------------------------------------
    private static EditorDocument Letter() => Doc(
        "Geschäftsbrief", PageLayout.A4Portrait,
        Page(
            P("Max Mustermann · Musterstraße 1 · 12345 Musterstadt", "left"),
            P("<br>Firma Empfänger GmbH<br>Frau/Herr Vorname Nachname<br>Empfängerstraße 2<br>54321 Empfängerstadt"),
            P("Musterstadt, 01.06.2026", "right"),
            H("Betreff: Ihr Anliegen", 3),
            P("Sehr geehrte Damen und Herren,"),
            P("hier steht der Text Ihres Schreibens. Dieser Absatz lässt sich frei bearbeiten und nach DIN 5008 formatieren. Fügen Sie weitere Absätze, Tabellen oder Bilder über die Werkzeugleiste hinzu."),
            P("Mit freundlichen Grüßen"),
            P("<br><br>Max Mustermann")));

    // --- Flyer (Vorder- + Rückseite) -----------------------------------------
    private static EditorDocument Flyer() => Doc(
        "Flyer", PageLayout.A4Portrait,
        Page( // Vorderseite
            H("Veranstaltungstitel", 1, "center"),
            P("Ein einprägsamer Untertitel oder Slogan", "center"),
            Img("Bild / Logo hier einfügen"),
            P("Beschreiben Sie kurz und prägnant, worum es geht. Was, wann, wo — die wichtigsten Informationen auf einen Blick.", "center"),
            Divider(),
            P("📅 Datum · 🕒 Uhrzeit · 📍 Ort<br>www.beispiel.de · kontakt@beispiel.de", "center")),
        Page( // Rückseite
            H("Programm & Details", 2, "center"),
            P("Hier ist Platz für das ausführliche Programm, den Ablauf oder weitere Informationen zur Veranstaltung."),
            Tbl(true,
                new[] { "Uhrzeit", "Programmpunkt" },
                new[] { "10:00", "Begrüßung" },
                new[] { "11:00", "Hauptprogramm" },
                new[] { "14:00", "Ausklang" }),
            Spacer(24),
            Divider(),
            P("Anfahrt, Kontakt & Anmeldung<br>www.beispiel.de · kontakt@beispiel.de · 0123 456789", "center")));

    // --- 16:9-Folien-Deck ----------------------------------------------------
    private static EditorDocument Slide() => Doc(
        "Präsentation", PageLayout.Slide16x9,
        Page( // Titelfolie
            H("Titel der Präsentation", 1, "center"),
            Rect("#2563eb", 4),
            P("Untertitel · Referent · Datum", "center")),
        Page( // Inhaltsfolie
            H("Agenda", 2, "left"),
            P("• Punkt eins<br>• Punkt zwei<br>• Punkt drei")));
}
