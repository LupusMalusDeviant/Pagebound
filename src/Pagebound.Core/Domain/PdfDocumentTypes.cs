namespace Pagebound.Core.Domain;

/// <summary>
/// Opaque Handle für ein geladenes PDF. Renderer-spezifisch.
/// </summary>
/// <param name="Language">
/// Sprache des Dokuments als BCP-47-Kennung ("de", "en-GB") — <c>/Lang</c> aus
/// dem PDF-Katalog. <c>null</c>, wenn das Dokument sie nicht angibt, was der
/// häufigere Fall ist. Das Vorlesen braucht die Sprache des TEXTES, nicht die
/// der Oberfläche (Nachtrag 4.4 in docs/contracts/datei-eintritt.md).
/// </param>
public sealed record PdfDocumentHandle(
    string Id,
    int PageCount,
    string? Title = null,
    string? Language = null);

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
    string? RasterFormat,
    double PageWidthPt,
    double PageHeightPt);

/// <summary>
/// Ein gerendertes Seitenbild, das als URL in der Anzeige hängt — die Rasterdaten
/// liegen in der JS-Schicht, nicht im verwalteten Speicher.
/// <para>
/// <see cref="Url"/> ist eine Ressource, kein Wert: sie muss über
/// <c>IPdfRenderer.ReleasePageImageAsync</c> freigegeben werden, sobald das Bild
/// nicht mehr angezeigt wird. Siehe <c>docs/contracts/seitenbilder-speicher.md</c>.
/// </para>
/// <para>
/// <see cref="PageWidthPt"/>/<see cref="PageHeightPt"/> sind die Maße der
/// ungezoomten Seite — damit kann ein Platzhalter die richtige Höhe reservieren,
/// bevor das Bild da ist oder nachdem es verdrängt wurde.
/// </para>
/// </summary>
public sealed record PageImage(
    int PageNumber,
    string Url,
    int WidthPx,
    int HeightPx,
    double PageWidthPt,
    double PageHeightPt);

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
