using System.Text.Json.Serialization;

namespace Pagebound.Core.Domain;

/// <summary>Ziel-Papierformat eines WYSIWYG-Dokuments (LF-02).</summary>
public enum PageLayout
{
    A4Portrait,
    A4Landscape,
    A5Portrait,
    Letter,
    Slide16x9,
    DinLong,
    A6Landscape
}

/// <summary>Block-Typen des WYSIWYG-Editors (LF-03).</summary>
public enum EditorBlockType
{
    Heading,
    Paragraph,
    Image,
    Shape,
    Table,
    Spacer,
    Columns,
    QrCode,
    Mindmap
}

/// <summary>
/// Ein Knoten eines <see cref="EditorBlockType.Mindmap"/>-Baums. Bewusst veränderlich
/// (der Baum-Editor mutiert Label/Children direkt). <see cref="Id"/> bleibt über
/// Neu-Zeichnungen stabil, damit die Auswahl im Editor erhalten bleibt.
/// </summary>
public sealed class MindmapNode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Label { get; set; } = string.Empty;
    public List<MindmapNode> Children { get; set; } = new();

    /// <summary>Tiefenkopie inkl. aller Ids (für Undo-Schnappschüsse und Block-Duplikate).</summary>
    public MindmapNode Clone() => new()
    {
        Id = Id,
        Label = Label,
        Children = Children.Select(c => c.Clone()).ToList()
    };
}

/// <summary>Typ eines frei platzierbaren Overlay-Elements.</summary>
public enum EditorOverlayType
{
    Text,
    Image,
    Shape
}

/// <summary>
/// Frei platzierbares Element über dem Block-Fluss einer Seite (Flyer-Gestaltung:
/// Text über Bildern, Sticker, Akzentflächen). Position/Größe in Prozent der
/// Seitenfläche — damit zoom-, format- und druckstabil. Reihenfolge in der Liste
/// bestimmt die Stapelung (später = oben).
/// </summary>
public sealed class EditorOverlay
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public EditorOverlayType Type { get; set; }

    public double XPercent { get; set; } = 10;
    public double YPercent { get; set; } = 10;
    public double WidthPercent { get; set; } = 40;
    /// <summary>Nur für Formen: Höhe in Prozent der Seitenhöhe (Text/Bild: automatisch).</summary>
    public double HeightPercent { get; set; } = 10;
    public int RotationDeg { get; set; }
    public int OpacityPercent { get; set; } = 100;

    // Text (Rich-Text-HTML aus contentEditable)
    public string? Text { get; set; }
    public int? FontSizePt { get; set; }
    public string Color { get; set; } = "#111827";
    public string? Background { get; set; }
    public string Align { get; set; } = "left";

    // Bild (Data-URL)
    public string? Src { get; set; }
    public string? Alt { get; set; }

    // Form
    public string Shape { get; set; } = "rectangle"; // rectangle | ellipse

    public EditorOverlay Clone() => CloneCore(Guid.NewGuid().ToString("N"));

    /// <summary>Exakte Kopie inkl. Id — für Undo-Schnappschüsse.</summary>
    public EditorOverlay Snapshot() => CloneCore(Id);

    private EditorOverlay CloneCore(string id) => new()
    {
        Id = id,
        Type = Type,
        XPercent = XPercent,
        YPercent = YPercent,
        WidthPercent = WidthPercent,
        HeightPercent = HeightPercent,
        RotationDeg = RotationDeg,
        OpacityPercent = OpacityPercent,
        Text = Text,
        FontSizePt = FontSizePt,
        Color = Color,
        Background = Background,
        Align = Align,
        Src = Src,
        Alt = Alt,
        Shape = Shape
    };
}

/// <summary>
/// Ein einzelner Inhalts-Block eines <see cref="EditorPage"/>. Bewusst eine
/// veränderliche Klasse (kein Record): der Editor bindet im UI direkt an die
/// Felder (@bind) und mutiert Blöcke beim Tippen/Formatieren. Nur die je Typ
/// relevanten Felder sind gesetzt — entspricht dem JSON-Block-Modell aus PF-04.
/// </summary>
public sealed class EditorBlock
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public EditorBlockType Type { get; set; }

    // Text (Heading: Klartext; Paragraph: Rich-Text-HTML aus contentEditable)
    public string? Text { get; set; }
    public int Level { get; set; } = 2;            // Heading 1..3
    public string Align { get; set; } = "left";    // left | center | right | justify

    // Image (lokale Datei als Data-URL eingebettet — kein externer Verweis)
    public string? Src { get; set; }
    public int WidthPercent { get; set; } = 100;
    public string? Alt { get; set; }

    // Shape (rectangle | line | divider) — HeightPx dient auch dem Spacer-Block.
    public string? Shape { get; set; }
    public string Color { get; set; } = "#1f2937";
    public int HeightPx { get; set; } = 48;
    public bool Fill { get; set; }

    // Optionale Hintergrundfarbe des Blocks (null = transparent).
    public string? Background { get; set; }

    // Optionale Schriftgröße in pt (null = automatisch je Block-Typ/Theme).
    public int? FontSizePt { get; set; }

    // Bild-Gestaltung: Eckenradius, Rahmen, Schatten (nur Image-Block).
    public int CornerRadiusPx { get; set; }
    public string? BorderColor { get; set; }
    public int BorderWidthPx { get; set; }
    public bool ShadowEnabled { get; set; }

    // Columns: Rich-Text-HTML je Spalte (2–4) + Spaltenabstand.
    public List<string>? ColumnsHtml { get; set; }
    public int ColumnGapPx { get; set; } = 16;

    // Table (Zeilen × Zellen; erste Zeile optional als Kopf)
    public List<List<string>>? Rows { get; set; }
    public bool HeaderRow { get; set; } = true;

    // Mindmap: Wurzel des bearbeitbaren Knoten-Baums. Das gerenderte Bild liegt in
    // <see cref="Src"/> (data-URL) — wird bei jeder Änderung neu gezeichnet.
    public MindmapNode? Mind { get; set; }

    // --- Datenbindung (MCP-Paket: design-data.ts) ------------------------------
    // Der MCP-Server füllt Vorlagen aus einem JSON-Objekt: {{pfad.zum.wert}},
    // bedingte Blöcke (When/Unless) und Wiederholungen (Repeat). Der Designer
    // wertet diese Felder NICHT aus — er muss sie aber unversehrt durch den
    // Lade-/Speicher-Zyklus tragen, sonst verliert das Öffnen einer Vorlage im
    // Editor still ihre Logik. WhenWritingNull: Designs ohne Datenbindung
    // bekommen dadurch keine neuen Felder.

    /// <summary>Datenpfad; der Block erscheint nur, wenn dort ein Wert steht.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? When { get; set; }

    /// <summary>Datenpfad; der Block erscheint nur, wenn dort KEIN Wert steht.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Unless { get; set; }

    /// <summary>
    /// Datenpfad einer Liste. Bei Tabellen wird die Zeile nach der Kopfzeile zur
    /// Schablone (weitere Zeilen sind Fußzeilen), andere Blöcke werden je Eintrag
    /// wiederholt.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Repeat { get; set; }

    public EditorBlock Clone() => CloneCore(Guid.NewGuid().ToString("N"));

    /// <summary>Exakte Kopie inkl. Id — für Undo-Schnappschüsse (kein Duplizieren).</summary>
    public EditorBlock Snapshot() => CloneCore(Id);

    private EditorBlock CloneCore(string id) => new()
    {
        Id = id,
        Type = Type,
        Text = Text,
        Level = Level,
        Align = Align,
        Src = Src,
        WidthPercent = WidthPercent,
        Alt = Alt,
        Shape = Shape,
        Color = Color,
        HeightPx = HeightPx,
        Fill = Fill,
        Background = Background,
        FontSizePt = FontSizePt,
        CornerRadiusPx = CornerRadiusPx,
        BorderColor = BorderColor,
        BorderWidthPx = BorderWidthPx,
        ShadowEnabled = ShadowEnabled,
        ColumnsHtml = ColumnsHtml is null ? null : new List<string>(ColumnsHtml),
        ColumnGapPx = ColumnGapPx,
        Rows = Rows?.Select(r => new List<string>(r)).ToList(),
        HeaderRow = HeaderRow,
        Mind = Mind?.Clone(),
        When = When,
        Unless = Unless,
        Repeat = Repeat
    };
}

/// <summary>
/// Eine einzelne Seite eines <see cref="EditorDocument"/> (Flyer-Vorder-/Rückseite,
/// Folien eines Decks …). Jede Seite trägt ihre eigenen Blöcke und ihren eigenen
/// Hintergrund (Farbe und/oder eingebettetes Bild als Data-URL). Das Papierformat
/// (<see cref="PageLayout"/>) ist dokumentweit, damit alle Blätter gleich groß sind.
/// </summary>
public sealed class EditorPage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    /// <summary>Optionale Hintergrundfarbe (null = weiß).</summary>
    public string? Background { get; set; }

    /// <summary>Optionales Hintergrundbild als Data-URL (null = keins).</summary>
    public string? BackgroundImage { get; set; }

    /// <summary>Einpassung des Hintergrundbilds: <c>cover</c> | <c>contain</c>.</summary>
    public string BackgroundSize { get; set; } = "cover";

    /// <summary>Deckkraft des Hintergrundbilds in Prozent (100 = voll sichtbar).</summary>
    public int BackgroundOpacityPercent { get; set; } = 100;

    /// <summary>Vertikale Ausrichtung des Hintergrundbilds: <c>top</c> | <c>center</c> | <c>bottom</c>.</summary>
    public string BackgroundPosition { get; set; } = "center";

    /// <summary>Hintergrundbild kacheln (für Muster-Grafiken). Ignoriert <see cref="BackgroundSize"/>.</summary>
    public bool BackgroundRepeat { get; set; }

    public List<EditorBlock> Blocks { get; set; } = new();

    /// <summary>Frei platzierte Elemente über dem Block-Fluss (Listenreihenfolge = Stapelung).</summary>
    public List<EditorOverlay> Overlays { get; set; } = new();

    public EditorPage Clone() => new()
    {
        Background = Background,
        BackgroundImage = BackgroundImage,
        BackgroundSize = BackgroundSize,
        BackgroundOpacityPercent = BackgroundOpacityPercent,
        BackgroundPosition = BackgroundPosition,
        BackgroundRepeat = BackgroundRepeat,
        Blocks = Blocks.Select(b => b.Clone()).ToList(),
        Overlays = Overlays.Select(o => o.Clone()).ToList()
    };

    /// <summary>Exakte Kopie inkl. Ids — für Undo-Schnappschüsse.</summary>
    public EditorPage Snapshot() => new()
    {
        Id = Id,
        Background = Background,
        BackgroundImage = BackgroundImage,
        BackgroundSize = BackgroundSize,
        BackgroundOpacityPercent = BackgroundOpacityPercent,
        BackgroundPosition = BackgroundPosition,
        BackgroundRepeat = BackgroundRepeat,
        Blocks = Blocks.Select(b => b.Snapshot()).ToList(),
        Overlays = Overlays.Select(o => o.Snapshot()).ToList()
    };
}

/// <summary>
/// Lokales WYSIWYG-Dokument (Flyer/Brief/Rechnung/Folien-Deck). Wird als JSON im
/// Browser (IndexedDB) gespeichert — 100 % lokal, kein Server (PF-04, AK-04/05).
/// Mehrseitig: <see cref="Pages"/> hält ein oder mehrere <see cref="EditorPage"/>.
/// </summary>
public sealed class EditorDocument
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = string.Empty;
    public PageLayout Layout { get; set; } = PageLayout.A4Portrait;

    /// <summary>Optionales Gestaltungs-Theme (Schriften/Farben, dokumentweit). Null = Standard.</summary>
    public EditorTheme? Theme { get; set; }

    public List<EditorPage> Pages { get; set; } = new();

    // --- Legacy (vor Multi-Page) — nur fürs Migrieren alter Entwürfe -----------
    // Frühere Dokumente hatten Blöcke und einen Hintergrund direkt am Dokument.
    // Beim Laden hebt Migrate() sie in eine erste Seite. Beim Speichern werden sie
    // auf null gesetzt und (WhenWritingNull) nicht mehr geschrieben.
    [JsonPropertyName("blocks"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<EditorBlock>? LegacyBlocks { get; set; }

    [JsonPropertyName("background"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LegacyBackground { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public static EditorDocument NewEmpty(string title, PageLayout layout = PageLayout.A4Portrait) => new()
    {
        Title = title,
        Layout = layout,
        Pages = { new EditorPage() }
    };

    /// <summary>
    /// Hebt ein altes (einseitiges) Dokument auf das Multi-Page-Modell: hatte es
    /// keine <see cref="Pages"/>, aber Legacy-Blöcke/-Hintergrund, werden diese in
    /// eine erste Seite überführt. Stellt außerdem sicher, dass mindestens eine
    /// Seite existiert. Idempotent.
    /// </summary>
    public EditorDocument Migrate()
    {
        if (Pages.Count == 0)
        {
            Pages.Add(new EditorPage
            {
                Background = LegacyBackground,
                Blocks = LegacyBlocks ?? new List<EditorBlock>()
            });
        }
        LegacyBlocks = null;
        LegacyBackground = null;
        return this;
    }

    /// <summary>
    /// Exakte Tiefenkopie inkl. aller Ids — Grundlage des Undo/Redo-Verlaufs.
    /// Günstig trotz eingebetteter Bilder: Strings (Data-URLs) werden als
    /// Referenzen geteilt, nicht kopiert.
    /// </summary>
    public EditorDocument Snapshot() => new()
    {
        Id = Id,
        Title = Title,
        Layout = Layout,
        Theme = Theme?.Clone(),
        Pages = Pages.Select(p => p.Snapshot()).ToList(),
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt
    };
}

/// <summary>Kurzinfo eines gespeicherten Entwurfs für Listen (ohne Block-Inhalt).</summary>
public sealed record EditorDraftInfo(
    string Id,
    string Title,
    PageLayout Layout,
    DateTimeOffset UpdatedAt);
