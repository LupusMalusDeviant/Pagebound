# Seiten-Organizer

## Zweck

Visuelles Verwalten der Seiten einer PDF: Thumbnails **per Drag neu anordnen**, einzeln **drehen** (±90°) und **löschen** — das Ergebnis wird als neue Datei (`<name>.organized.pdf`) exportiert. Original + Sidecar bleiben unangetastet. 100 % lokal im Browser, ohne Server/Telemetrie.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/PdfTools/OrganizerPage.razor` | UI (`/organize`): PDF laden (InputFile), Thumbnails rendern, Drag-Reorder (`@ondragstart/@ondrop`), Drehen/Löschen je Seite, „Anwenden & speichern" |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | `organizePages(pdfBytes, ops)` — neues Dokument aus Quellseiten in `ops`-Reihenfolge (`copyPages`) + Rotations-Delta (`setRotation`); ausgelassene Seiten = gelöscht |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `OrganizePagesAsync` — C#-Seite via JS-Interop |
| `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` | Manipulator-Abstraktion + `PageOp(int SourceIndex, int Rotation)` |

## Abhängigkeiten

### Intern
- **PDF-Reader** — Thumbnail-Rendering über die PDF.js-Bridge (`pageboundPdf.loadPdf` + `renderPage`). Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge** — nutzt denselben `JsPdfLibManipulator` / `pdf-manipulator-bridge.ts`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).

### Extern
- `pdf-lib` — `copyPages`/`setRotation`/`save` für den Neuaufbau des Dokuments.
- `pdfjs-dist` — Seiten-Rasterung für die Thumbnails.

## Öffentliche API / Interface

- `JsPdfLibManipulator.OrganizePagesAsync(Stream pdf, IReadOnlyList<PageOp> ops, ct)` — `PageOp.SourceIndex` (0-basiert) in Listenreihenfolge = neue Seitenreihenfolge; `PageOp.Rotation` = Rotations-Delta (Vielfaches von 90°). Ausgelassene Quellseiten werden gelöscht.
- JS-Seite: `organizePages(pdfBytes, ops)`.

## Datenfluss / Call-Flow

1. Nutzer wählt eine PDF (`OnPdfSelected`) → `loadPdf` + `renderPage` je Seite → Thumbnails (Anzeige-Reihenfolge = Liste `_pages`).
2. Drag ordnet die Liste um; ⟲/⟳ ändern das `Rotation`-Delta (Vorschau per CSS-`transform`); ✕ markiert eine Seite als gelöscht (wiederherstellbar).
3. „Anwenden" baut aus den nicht gelöschten `_pages` die `PageOp`-Liste (SourceIndex + Rotation) und ruft `OrganizePagesAsync`.
4. Die Bridge kopiert die Quellseiten in der gegebenen Reihenfolge, wendet die Rotationen an und speichert → Download `<name>.organized.pdf`.

## Offene Fragen / TODOs

- Anzeige ist auf die ersten `MaxPages` (60) Seiten begrenzt (Performance der Thumbnail-Rasterung).
- Rotation ist ein Delta relativ zur bestehenden Seiten-Rotation; die Thumbnail-Vorschau rotiert per CSS (das Ausgabe-PDF ist über pdf-lib korrekt gedreht).
