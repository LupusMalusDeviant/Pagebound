# Text bearbeiten

## Zweck

Vorhandenen PDF-Text im Reader ändern: eine Textzeile anklicken, den Text überschreiben, Ergebnis als neue Datei speichern. Umsetzung als **Überdecken und neu zeichnen** (kein Neufluss): die alte Stelle wird opak in der Hintergrundfarbe übermalt, der neue Text darüber gezeichnet. Wie die Schwärzung sind die Änderungen **flüchtig** — kein Sidecar-Schreiben; „Anwenden" erzeugt `<name>.edited.pdf`, Original und Sidecar bleiben unberührt.

**Ehrliche Grenze:** pdf-lib kann bestehende Inhaltsströme nicht bearbeiten, nur anhängend zeichnen. Der ursprüngliche Text bleibt deshalb im Inhaltsstrom und ist weiterhin extrahierbar. Wer Text wirklich entfernen will, braucht die [Schwärzung](./redaktion.md) mit ihrer Rasterung. Zweite Grenze: der neue Text nutzt Helvetica (WinAnsi); nicht kodierbare Zeichen werden beim Einbrennen herausgefiltert.

## Dateien

Dieses Feature hat **keine eigenen Dateien**. Es lebt als Symbole in Dateien, die anderen Features zugeordnet sind:

| Symbol | Datei | Rolle |
|--------|-------|-------|
| `ReaderPane.ApplyTextEditsAsync`, Modus `EditText`, `StartTextEditAsync`, `_edits` (`TextEditBox`) | `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Oberfläche: Knopf, Klick-Geste, Editor-Popover, Vorschau-Overlay, flüchtiger Zustand |
| `findTextBlockAt` (`:358`) | `src/Pagebound.Web/wwwroot/js/pdfjs-bridge.ts` | nächstliegende Textzeile zu einer Klickposition, mit Kasten, Text und Schriftgröße in 0..1 |
| `applyTextEdits` | `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | übermalt die alten Stellen und zeichnet den neuen Text |
| `ApplyTextEditsAsync` | `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | C#-Seite über JS-Interop (spiegelt `RedactAsync`) |
| `TextEditRegion`, `IPdfManipulator.ApplyTextEditsAsync` (`:104`) | `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` | Vertrag |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

Weil das Feature keine eigenen Dateien hat, erscheint es **nicht** im maschinell geprüften Kantengraph. Die folgenden Abhängigkeiten sind **von Hand ermittelt**, nicht vom Skript bestätigt:

- **PDF-Reader & Rendering** — Klick-Geste auf dem gerenderten Seiten-Canvas; PDF.js liefert die Text-Geometrie für `findTextBlockAt` (`pdfjs-bridge.ts:358`). Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge & Manipulation** — derselbe `JsPdfLibManipulator` und dieselbe pdf-lib-Brücke wie alle anderen Manipulationen. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Schwärzung (Redaktion)** — dasselbe Muster „zeichnen, anwenden, neue Datei", und der empfohlene Weg, wenn Text wirklich verschwinden soll. Siehe [`./redaktion.md`](./redaktion.md).

Wer eine Änderung an diesem Feature verfolgen will, geht über die Kanten von „PDF-Reader & Rendering" und „PDF-Werkzeuge & Manipulation" im [INDEX](./INDEX.md).

### Extern (Packages)

- `pdf-lib` — opakes Rechteck plus `drawText`
- `pdfjs-dist` — Text-Extraktion mit Geometrie (`getTextContent`) für die Blockerkennung

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IPdfManipulator.cs:104
Task<byte[]> ApplyTextEditsAsync(Stream pdf, IReadOnlyList<TextEditRegion> edits, CancellationToken ct);
```

`TextEditRegion` trägt Seite, Kasten in 0..1, neuen Text, Schriftgröße sowie Text- und Hintergrundfarbe. JS-Seite: `applyTextEdits(pdfBytes, edits)` und `findTextBlockAt(handleId, page, xFrac, yFrac)`.

## Datenfluss / Call-Flow

1. Der Nutzer schaltet in `ReaderPane.razor` auf den Modus „Text bearbeiten".
2. Klick auf eine Textzeile: die Klickposition wird über `clientPositionToFraction` (`shortcuts-bridge.ts:107`) in 0..1 umgerechnet, dann liefert `findTextBlockAt` (`pdfjs-bridge.ts:358`) die nächstliegende Zeile mit Kasten, Text und Schriftgröße — oder `null`, dann wird frei an der Klickposition eingefügt.
3. Das Freitext-Popover öffnet am Kasten, **vorbefüllt mit dem alten Text**; Tastenanschläge gehen in den Zwischenzustand, ohne die Elternkomponente neu zu rendern.
4. Speichern übernimmt den Eintrag in die flüchtige Liste `_edits`; bei unverändertem oder leerem Inhalt passiert nichts. Das Overlay zeigt Überdeckung plus neuen Text.
5. „Anwenden" ruft `ApplyTextEditsAsync`; die Brücke übermalt die alten Stellen und zeichnet den neuen Text; Download als `<name>.edited.pdf`. `_edits` wird geleert.

## Offene Fragen / TODOs

- Änderungen sind flüchtig: ein Neuladen verliert sie. Bewusster Zuschnitt wie bei der Schwärzung.
- Eine optionale „echte Entfernung" (Rasterung des Kastens wie bei der Redaktion) statt reinem Übermalen ist als späterer Ausbau gedacht.
- Kein Neufluss, keine Schrifttreue: eine Zeile je Block, Helvetica/WinAnsi. Für pixelgenaue Layouts ist das Werkzeug nicht gedacht.
