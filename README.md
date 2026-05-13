# Pagebound

> **Schlanker, datenschutzfreundlicher Adobe-Acrobat-Reader-Ersatz als Open-Source-PWA.**
> Blazor WebAssembly · .NET 10 · Apache License 2.0

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4.svg)](https://dotnet.microsoft.com/)
[![Status](https://img.shields.io/badge/Status-Pre--Alpha-orange.svg)](#roadmap)

> ⚠️ **Pre-Alpha**: Dieses Projekt befindet sich in der Planungs-/Bootstrap-Phase. Es gibt noch keinen lauffähigen Code. Siehe [docs/](docs/) für vollständige Spezifikation.

---

## Was ist Pagebound?

Pagebound ist ein quelloffenes PDF-Werkzeug, das den Adobe Acrobat Reader im Alltag vollständig ersetzen will – schlank, schnell, datenschutzfreundlich, ohne Cloud-Zwang, ohne Telemetrie und ohne Pro-Paywall. Und es ergänzt drei Knowledge-Worker-Features, die Acrobat fehlen:

- 📝 **PNG-Signatur mit Hash-Integrität** – signiere PDFs mit deiner Unterschrift als Bild und prüfe automatisch, ob das Dokument nachträglich verändert wurde.
- 📚 **Library mit Sidecar-Dateien** – alle Annotationen und Metadaten als JSON neben der PDF, mit Tags, Volltext-Suche und drei Ansichten.
- 🔗 **Markdown-Export für Obsidian/Zettelkasten** – exportiere Highlights und Notizen als Markdown-Dateien für deinen Wissens-Workflow.

## Status & Roadmap

Pagebound wird in **10 nutzbaren Releases** (0.1 → 1.0) entwickelt. Jeder Release ist eigenständig im Alltag einsetzbar.

| Release | Inhalt | Status |
|---|---|---|
| 0.1 | Viewer + Highlight + Sticky Notes + Sidecar-JSON | geplant |
| 0.2 | + Stift, Formen, Outline, Markdown-Notizen | geplant |
| 0.3 | + Seitenoperationen (merge/split/rotate) | geplant |
| 0.4 | + PNG-Signatur + Hash-Integrität | geplant |
| 0.5 | + Library-Verwaltung + Tags | geplant |
| 0.6 | + Multi-PDF Split-View | geplant |
| 0.7 | + Markdown-Export + Obsidian-Integration | geplant |
| 0.8 | + Formulare + Verschlüsselung + Bild→PDF | geplant |
| 0.9 | + OCR + Stapelverarbeitung | geplant |
| 1.0 | + Konvertierungen + A11y-Polish + Doku komplett | geplant |

Details: [docs/02-lastenheft.md](docs/02-lastenheft.md) Abschnitt 6.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | Anforderungsdokument (Vision, FA-/NFA-IDs, Erfolgsktiterien) |
| [docs/02-lastenheft.md](docs/02-lastenheft.md) | Lastenheft (Auftraggeber-Sicht, MoSCoW-Priorisierung, Releases) |
| [docs/03-pflichtenheft.md](docs/03-pflichtenheft.md) | Pflichtenheft (Architektur, 17 Service-Interfaces, Test-Konzept, ADRs) |
| [docs/adrs/](docs/adrs/) | Architecture Decision Records – einzelne Entscheidungen im Detail |

## Architektur (kurz)

- **Frontend:** Blazor WebAssembly auf .NET 10
- **PDF-Rendering:** PDF.js via JS-Interop
- **PDF-Manipulation:** PdfSharpCore (pure C#)
- **Styling:** Tailwind CSS + eigene Headless-Komponenten
- **State:** Service-basiert via DI
- **Persistenz:** IndexedDB + File System Access API + Sidecar-JSON
- **Hosting:** Statisch (kein Server), eigene Domain via CNAME
- **Architektur-Prinzip:** Interface-First — jeder Service hinter `IXxxService`, DI nur gegen Interfaces

## Mitwirken

Beiträge sind willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für Setup-Schritte, Code-Stil und Pull-Request-Prozess. Verhaltenskodex: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Lizenz

Apache License 2.0 — siehe [LICENSE](LICENSE) und Third-Party-Hinweise in [NOTICE](NOTICE).

---

*Pagebound ist nicht mit Adobe Inc. verbunden. „Adobe", „Acrobat" und „Acrobat Reader" sind eingetragene Marken von Adobe Inc.*
