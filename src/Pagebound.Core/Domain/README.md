# Pagebound.Core.Domain

Hier liegen die **Domänen-Objekte** der Anwendung: reine C#-Records, Value-Objects, Enums, Domain-Events. Keine Abhängigkeiten auf Browser, Blazor oder externe Bibliotheken.

## Erwartete Typen (Pflichtenheft Abschnitt 5.4)

- `Annotation`, `AnnotationType`, `AnnotationId`
- `Sidecar`, `PdfMeta`, `LibraryEntry`, `LibraryEntryId`
- `Signature`, `SignatureInput`, `SignatureResult`
- `IntegrityRecord`, `IntegrityVerification`, `IntegrityStatus`
- `Highlight`, `StickyNote`, `InkPath`, `ShapeAnnotation`
- `Tag`, `LibraryQuery`, `LibrarySort`
- `RenderOptions`, `SearchOptions`, `OcrOptions`
- `HashAlgorithm`, `ThemeName`, `ExportFormat`
- `BatchJob`, `BatchOperation`, `BatchRule`

## Regel

Domain-Objekte sind **immutable** wo möglich (C#-`record` oder `readonly record struct`). Sie tragen Verhalten nur dort, wo es invariant zum Zustand gehört (z.B. `Sidecar.AddAnnotation` als pure Funktion, die ein neues `Sidecar` zurückgibt).

Externe Seiteneffekte (IO, Random, Time) gehören **nicht** in Domain-Klassen — dafür sind Services in `Abstractions/` zuständig.
