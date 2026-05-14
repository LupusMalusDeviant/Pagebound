namespace Pagebound.Core.Domain;

/// <summary>
/// Opaque Handle für ein geladenes PDF. Renderer-spezifisch.
/// </summary>
public sealed record PdfDocumentHandle(string Id, int PageCount, string? Title = null);

public sealed record LoadOptions(string? Password = null);

public sealed record RenderOptions(
    double Scale = 1.0,
    int? RotationDegrees = null,
    bool HighDpi = true);

public sealed record RenderedPage(
    int PageNumber,
    int WidthPx,
    int HeightPx,
    byte[]? RasterBytes,
    string? RasterFormat);

public sealed record TextItem(
    string Text,
    double X,
    double Y,
    double Width,
    double Height);

public sealed record SearchOptions(
    bool MatchCase = false,
    bool WholeWord = false);

/// <summary>
/// Ein Treffer aus der PDF-Volltext-Suche. Snippet ist ein kurzer Text-Auszug
/// um den Treffer herum (für UI-Vorschau); SnippetMatchStart markiert, wo
/// innerhalb des Snippets der eigentliche Match beginnt — die Länge entspricht
/// <c>Match.Length</c>. Item-genaue Highlight-Rechtecke kommen in einer
/// späteren Iteration (FA-005-Polish + FA-010 Highlight-Overlays).
/// </summary>
public sealed record SearchHit(
    int PageNumber,
    int Position,
    string Match,
    string Snippet,
    int SnippetMatchStart);

public sealed record PdfOutline(IReadOnlyList<PdfOutlineEntry> Entries);

public sealed record PdfOutlineEntry(
    string Title,
    int? PageNumber,
    IReadOnlyList<PdfOutlineEntry> Children);
