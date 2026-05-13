# Architecture Decision Records (ADRs)

In diesem Verzeichnis werden alle architekturrelevanten Entscheidungen für Pagebound dokumentiert. Jede ADR ist eine eigene Markdown-Datei, fortlaufend nummeriert.

## Liste

| Nr. | Titel | Status |
|---|---|---|
| [001](001-interface-first.md) | Interface-First-Architektur als verbindliches Prinzip | Akzeptiert |
| [002](002-blazor-wasm.md) | Blazor WebAssembly statt JavaScript-Framework | Akzeptiert |
| [003](003-pdfjs-via-interop.md) | PDF.js via JS-Interop für Rendering | Akzeptiert |
| [004](004-pdfsharpcore.md) | PdfSharpCore für PDF-Manipulation | Akzeptiert |
| [005](005-json-sidecar.md) | JSON-Sidecar mit Schema-Versionierung | Akzeptiert |
| [006](006-png-hash-signature.md) | Eigenes PNG+SHA256-Schema statt PAdES (für MVP) | Akzeptiert |
| [007](007-tailwind-headless.md) | Tailwind + eigene Komponenten statt UI-Library | Akzeptiert |
| [008](008-feature-folders.md) | Feature-Folder statt Clean Architecture | Akzeptiert |
| [009](009-github-actions.md) | GitHub Actions für CI/CD | Akzeptiert |
| [010](010-apache-2-0.md) | Apache License 2.0 | Akzeptiert |
| [011](011-indexeddb-primary.md) | IndexedDB als primäre Persistenz, Sidecar als Export | Akzeptiert |

## Format

Jede ADR folgt diesem Aufbau:

```markdown
# ADR-NNN: <Titel>

| | |
|---|---|
| Status | Vorgeschlagen / Akzeptiert / Veraltet / Ersetzt durch ADR-XXX |
| Datum  | YYYY-MM-DD |

## Kontext
Welches Problem oder welche Frage wird hier adressiert?

## Entscheidung
Was haben wir entschieden?

## Konsequenzen
Was folgt aus dieser Entscheidung (positiv und negativ)?

## Alternativen erwogen
Welche Alternativen wurden geprüft und warum verworfen?
```

## Wann eine neue ADR fällig ist

- Neue externe Bibliothek wird aufgenommen oder ersetzt
- Service-Schnitt wird grundlegend geändert
- Datenmodell wird verändert
- Build-/Deploy-/CI-Strategie wird angepasst
- Performance- oder Security-Trade-off mit Auswirkung auf andere Module
- Lizenz-relevante Entscheidungen

## Wann eine ADR `Veraltet` wird

Wenn die ursprüngliche Entscheidung nicht mehr gilt, erstellen wir eine **neue ADR mit höherer Nummer**, die die alte ersetzt. Die alte ADR bleibt als historischer Beleg erhalten — wir markieren sie nur als „Ersetzt durch ADR-XXX". So bleibt nachvollziehbar, warum sich der Stand geändert hat.
