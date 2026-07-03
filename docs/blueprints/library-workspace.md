# Library & Workspace

## Zweck

Persistente PDF-Bibliothek mit Metadaten, Tags, Suche und Sortierung (FA-060 bis FA-064). Ein Library-Eintrag wird über den SHA-256-Hash der PDF identifiziert, sodass Annotationen beim Wiederöffnen zuverlässig matchen. Für One-Click-Wiederöffnen werden File-Handles der File-System-Access-API persistiert (Chromium); als Fallback dienen in IndexedDB gecachte PDF-Bytes bzw. der klassische File-Picker.

Ergänzend verwaltet der Workspace einen optionalen zentralen Ordner für Sidecar-Dateien (FA-070 bis FA-074): Annotationen & Metadaten liegen als `{pdfHash}.pagebound.json` neben der PDF oder im Workspace-Ordner und werden beim Öffnen automatisch gefunden (FA-073). Auf Browsern ohne File-System-Access-API (Firefox/Safari) fällt alles auf einen Download/Upload-Flow zurück.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/ILibraryService.cs` | Interface der Bibliothek (Add/Update, Query, Tag-Liste, TouchLastOpened) |
| `src/Pagebound.Core/Domain/LibraryQuery.cs` | Filter-/Sortier-Parameter (`LibraryQuery`, `LibrarySort`) |
| `src/Pagebound.Core/Abstractions/ISidecarService.cs` | Sidecar-Persistenz inkl. Schema-Migration (`ISidecarMigration`) |
| `src/Pagebound.Core/Domain/SidecarTypes.cs` | Sidecar-Domänentypen (`Sidecar`, `PdfMeta`, …) |
| `src/Pagebound.Core/Abstractions/IWorkspaceService.cs` | Interface für den zentralen Sidecar-Workspace-Ordner |
| `src/Pagebound.Infrastructure/Library/LibraryService.cs` | Library-Implementierung über `IStorageService` |
| `src/Pagebound.Infrastructure/Sidecars/JsonSidecarService.cs` | JSON-Serialisierung/Parsing/Migration der Sidecars |
| `src/Pagebound.Infrastructure/Workspace/BrowserWorkspaceService.cs` | Workspace via `showDirectoryPicker` + persistiertem Directory-Handle |
| `src/Pagebound.Infrastructure/Storage/FileSystemAccessHandleService.cs` | Persistente File-Handles (`pdf:handle:{hash}`) für Reopen ohne Picker |
| `src/Pagebound.Web/Features/Library/LibraryPage.razor` | Bibliotheks-UI (Liste, Suche, Tags, Sortierung, Reopen) |
| `src/Pagebound.Web/wwwroot/js/workspace-bridge.ts` | JS-Bridge: Directory-Picker, Sidecar-Lesen/Schreiben im Workspace |
| `src/Pagebound.Web/wwwroot/js/file-handle-bridge.ts` | JS-Bridge: File-Picker, Handle-Persistenz, Permission-Re-Prompt |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Storage & Persistenz** — Library-Einträge, PDF-Bytes-Cache (`pdf:bytes:{hash}`) und File-/Directory-Handles landen in IndexedDB. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **PDF-Reader** — feuert `TouchLastOpenedAsync` bei jedem Öffnen und nutzt `IFileHandleService` zur Auswahl zwischen FSA-Picker und Standard-InputFile. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Annotationen** — Sidecars transportieren die Annotationsdaten; das Hash-Matching der Library stellt die Zuordnung sicher. Siehe [`./annotationen.md`](./annotationen.md).
- **Signatur & Integrität** — SHA-256-Hashing (`IHashService`) identifiziert PDFs eindeutig. Siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).
- **Lokalisierung, Theme & UI-Shell** — sämtliche UI-Texte der LibraryPage via `L.T()`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).

### Extern (Packages)

- File System Access API (Browser, Chromium-only für Picker/Handles — kein npm-Paket)

## Öffentliche API / Interface

```csharp
public interface ILibraryService
{
    Task<LibraryEntry> AddOrUpdateAsync(LibraryEntry entry, CancellationToken ct); // Merge per Id ODER Hash
    Task RemoveAsync(LibraryEntryId id, CancellationToken ct);
    Task<LibraryEntry?> GetAsync(LibraryEntryId id, CancellationToken ct);
    Task<LibraryEntry?> FindByHashAsync(string sha256, CancellationToken ct);
    Task<IReadOnlyList<LibraryEntry>> QueryAsync(LibraryQuery query, CancellationToken ct);
    Task<IReadOnlyList<string>> GetAllTagsAsync(CancellationToken ct);
    Task TouchLastOpenedAsync(LibraryEntryId id, CancellationToken ct);
}

public sealed record LibraryQuery(
    string? FullTextSearch = null,          // matcht Title + Filename + Tags + Author
    IReadOnlyList<string>? Tags = null,
    LibrarySort Sort = LibrarySort.LastOpenedDesc,
    int? Skip = null, int? Take = null);

public interface IWorkspaceService
{
    Task<bool> IsSupportedAsync(CancellationToken ct);      // showDirectoryPicker verfügbar?
    Task<string?> GetWorkspaceNameAsync(CancellationToken ct);
    Task<string?> PickWorkspaceAsync(CancellationToken ct);
    Task ClearWorkspaceAsync(CancellationToken ct);
    Task<bool> SaveSidecarAsync(string pdfHash, string json, CancellationToken ct);
    Task<string?> LoadSidecarAsync(string pdfHash, CancellationToken ct);
}

public interface ISidecarService
{
    Task<string> SerializeAsync(Sidecar sidecar, CancellationToken ct);
    Task<Sidecar?> ParseAsync(Stream json, CancellationToken ct);
    Task<Sidecar?> TryLoadAsync(string pdfPath, CancellationToken ct);   // Desktop-Hosts
    Task SaveAsync(Sidecar sidecar, string pdfPath, CancellationToken ct);
    Task<Sidecar> CreateNewAsync(string pdfPath, PdfMeta meta, CancellationToken ct);
    Task<MigrationResult> MigrateAsync(Sidecar sidecar, CancellationToken ct);
}
```

## Datenfluss / Call-Flow

1. **PDF öffnen:** Reader hasht die Bytes (SHA-256) → `FindByHashAsync` → Treffer: `TouchLastOpenedAsync` + Fortschritt/Annotationen wiederherstellen; kein Treffer: `AddOrUpdateAsync` legt neuen Eintrag an.
2. **Reopen aus der Library:** `LibraryPage` → `IFileHandleService.TryReopenAsync(hash)` (`file-handle-bridge.ts` reaktiviert das persistierte `FileSystemFileHandle`, schmaler Permission-Dialog) → Fallback: `IStorageService.GetBytesAsync("pdf:bytes:{hash}")` → letzter Fallback: File-Picker.
3. **Sidecar speichern:** Annotationsänderung → `ISidecarService.SerializeAsync` → bei gesetztem Workspace `IWorkspaceService.SaveSidecarAsync(hash, json)` (`workspace-bridge.ts` schreibt `{pdfHash}.pagebound.json`); sonst Download-Flow.
4. **Sidecar laden:** Beim Öffnen `LoadSidecarAsync(hash)` → `ParseAsync` → bei Schema-Abweichung `MigrateAsync` über registrierte `ISidecarMigration`s.
5. **Suche/Filter:** `LibraryPage` baut `LibraryQuery` (Suchtext, Tags, Sortierung, Paging) → `QueryAsync`.

## Offene Fragen / TODOs

- Volltextsuche über PDF-*Inhalt* (FA-063) folgt mit der OCR-Iteration; aktuell matcht `FullTextSearch` nur Title/Filename/Tags/Author.
- Firefox/Safari: keine persistenten Handles und kein Workspace — dauerhafter Fallback auf Bytes-Cache bzw. Download/Upload dokumentieren.
