# WYSIWYG-Designer

## Zweck

Block-basierter Dokument-Editor zum Gestalten eigener Dokumente direkt im Browser: Flyer, Briefe, Rechnungen und Slides (LF-02/LF-03). Ein `EditorDocument` besteht aus Seiten mit Blöcken (Heading, Paragraph, Image, Shape, Table, Spacer, Columns, QrCode, Mindmap) plus frei platzierbaren Overlays (Text/Bild/Form in Prozent-Koordinaten — zoom-, format- und druckstabil). Dazu kommen Templates, Themes (Farben/Fonts), CSV-Serienerzeugung (z. B. Serienbriefe/Namensschilder), QR-Codes, editierbare D3-Mindmaps, HTML-Import mit Stil-Hybrid sowie Export als PDF (über Print-CSS und den Browser-Druckdialog) und als interaktives HTML.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Domain/EditorDocument.cs` | Dokument-Modell: `PageLayout`, `EditorBlockType`, `MindmapNode`, `EditorOverlay`, Blöcke/Seiten |
| `src/Pagebound.Core/Domain/EditorTheme.cs` | Theme-Modell (Farben, Fonts) für Designs |
| `src/Pagebound.Core/Domain/EditorSeries.cs` | CSV-Serien-Modell (Platzhalter → Datenzeilen) |
| `src/Pagebound.Core/Domain/EditorTemplates.cs` | Mitgelieferte Vorlagen |
| `src/Pagebound.Core/Domain/EditorLayouts.cs` | Seitenformate/Layout-Definitionen |
| `src/Pagebound.Core/Domain/EditorDesignDefaults.cs` | Default-Werte für neue Designs |
| `src/Pagebound.Core/Abstractions/IEditorDraftService.cs` | Interface: Entwurfs-Persistenz |
| `src/Pagebound.Core/Abstractions/IDesignFolderService.cs` | Interface: Design-Ordner (Speichern/Laden von Designs) |
| `src/Pagebound.Infrastructure/Editor/EditorDraftService.cs` | Entwurfs-Persistenz (Autosave) über Storage |
| `src/Pagebound.Infrastructure/Editor/BrowserDesignFolderService.cs` | Design-Ordner via File-System-Access-API |
| `src/Pagebound.Web/Features/Editor/DesignerPage.razor` | Designer-UI: Canvas, Block-Palette, Eigenschaften-Panel, Export |
| `src/Pagebound.Web/wwwroot/js/wysiwyg-editor.ts` | JS-Bridge: contenteditable-Handling, Selektion, Inline-Formatierung |
| `src/Pagebound.Web/wwwroot/js/designs-bridge.ts` | JS-Bridge: Design-Ordner, HTML-Import/-Export, Druck/PDF-Export |
| `src/Pagebound.Web/wwwroot/js/mind-bridge.ts` | JS-Bridge: D3-Mindmap-Rendering und -Interaktion |
| `src/Pagebound.Web/wwwroot/css/print-document.css` | Print-CSS für seitentreuen PDF-Export |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Storage & Persistenz** — Autosave-Entwürfe in IndexedDB, Design-Ordner-Handle via File System Access API. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **Lokalisierung, Theme & UI-Shell** — UI-Texte via `L.T()`, App-Theme (hell/dunkel) fürs Editor-Chrome. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **MCP-Server** — spiegelt die Designer-Funktionen als Tools (`design_create`, `design_validate`, `design_render_html`, …) für LLM-Agents. Siehe [`./mcp-server.md`](./mcp-server.md).

### Extern (Packages)

- `d3-*` — Mindmap-Layout und -Rendering (Baum-Visualisierung)
- `qrcode` — QR-Code-Erzeugung für QrCode-Blöcke
- `@pdf-lib/fontkit` — Font-Einbettung im PDF-Kontext

## Öffentliche API / Interface

```csharp
public enum PageLayout { A4Portrait, A4Landscape, A5Portrait, Letter, Slide16x9, DinLong, A6Landscape }

public enum EditorBlockType { Heading, Paragraph, Image, Shape, Table, Spacer, Columns, QrCode, Mindmap }

public sealed class MindmapNode          // bewusst veränderlich, Id bleibt über Redraws stabil
{
    public string Id { get; set; }
    public string Label { get; set; }
    public List<MindmapNode> Children { get; set; }
    public MindmapNode Clone();          // Tiefenkopie für Undo-Snapshots / Duplikate
}

public sealed class EditorOverlay        // frei platzierbar, Position/Größe in % der Seite
{
    public string Id { get; set; }
    public EditorOverlayType Type { get; set; }   // Text | Image | Shape
    public double XPercent { get; set; }
    // ... YPercent, Breite/Höhe, Stil; Listen-Reihenfolge = Stapelung
}
```

## Datenfluss / Call-Flow

1. **Bearbeiten:** `DesignerPage` hält das `EditorDocument`; Textbearbeitung läuft über `wysiwyg-editor.ts` (contenteditable), Mindmap-Blöcke über `mind-bridge.ts` (D3 rendert den `MindmapNode`-Baum, Klicks/Edits mutieren ihn direkt).
2. **Autosave:** Änderungen → `IEditorDraftService` → IndexedDB; explizites Speichern → `IDesignFolderService`/`designs-bridge.ts` in den gewählten Design-Ordner.
3. **Serien:** CSV wird in `EditorSeries` geparst; Platzhalter im Dokument werden pro Datenzeile ersetzt → n Ausgabeseiten/-dokumente.
4. **PDF-Export:** `designs-bridge.ts` rendert das Dokument mit `print-document.css` und öffnet den Browser-Druckdialog („Als PDF speichern") — kein serverseitiges Rendering.
5. **HTML-Import/-Export:** Import parst fremdes HTML und mappt es auf Blöcke (Stil-Hybrid: eigene Themes + übernommene Inline-Stile); Export erzeugt eigenständiges, interaktives HTML.

## Offene Fragen / TODOs

- Umfang des HTML-Imports (welche Tags/Stile verlustfrei gemappt werden) ist nicht formal spezifiziert.
