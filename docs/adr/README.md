# Architecture Decision Records (ADRs)

Kurze, nachvollziehbare Architektur-Entscheidungen im MADR-Stil (Deutsch). Der
Code verweist an mehreren Stellen per Nummer auf diese ADRs (`ADR-001`, `ADR-004`,
`ADR-006`, `ADR-011`); die Dateien wurden im Zuge von F-19 nachdokumentiert
(Inhalt aus vorhandenen Code-Kommentaren + [Blueprints](../blueprints/INDEX.md)
abgeleitet — keine neuen Entscheidungen).

| Nr. | Titel | Status |
|-----|-------|--------|
| [0001](0001-interface-first.md) | Interface-First mit payload-basierten Annotationen | Akzeptiert |
| [0004](0004-pdf-lib-statt-pdfsharpcore.md) | pdf-lib/PDF.js statt PdfSharpCore | Akzeptiert |
| [0006](0006-pragmatisches-signatur-schema.md) | Pragmatisches Signatur-Integritäts-Schema (kein PAdES) | Akzeptiert |
| [0011](0011-indexeddb-primaer-sidecar-export.md) | IndexedDB primär, Sidecar für Export | Akzeptiert |

> Die Nummern sind nicht lückenlos — nur die im Code referenzierten Entscheidungen
> sind hier festgehalten.
