# ADR-0001: Interface-First mit payload-basierten Annotationen

- Status: **Akzeptiert**
- Bezug: `src/Pagebound.Core/Abstractions/README.md`, `src/Pagebound.Web/Program.cs`, `src/Pagebound.Core/Domain/*Annotation.cs`, [Blueprint-Index](../blueprints/INDEX.md)

> Nachträglich dokumentiert (F-19): der Code verweist an mehreren Stellen auf
> ADR-001, eine ADR-Datei existierte bisher nicht. Diese ADR hält die bereits
> im Code festgelegte Entscheidung fest, erfindet nichts Neues.

## Kontext

Pagebound ist eine 100 % lokale Blazor-WASM-App ohne Server. Renderer, PDF-
Manipulation, Krypto, Storage und Sidecar sind austauschbare Bausteine (heute
JS-Interop auf pdf-lib/PDF.js, morgen ggf. ein Desktop-Host mit Datei-System).
Damit die Domänen-/Web-Schicht nicht an konkrete Implementierungen gekoppelt ist,
braucht es eine verbindliche Kopplungsregel.

Zweitens: Annotationen (Highlight, Sticky Note, Ink, Shape, Signature, FreeText)
werden als Ordinal-Enum + generisches `IReadOnlyDictionary<string, object?>`-
Payload serialisiert (IndexedDB + Sidecar). Neue Annotationstypen dürfen ohne
Schema-Bruch hinzukommen.

## Entscheidung

1. **Interface-First:** Jeder Service hängt am Interface, nicht an der konkreten
   Klasse; DI registriert `Interface → Implementation` (siehe `Program.cs`).
   Faustregel: *Eine Interface-Datei kostet eine Implementation-Datei.* Kippt das
   Verhältnis (mehr Interfaces als Implementationen), wird die Abstraktion
   hinterfragt.
2. **Payload-basierte Annotationen:** Austauschbar bleibt das **Interface**, nicht
   die Payload-Form. Statische Helfer je Typ (Vorbild `StickyNoteAnnotation`)
   lesen/schreiben ihre Keys aus dem generischen Payload-Dictionary. `AnnotationType`
   wird als Ordinal-Int serialisiert; neue Werte nur hinten anhängen.

## Konsequenzen

- **+** Implementierungen (JS-Interop-Renderer, Desktop-Host) sind austauschbar,
  ohne die aufrufende Schicht zu ändern; gut testbar (Mocks am Interface).
- **+** Neue Annotationstypen brauchen keinen Schema-Bump.
- **−** Etwas Interface-Overhead; deshalb die „1:1"-Faustregel gegen Über-
  Abstraktion.
- **−** Ordinal-Serialisierung ist implizit versioniert: das Enum darf NIE
  umsortiert werden (siehe auch [ADR-0011](0011-indexeddb-primaer-sidecar-export.md)).
