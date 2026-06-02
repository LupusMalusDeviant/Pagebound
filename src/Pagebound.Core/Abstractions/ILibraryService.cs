using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Verwaltet die persistente PDF-Bibliothek (FA-060 bis FA-064).
/// Eine Bibliothek besteht aus <see cref="LibraryEntry"/>s mit Metadaten —
/// die PDF-Bytes selbst werden in der ersten Iteration NICHT persistiert,
/// weil IndexedDB-Quota begrenzt ist. Beim Re-Öffnen wählt der Nutzer die
/// PDF erneut aus; der SHA-256-Hash sorgt dafür, dass Annotationen wieder
/// matchen. PDF-Bytes-Persistierung folgt mit File-System-Access-API.
/// </summary>
public interface ILibraryService
{
    /// <summary>
    /// Legt einen Eintrag an oder aktualisiert einen bestehenden (Match per Id ODER per Hash).
    /// Aktualisierte Felder werden in den existierenden Eintrag gemerged; konkret:
    /// LastOpenedAt + Progress + Title werden überschrieben, AddedAt bleibt erhalten.
    /// </summary>
    Task<LibraryEntry> AddOrUpdateAsync(LibraryEntry entry, CancellationToken cancellationToken);

    Task RemoveAsync(LibraryEntryId id, CancellationToken cancellationToken);

    Task<LibraryEntry?> GetAsync(LibraryEntryId id, CancellationToken cancellationToken);

    /// <summary>
    /// Sucht einen Eintrag über den SHA-256-Hash der PDF — hier landen alle
    /// "diese PDF habe ich schon mal geöffnet"-Lookups.
    /// </summary>
    Task<LibraryEntry?> FindByHashAsync(string sha256, CancellationToken cancellationToken);

    Task<IReadOnlyList<LibraryEntry>> QueryAsync(LibraryQuery query, CancellationToken cancellationToken);

    Task<IReadOnlyList<string>> GetAllTagsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Setzt <c>LastOpenedAt</c> auf jetzt — nicht-destruktive Mini-Operation,
    /// die der Reader bei jedem PDF-Open feuert.
    /// </summary>
    Task TouchLastOpenedAsync(LibraryEntryId id, CancellationToken cancellationToken);
}
