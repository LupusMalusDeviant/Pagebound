namespace Pagebound.Core.Domain;

/// <summary>
/// Sortier-Modi für die Library-Liste (FA-061).
/// </summary>
public enum LibrarySort
{
    /// <summary>Zuletzt geöffnet zuerst — Default, weil das die häufigste Wahl ist.</summary>
    LastOpenedDesc,
    /// <summary>Zuletzt hinzugefügt zuerst.</summary>
    AddedDesc,
    /// <summary>Alphabetisch nach Titel, A→Z.</summary>
    TitleAsc,
    /// <summary>Alphabetisch nach Titel, Z→A.</summary>
    TitleDesc
}

/// <summary>
/// Filter- und Sortier-Parameter für <c>ILibraryService.QueryAsync</c>.
/// </summary>
/// <param name="FullTextSearch">Optionaler Suchtext — matcht aktuell gegen Title + Filename + Tags + Author (FA-063 Volltext über Inhalt folgt mit der OCR-Iteration in 0.9).</param>
/// <param name="Tags">Wenn gesetzt: nur Einträge, die mindestens einen der Tags tragen.</param>
/// <param name="Sort">Sortierung (Default: zuletzt geöffnet zuerst).</param>
/// <param name="Skip">Paginierung-Offset.</param>
/// <param name="Take">Paginierung-Limit.</param>
public sealed record LibraryQuery(
    string? FullTextSearch = null,
    IReadOnlyList<string>? Tags = null,
    LibrarySort Sort = LibrarySort.LastOpenedDesc,
    int? Skip = null,
    int? Take = null);
