using System.Text.Json.Serialization;

namespace Pagebound.Core.Domain;

/// <summary>Ziel-Papierformat eines WYSIWYG-Dokuments (LF-02).</summary>
public enum PageLayout
{
    A4Portrait,
    A4Landscape,
    A5Portrait,
    Letter,
    Slide16x9
}

/// <summary>Block-Typen des WYSIWYG-Editors (LF-03).</summary>
public enum EditorBlockType
{
    Heading,
    Paragraph,
    Image,
    Shape,
    Table,
    Spacer
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

    // Table (Zeilen × Zellen; erste Zeile optional als Kopf)
    public List<List<string>>? Rows { get; set; }
    public bool HeaderRow { get; set; } = true;

    public EditorBlock Clone() => new()
    {
        Id = Guid.NewGuid().ToString("N"),
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
        Rows = Rows?.Select(r => new List<string>(r)).ToList(),
        HeaderRow = HeaderRow
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

    public List<EditorBlock> Blocks { get; set; } = new();

    public EditorPage Clone() => new()
    {
        Background = Background,
        BackgroundImage = BackgroundImage,
        BackgroundSize = BackgroundSize,
        Blocks = Blocks.Select(b => b.Clone()).ToList()
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
}

/// <summary>Kurzinfo eines gespeicherten Entwurfs für Listen (ohne Block-Inhalt).</summary>
public sealed record EditorDraftInfo(
    string Id,
    string Title,
    PageLayout Layout,
    DateTimeOffset UpdatedAt);
