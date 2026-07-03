# Annotationen

## Zweck

Nicht-destruktive Anmerkungen auf PDF-Seiten: Text-Highlights, Sticky Notes (mit Markdown-Inhalt), Ink/Freihand sowie Formen (Stift, Rechteck, Pfeil, Linie). Neu hinzugekommen ist das **Freitext-Werkzeug** (`AnnotationType.FreeText`): Text wird direkt auf der Seite platziert — wie im Text-Modus des Edge-PDF-Readers. Der **Datum-Stempel** ist ein Spezialfall davon: ein Freitext, vorbefüllt mit dem lokalen PC-Datum. Annotationen liegen als generische `Annotation`-Records mit typspezifischem Payload-Dictionary vor; die Original-PDF bleibt unverändert (Persistenz separat, Export optional per Flatten).

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Domain/AnnotationTypes.cs` | Basis-Typen: `AnnotationId`, `PdfId`, `AnnotationType` (Highlight, StickyNote, Ink, Shape, Signature, FreeText), `Annotation`, `NewAnnotation`, `AnnotationChange` |
| `src/Pagebound.Core/Domain/HighlightAnnotation.cs` | Payload-Helfer für Text-Highlights |
| `src/Pagebound.Core/Domain/StickyNoteAnnotation.cs` | Payload-Helfer für Sticky Notes (Markdown) |
| `src/Pagebound.Core/Domain/InkAnnotation.cs` | Payload-Helfer für Freihand-/Stift-Striche |
| `src/Pagebound.Core/Domain/ShapeAnnotation.cs` | Payload-Helfer für Formen (Rechteck, Pfeil, Linie) |
| `src/Pagebound.Core/Domain/FreeTextAnnotation.cs` | NEU: Payload-Helfer für Freitext (Keys `text`, `x`, `y`, `fontSize`, `color`; Fractions 0..1, zoom-unabhängig via `cqh`) |
| `src/Pagebound.Core/Abstractions/IAnnotationService.cs` | CRUD + Change-Stream für Annotationen |
| `src/Pagebound.Infrastructure/Annotations/AnnotationService.cs` | Implementierung; Persistenz über Storage/Sidecar |
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Toolbar (Werkzeugauswahl), Platzierung per Klick, Editor-Popover, Overlay-Rendering |
| `src/Pagebound.Web/wwwroot/js/shortcuts-bridge.ts` | Tastatur-Shortcuts und Drag-Unterstützung (Annotation verschieben) |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | Flatten-Export: Annotationen fest ins PDF einbrennen |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | JS-Seite des Flatten-Exports (`flattenAnnotations`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader & Viewer** — liefert Seiten-Canvas und Koordinatensystem, auf dem Annotationen gezeichnet und platziert werden. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Storage & Persistenz** — Persistenz in IndexedDB (Key `annotations:{pdfId}`) plus Sidecar-JSON neben der Datei. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **Signatur & Integrität** — Signaturen sind ein eigener `AnnotationType.Signature` auf derselben Infrastruktur; das Annotation-Set fließt in den Integritäts-Hash ein. Siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).
- **PDF-Werkzeuge** — Flatten-Export nutzt den gemeinsamen `JsPdfLibManipulator` / `pdf-manipulator-bridge.ts`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).

### Extern (Packages)
- `pdf-lib` (via `pdf-manipulator-bridge.ts`) — Flatten-Export der Annotationen ins PDF

## Öffentliche API / Interface

```csharp
public interface IAnnotationService
{
    Task<Annotation> CreateAsync(NewAnnotation input, CancellationToken cancellationToken);
    Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken cancellationToken);
    Task DeleteAsync(AnnotationId id, CancellationToken cancellationToken);
    Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken cancellationToken);
    IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId);
}
```

Freitext-Helfer (Auszug):

```csharp
public static class FreeTextAnnotation
{
    public static NewAnnotation Create(PdfId pdfId, int pageNumber, double x, double y,
        string text, double? fontSize = null, string? color = null);
    public static Annotation WithText(Annotation existing, string newText);
    public static Annotation WithPosition(Annotation existing, double x, double y);
    public static Annotation WithStyle(Annotation existing, double fontSize, string color);
    // Getter: GetX, GetY, GetText, GetFontSize, GetColor
}
```

- Position `x`/`y`: Top-Left als 0..1-Fraction der Seite; `fontSize` als Fraction der Seitenhöhe (Default 2 % ≈ 17 pt auf A4); `color` als Hex `#rrggbb`. Text mehrzeilig via `\n`, **kein** Markdown (im Gegensatz zur Sticky Note).
- Datum-Stempel: `FreeTextAnnotation.Create(...)` mit dem lokal formatierten PC-Datum als `text`.

## Datenfluss / Call-Flow

1. **Anlegen:** Toolbar in `ReaderPane.razor` → Werkzeug wählen → Klick auf Seite liefert Fraction-Koordinaten → `IAnnotationService.CreateAsync(NewAnnotation)` → `AnnotationService` persistiert (IndexedDB `annotations:{pdfId}` + Sidecar-JSON) → `ObserveChanges` pusht `AnnotationChange(Created)` → Overlay rendert neu.
2. **Bearbeiten:** Editor-Popover (Text/Farbe/Größe) bzw. Drag via `shortcuts-bridge.ts` → `WithText`/`WithPosition`/`WithStyle` erzeugen aktualisierten Record → `UpdateAsync`.
3. **Flatten-Export:** `JsPdfLibManipulator` übergibt PDF-Bytes + Annotation-Daten an `pdf-manipulator-bridge.ts` (`flattenAnnotations`) → pdf-lib zeichnet die Annotationen fest in die Seiten → neues PDF als Download/Datei.

## Offene Fragen / TODOs

- Einheitliche Undo/Redo-Semantik über alle Annotationstypen hinweg ist im Code zu prüfen.
