# Library & Workspace

## Zweck

Die Bibliothek: Dokumente werden über ihren SHA-256 identifiziert, nicht über ihren Pfad — dieselbe Datei an zwei Orten ist ein Eintrag, und eine umbenannte Datei verliert ihre Annotationen nicht. Dazu Tags, Suche, Lesefortschritt und optional ein **Workspace-Ordner** im Dateisystem, in dem die Sidecar-Dateien als sichtbares JSON neben den PDFs liegen. Ohne Workspace bleibt alles in IndexedDB; mit Workspace kann der Nutzer seine Annotationen mitnehmen und sichern.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Library/LibraryPage.razor` | Seite `/library` (`:1`): Liste, Suche, Tags, Sortierung |
| `src/Pagebound.Infrastructure/Library/LibraryService.cs` | `ILibraryService`; Index unter `library:_index` (`:24`), Einträge unter `library:entry:` (`:25`); Suche (`QueryAsync`, `:151`), Tags (`:197`), Zuletzt-geöffnet (`:217`) |
| `src/Pagebound.Infrastructure/Sidecars/JsonSidecarService.cs` | Sidecar lesen und schreiben (`SerializeAsync` `:24`, `ParseAsync` `:32`), Neuanlage (`:70`), Migration (`:101`) |
| `src/Pagebound.Infrastructure/Workspace/BrowserWorkspaceService.cs` | Workspace-Ordner über die File-System-Access-Brücke; Modul `pageboundWorkspace` (`:13`) |
| `src/Pagebound.Core/Domain/SidecarTypes.cs` | `LibraryEntryId`, `PdfMeta` (`:9`), `ReadingProgress` (`:15`), `LibraryEntry` (`:19`), `IntegrityRecord` (`:37`), `Sidecar` (`:57`) mit `CurrentSchemaVersion = "1.0"` (`:67`) |
| `src/Pagebound.Core/Domain/LibraryQuery.cs` | `LibrarySort` (`:6`) und `LibraryQuery` (`:26`), Vorgabe `LastOpenedDesc` (`:29`) |
| `src/Pagebound.Core/Text/ByteSizeFormatter.cs` | Dateigrößen sprachrichtig (Dezimalkomma je Sprache, `:31`) |
| `src/Pagebound.Core/Text/TitleComparer.cs` | Sortierung von Titeln mit Umlaut-Faltung (`Fold`, `:33`) — damit „Ärger" bei A einsortiert |
| `src/Pagebound.Web/wwwroot/js/workspace-bridge.ts` | Ordner wählen (`:100`), Sidecar schreiben (`:117`) und lesen (`:132`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Annotationen** (Typ, via `Annotation`): das Sidecar trägt die Annotationen des Dokuments — `src/Pagebound.Core/Domain/SidecarTypes.cs:64`. Siehe [`./annotationen.md`](./annotationen.md).
- **Signatur & Integrität** (Typ, via `HashAlgorithm`): der Integritätssatz im Sidecar nennt sein Verfahren — `…/SidecarTypes.cs:38`. Siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).
- **Storage & Persistenz** (Querschnitt, via `IStorageService`, `IFileHandleService`): Index, Einträge und Datei-Handles — `src/Pagebound.Infrastructure/Library/LibraryService.cs:27`. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `src/Pagebound.Web/Features/Library/LibraryPage.razor:6`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).

### Extern (Packages)

- Keine. File System Access und IndexedDB sind Browser-APIs.

## Öffentliche API / Interface

```csharp
public interface ILibraryService
{
    Task<LibraryEntry> AddOrUpdateAsync(LibraryEntry entry, CancellationToken ct);
    Task RemoveAsync(LibraryEntryId id, CancellationToken ct);
    Task<LibraryEntry?> GetAsync(LibraryEntryId id, CancellationToken ct);
    Task<LibraryEntry?> FindByHashAsync(string sha256, CancellationToken ct);   // Identität = Hash
    Task<IReadOnlyList<LibraryEntry>> QueryAsync(LibraryQuery query, CancellationToken ct);
    Task<IReadOnlyList<string>> GetAllTagsAsync(CancellationToken ct);
    Task TouchLastOpenedAsync(LibraryEntryId id, CancellationToken ct);
}

public interface ISidecarService
{
    Task<string> SerializeAsync(Sidecar sidecar, CancellationToken ct);
    Task<SidecarParseResult> ParseAsync(Stream json, CancellationToken ct);
    Task<Sidecar?> TryLoadAsync(string pdfPath, CancellationToken ct);
    Task SaveAsync(Sidecar sidecar, string pdfPath, CancellationToken ct);
    Task<Sidecar> CreateNewAsync(string pdfPath, PdfMeta meta, CancellationToken ct);
    Task<MigrationResult> MigrateAsync(Sidecar sidecar, CancellationToken ct);
}

public interface IWorkspaceService
{
    Task<bool> IsSupportedAsync(CancellationToken ct);
    Task<string?> GetWorkspaceNameAsync(CancellationToken ct);
    Task<string?> PickWorkspaceAsync(CancellationToken ct);
    Task ClearWorkspaceAsync(CancellationToken ct);
    Task<bool> SaveSidecarAsync(string pdfHash, string json, CancellationToken ct);
    Task<string?> LoadSidecarAsync(string pdfHash, CancellationToken ct);
}
```

Zwei Verträge, die leicht übersehen werden:

- `SidecarParseResult(Sidecar?, int UnknownAnnotationCount)` — ein Sidecar aus einer **neueren** Pagebound-Fassung wird gelesen, nicht abgelehnt; unbekannte Annotationen werden gezählt und gemeldet, damit die Oberfläche warnen kann, statt sie stillschweigend zu verlieren.
- `ISidecarMigration` (`ISidecarService.cs:64`) — Migrationen von einer Schemafassung zur nächsten, mit `CurrentSchemaVersion = "1.0"` als Ziel.

## Datenfluss / Call-Flow

1. Eine Datei kommt herein; der Reader bildet SHA-256 über die Bytes (`IHashService`) und fragt `FindByHashAsync` (`LibraryService.cs:136`).
2. Bekannt: der Eintrag wird geholt, `TouchLastOpenedAsync` (`:217`) setzt den Zeitpunkt, der Lesefortschritt stellt die Seite wieder her.
3. Unbekannt: `AddOrUpdateAsync` (`:36`) legt den Eintrag an und schreibt ihn zusammen mit dem Index zurück.
4. Annotationen und Integritätssätze gehen in das Sidecar (`JsonSidecarService.SerializeAsync`, `:24`).
5. Ist ein Workspace gewählt, schreibt `BrowserWorkspaceService.SaveSidecarAsync` (`:53`) die JSON über `workspace-bridge.ts:117` in den Ordner; ohne Workspace bleibt sie in IndexedDB.
6. Die Bibliotheks-Seite fragt `QueryAsync` (`:151`) mit Suchtext, Tags und Sortierung; Titel vergleicht `TitleComparer` mit Umlaut-Faltung (`TitleComparer.cs:33`), Größen formatiert `ByteSizeFormatter` sprachrichtig (`ByteSizeFormatter.cs:16`).

## Offene Fragen / TODOs

- Index und Einträge liegen getrennt (`library:_index` plus `library:entry:*`, `LibraryService.cs:24`–`25`). Bricht ein Schreibvorgang zwischen beiden ab, kann der Index auf einen fehlenden Eintrag zeigen; eine Reparatur beim Start gibt es nicht.
- `QueryAsync` lädt alle Einträge und filtert im Speicher. Bei einer sehr großen Bibliothek wird das langsam, bevor es falsch wird.
- Der Hash wird über die **ganze** Datei gebildet. Bei großen PDFs ist das ein Durchlauf über alle Bytes vor dem ersten Rendern — spürbar, aber nötig für die Identität.
