# Inline-Text-Bearbeitung („Text bearbeiten")

## Zweck

Vorhandenen PDF-Text im Reader „bearbeiten": eine Textzeile anklicken, den Text
ändern und das Ergebnis als neue Datei speichern. Umsetzung als **Cover + Redraw**
(kein Reflow): die alte Region wird opak mit der Hintergrundfarbe übermalt und der
neue Text darüber gezeichnet. Wie die Schwärzung sind die Bearbeitungen **transient**
(kein Sidecar-Write); „Anwenden" erzeugt `<name>.edited.pdf`, Original + Sidecar
bleiben unangetastet. 100 % lokal, offline, keine neue Laufzeit-Dependency.

**Ehrliche Grenze:** pdf-lib kann bestehende Content-Streams nicht editieren (nur
append-Zeichnen). Der ursprüngliche Text bleibt daher im Content-Stream und ist
weiterhin extrahierbar — für garantierte Entfernung ist die
[Schwärzung](./redaktion.md) (Rasterung) da. Font-Grenze: der neue Text nutzt die
Standard-14-Schrift Helvetica (WinAnsi); nicht kodierbare Zeichen (z. B. ✓) werden
beim Einbrennen herausgefiltert.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Modus `EditText`: Toolbar-Button, Klick-Geste (`StartTextEditAsync`), Pending-Editor (Freitext-Popover wiederverwendet), Overlay-Vorschau, `ApplyTextEditsAsync` als Auslöser; transienter `_edits`-State (`TextEditBox`) |
| `src/Pagebound.Web/wwwroot/js/pdfjs-bridge.ts` | `findTextBlockAt(handleId, page, xFrac, yFrac)` → nächstliegende Textzeile mit BBox + Text + Schriftgröße (0..1) |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | `applyTextEdits(pdfBytes, edits)` → übermalt alte Regionen opak und zeichnet neuen Text (Cover + Redraw), WinAnsi-Fallback wie der Flatten-text-Zweig |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `ApplyTextEditsAsync`: C#-Seite via JS-Interop (spiegelt `RedactAsync`) |
| `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` | Manipulator-Abstraktion + `TextEditRegion`-Record |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader & Viewer** — Klick-Geste auf dem gerenderten Seiten-Canvas; PDF.js
  liefert die Text-Geometrie für `findTextBlockAt`. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge** — nutzt denselben `JsPdfLibManipulator` / `pdf-manipulator-bridge.ts`
  wie die übrigen Manipulations-Werkzeuge. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Schwärzung** — dasselbe transiente „Zeichnen → Anwenden → neue Datei"-Muster; für
  garantierte Text-Entfernung der empfohlene Pfad. Siehe [`./redaktion.md`](./redaktion.md).

### Extern (Packages)
- `pdf-lib` (via `pdf-manipulator-bridge.ts`) — opakes Rechteck + `drawText`
- `pdfjs-dist` — Text-Extraktion mit Geometrie (`getTextContent`) für die Block-Erkennung

## Öffentliche API / Interface

- `JsPdfLibManipulator.ApplyTextEditsAsync(Stream pdf, IReadOnlyList<TextEditRegion> edits, ct)`
  — nimmt PDF-Bytes + Bearbeitungen (Seite, BBox 0..1, neuer Text, Schriftgröße,
  Text-/Hintergrundfarbe) und liefert das bearbeitete PDF zurück.
- JS-Seite: `applyTextEdits(pdfBytes, edits)` (Cover + Redraw) und
  `findTextBlockAt(handleId, page, xFrac, yFrac)` (Block-Erkennung) in den Bridges.

## Datenfluss / Call-Flow

1. Nutzer aktiviert den Modus „Text bearbeiten" in `ReaderPane.razor`.
2. Klick auf eine Textzeile → `StartTextEditAsync` holt die 0..1-Klickposition
   (`clientPositionToFraction`) und ruft `findTextBlockAt` → nächstliegende Zeile mit
   BBox/Text/Schriftgröße (oder `null` → freies Einfügen an der Klickposition).
3. Das Freitext-Editor-Popover öffnet an der BBox, **vorbefüllt mit dem alten Text**;
   Änderungen werden per Tastenanschlag in den Pending-State gesynct (kein Parent-Re-Render).
4. Speichern → `CommitPendingEdit`: übernimmt den Edit in die transiente `_edits`-Liste
   (bei unveränderten/leeren Inhalten wird nichts übernommen); die Overlay-Vorschau zeigt
   Cover + neuen Text.
5. „Anwenden" → `ApplyTextEditsAsync` → Bridge `applyTextEdits` übermalt die alten
   Regionen und zeichnet den neuen Text; Download als `<name>.edited.pdf`. `_edits` wird
   geleert, Original/Sidecar bleiben unangetastet.

## Offene Fragen / TODOs

- Bearbeitungen sind transient (kein Reload-Persist) — bewusster MVP-Trade-off wie bei
  der Schwärzung. Re-Editierbarkeit über Reload wäre eine spätere Erweiterung.
- Optionale „echte Entfernung" (Rasterung der BBox wie bei der Redaktion) statt reinem
  Übermalen ist als spätere Ausbaustufe vorgesehen.
- Kein Reflow und keine Font-Treue: neuer Text in Helvetica/WinAnsi, eine Zeile je
  Block. Für pixelgenaue Layouts ist das Werkzeug bewusst nicht gedacht.
