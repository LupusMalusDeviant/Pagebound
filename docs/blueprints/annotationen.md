# Annotationen

## Zweck

Highlights, Notizen, Freihand (Ink), Formen und Freitext als Domain-Objekte, die getrennt vom PDF gespeichert werden. Das Original-PDF bleibt unangetastet — Annotationen liegen im Sidecar bzw. in IndexedDB und können jederzeit gelöscht oder exportiert werden. Erst „Einbrennen" über die Werkzeuge schreibt sie ins PDF.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Infrastructure/Annotations/AnnotationService.cs` | `IAnnotationService` über den Key-Value-Speicher; Schlüsselpräfix `annotations:` (`:18`), Änderungs-Strom (`ObserveChanges`, `:122`) |
| `src/Pagebound.Core/Domain/AnnotationTypes.cs` | `AnnotationId`, `AnnotationType`, `Annotation`, `NewAnnotation`, `AnnotationChange` |
| `src/Pagebound.Core/Domain/AnnotationPayload.cs` | Basis der typisierten Nutzlast; jede Annotationsart serialisiert in dieselbe Hülle |
| `src/Pagebound.Core/Domain/HighlightAnnotation.cs` | Markierung: Rechtecke in Seitenanteilen plus Farbe |
| `src/Pagebound.Core/Domain/StickyNoteAnnotation.cs` | Notiz: Position plus Text |
| `src/Pagebound.Core/Domain/InkAnnotation.cs` | Freihand: Linienzüge in Seitenanteilen |
| `src/Pagebound.Core/Domain/ShapeAnnotation.cs` | Formen: Rechteck, Ellipse, Linie, Pfeil |
| `src/Pagebound.Core/Domain/FreeTextAnnotation.cs` | Freitext und Datum, direkt auf der Seite |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Storage & Persistenz** (Querschnitt, via `IStorageService`): die einzige Abhängigkeit — Annotationen liegen als JSON unter `annotations:<pdfId>` in IndexedDB — `src/Pagebound.Infrastructure/Annotations/AnnotationService.cs:20`. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).

Eingehend (nicht in dieser Liste, zur Orientierung): Reader, Markdown-Export, PDF-Werkzeuge, Signatur und Library & Workspace nutzen diese Typen.

### Extern (Packages)

- Keine. Reines C# mit `System.Text.Json`.

## Öffentliche API / Interface

```csharp
public interface IAnnotationService
{
    Task<Annotation> CreateAsync(NewAnnotation input, CancellationToken ct);
    Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken ct);
    Task DeleteAsync(AnnotationId id, CancellationToken ct);
    Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken ct);
    IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId);
}
```

Koordinaten-Vertrag: alle Geometrien sind **Anteile von 0 bis 1** relativ zur Seite, Ursprung oben links. Damit bleiben sie bei jedem Zoom und jeder Fenstergröße gültig und müssen beim Rendern nur skaliert werden.

## Datenfluss / Call-Flow

1. Der Reader legt eine Annotation an → `CreateAsync` (`AnnotationService.cs:29`) vergibt Id und Zeitstempel und schreibt die Liste des Dokuments zurück.
2. Gelesen wird pro Dokument: `GetForDocumentAsync` (`:108`) holt den ganzen Eintrag `annotations:<pdfId>` und gibt die Liste zurück — kein Index je Annotation.
3. `ObserveChanges` (`:122`) liefert Änderungen als Strom, damit zwei Panes derselben Datei in der Split-View nicht auseinanderlaufen.
4. Beim Speichern eines Sidecars wandern die Annotationen in die Sidecar-JSON (siehe [`./library-workspace.md`](./library-workspace.md)); beim Einbrennen in das PDF übernimmt `JsPdfLibManipulator` die Typen (`src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs:220`).

## Offene Fragen / TODOs

- Jede Änderung schreibt die **ganze** Liste eines Dokuments neu (`AnnotationService.cs:29` ff.). Bei sehr vielen Annotationen pro PDF ist das ein unnötiger Schreibaufwand; für die bisherigen Größen ist es unkritisch.
- `FreeTextAnnotation` wird vom Markdown-Export nicht ausgegeben (dort als offener Punkt vermerkt).
