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
    Table
}

/// <summary>
/// Ein einzelner Inhalts-Block eines <see cref="EditorDocument"/>. Bewusst eine
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

    // Shape (rectangle | line | divider)
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
/// Lokales WYSIWYG-Dokument (Flyer/Brief/Rechnung/Folie). Wird als JSON im
/// Browser (IndexedDB) gespeichert — 100 % lokal, kein Server (PF-04, AK-04/05).
/// </summary>
public sealed class EditorDocument
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = string.Empty;
    public PageLayout Layout { get; set; } = PageLayout.A4Portrait;
    /// <summary>Optionale Seiten-Hintergrundfarbe (null = weiß).</summary>
    public string? Background { get; set; }
    public List<EditorBlock> Blocks { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public static EditorDocument NewEmpty(string title, PageLayout layout = PageLayout.A4Portrait) => new()
    {
        Title = title,
        Layout = layout
    };
}

/// <summary>Kurzinfo eines gespeicherten Entwurfs für Listen (ohne Block-Inhalt).</summary>
public sealed record EditorDraftInfo(
    string Id,
    string Title,
    PageLayout Layout,
    DateTimeOffset UpdatedAt);
