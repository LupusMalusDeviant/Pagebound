# Designer (WYSIWYG)

## Zweck

Ein Block-Editor, mit dem der Nutzer selbst Dokumente baut — Flyer, Briefe, Rechnungen, Folien — und als PDF ausgibt. Vorlagen, Themes, Seitenformate, Serienbriefe aus CSV, QR-Codes und Mindmaps. Das ist das einzige Feature, das ein PDF **erzeugt** statt es zu bearbeiten, und der Grund, warum pdf-lib und fontkit ohnehin im Bündel liegen.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Editor/DesignerPage.razor` | Routen `/editor` und `/editor/{Id}` (`:1`–`2`); die ganze Oberfläche in 2635 Zeilen: Blockliste, Werkzeugleisten, Eigenschaften, Vorschau, Export |
| `src/Pagebound.Infrastructure/Editor/EditorDraftService.cs` | Entwürfe unter `editor:doc:` (`:14`) im Key-Value-Speicher; auflisten (`:25`), laden (`:39`), speichern (`:45`), löschen (`:56`) |
| `src/Pagebound.Infrastructure/Editor/BrowserDesignFolderService.cs` | Ein Ordner im Dateisystem für Entwürfe als sichtbare JSON-Dateien |
| `src/Pagebound.Core/Domain/EditorDocument.cs` | Das Dokumentmodell: `PageLayout` (`:6`), `EditorBlockType` (`:18`), `MindmapNode` (`:36`), `EditorOverlayType` (`:52`), `EditorOverlay` (`:65`), `EditorBlock` (`:124`), `EditorPage` (`:235`), `EditorDocument` (`:294`), `EditorDraftInfo` (`:364`) |
| `src/Pagebound.Core/Domain/EditorLayouts.cs` | `PageDimensions(WidthMm, HeightMm, MarginMm)` (`:6`) und die Zuordnung je `PageLayout` (`:26`) |
| `src/Pagebound.Core/Domain/EditorTemplates.cs` | Vorlagen als Code, nicht als Datei: `Create(TemplateKind)` (`:13`), darunter Rechnung (`:50`), Brief (`:68`), Flyer (`:81`) |
| `src/Pagebound.Core/Domain/EditorTheme.cs` | Themes: Schriften, Farben, Abstände |
| `src/Pagebound.Core/Domain/EditorSeries.cs` | Serienbrief: Platzhalter plus CSV-Zeilen |
| `src/Pagebound.Core/Domain/EditorDesignDefaults.cs` | Vorgabewerte für neue Dokumente |
| `src/Pagebound.Web/wwwroot/js/wysiwyg-editor.ts` | Browser-Seite: Editor starten (`:34`), Zoom (`:79`), QR erzeugen (`:136`), Bilder verkleinern (`:146`) und beschneiden (`:167`), Datei-Drop (`:312`), Farbbefehle (`:368`) |
| `src/Pagebound.Web/wwwroot/js/mind-bridge.ts` | Mindmaps: SVG (`:42`), Data-URL (`:76`), interaktiv einhängen (`:90`), Auswahl setzen (`:108`) |
| `src/Pagebound.Web/wwwroot/js/designs-bridge.ts` | Design-Ordner: wählen (`:105`), auflisten (`:129`), lesen (`:156`), schreiben (`:170`), löschen (`:186`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Storage & Persistenz** (Querschnitt, via `IStorageService`): Entwürfe liegen unter `editor:doc:*` in IndexedDB — `src/Pagebound.Infrastructure/Editor/EditorDraftService.cs:16`. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `src/Pagebound.Web/Features/Editor/DesignerPage.razor:13`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `apply`, `save`, `load`, `downloadBytes`): Feineinstellungen und Download des erzeugten PDFs — `…/DesignerPage.razor:264`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

Bemerkenswert: der Designer hat **keine** Kante zu „PDF-Werkzeuge & Manipulation". Er erzeugt sein PDF über eine eigene Zeichenkette in `wysiwyg-editor.ts` mit pdf-lib, statt den Manipulator zu bemühen — der Manipulator ist auf vorhandene Dokumente ausgelegt.

### Extern (Packages)

- `pdf-lib` plus `@pdf-lib/fontkit` — Erzeugung des PDFs und Einbettung der Schriften
- Mitgelieferte Schriften unter `src/Pagebound.Web/wwwroot/fonts/` — keine Google-Fonts, kein CDN
- QR-Erzeugung in `wysiwyg-editor.ts:136` — im Bündel, kein Dienst

## Öffentliche API / Interface

```csharp
public interface IEditorDraftService
{
    Task<IReadOnlyList<EditorDraftInfo>> ListAsync(CancellationToken ct);
    Task<EditorDocument?> LoadAsync(string id, CancellationToken ct);
    Task SaveAsync(EditorDocument document, CancellationToken ct);
    Task DeleteAsync(string id, CancellationToken ct);
}

public interface IDesignFolderService
{
    Task<bool> IsSupportedAsync(CancellationToken ct);
    Task<string?> GetFolderNameAsync(CancellationToken ct);
    Task<string?> PickFolderAsync(CancellationToken ct);
    Task ClearFolderAsync(CancellationToken ct);
    Task<IReadOnlyList<DesignFileInfo>> ListAsync(CancellationToken ct);
    Task<string?> ReadAsync(string fileName, CancellationToken ct);
    Task<bool> WriteAsync(string fileName, string json, CancellationToken ct);
    Task<bool> DeleteAsync(string fileName, CancellationToken ct);
    Task<bool> ExistsAsync(string fileName, CancellationToken ct);
}
```

Das Dokumentmodell ist der eigentliche Vertrag: `EditorDocument` (`EditorDocument.cs:294`) hält Seiten, Seiten halten Blöcke, Blöcke tragen ihren Typ (`EditorBlockType`, `:18`) und optionale Overlays (`:65`). Dieselbe Struktur beschreiben die `design_*`-Tools des MCP-Servers — siehe [`./mcp-server.md`](./mcp-server.md); beide Seiten müssen dasselbe JSON verstehen, teilen aber **keinen Quelltext**.

## Datenfluss / Call-Flow

1. `/editor` ohne Id startet ein neues Dokument aus einer Vorlage (`EditorTemplates.Create`, `:13`) oder leer; `/editor/{Id}` lädt einen Entwurf über `LoadAsync` (`EditorDraftService.cs:39`).
2. Die Oberfläche arbeitet auf dem `EditorDocument`-Baum im Speicher; Zoom und Seitengeometrie kommen aus `EditorLayouts.For` (`EditorLayouts.cs:26`) und `wysiwyg-editor.ts:79`.
3. Eingefügte Bilder werden im Browser verkleinert (`compressDataUrl`, `wysiwyg-editor.ts:146`) und auf Wunsch beschnitten (`:167`), bevor sie in das Dokument gehen — damit ein Handyfoto den Entwurf nicht auf zehn Megabyte treibt.
4. Mindmap-Blöcke rendern über `mind-bridge.ts`: in der Vorschau interaktiv (`mount`, `:90`), für den Export als SVG bzw. Data-URL (`:42`, `:76`).
5. Gespeichert wird in IndexedDB (`SaveAsync`, `EditorDraftService.cs:45`) und, wenn ein Design-Ordner gewählt ist, zusätzlich als JSON-Datei dorthin (`designs-bridge.ts:170`).
6. Der Export baut das PDF mit pdf-lib und gibt es über `downloadBytes` aus (`…/DesignerPage.razor:264`).
7. Serienbrief: `EditorSeries` ersetzt die Platzhalter je CSV-Zeile; daraus entsteht ein Dokument je Zeile bzw. ein zusammengefügtes PDF.

## Offene Fragen / TODOs

- `DesignerPage.razor` ist mit 2635 Zeilen die zweitgrößte Datei der Codebase und bündelt Oberfläche, Zustand und Exportlogik.
- `pageboundMind` wird **nicht** verzögert geladen, weil `wysiwyg-editor.ts` `renderMindmapDataUrl` synchron aufruft; ein Platzhalter lieferte dort ein Promise statt eines Wertes (Begründung im Kopf von `src/Pagebound.Web/wwwroot/js/lazy-bridges.js`).
- Vorlagen liegen als C#-Code (`EditorTemplates.cs`). Neue Vorlagen brauchen einen Build; eine Vorlage als Datei wäre möglich, ist aber nicht angelegt.
- Für den Designer gibt es keine Prüfung auf der UI-Schicht; der MCP-Server prüft sein Gegenstück dagegen in `npm run smoke`.
