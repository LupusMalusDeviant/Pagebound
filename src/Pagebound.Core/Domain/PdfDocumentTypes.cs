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

public sealed record SearchHit(
    int PageNumber,
    int Position,
    string Match,
    TextItem[] TextItems);

public sealed record PdfOutline(IReadOnlyList<PdfOutlineEntry> Entries);

public sealed record PdfOutlineEntry(
    string Title,
    int? PageNumber,
    IReadOnlyList<PdfOutlineEntry> Children);
