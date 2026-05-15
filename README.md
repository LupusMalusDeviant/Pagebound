# Pagebound

> **Schlanker, datenschutzfreundlicher Adobe-Acrobat-Reader-Ersatz als Open-Source-PWA.**
> Blazor WebAssembly · .NET 10 · Apache License 2.0

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4.svg)](https://dotnet.microsoft.com/)
[![Status](https://img.shields.io/badge/Status-Pre--Alpha-orange.svg)](#status--roadmap)

> ⚠️ **Pre-Alpha**: Spielbar, viele Features drin, aber noch nicht release-fest. Läuft heute schon im Docker-Container oder per `dotnet run`.

---

## Was ist Pagebound?

Pagebound ist ein quelloffenes PDF-Werkzeug, das den Adobe Acrobat Reader im Alltag vollständig ersetzen will — schlank, schnell, datenschutzfreundlich, ohne Cloud-Zwang, ohne Telemetrie, ohne Pro-Paywall. Plus drei Knowledge-Worker-Features, die Acrobat fehlen:

- 📝 **PNG-Signatur mit Hash-Integrität** — signiere PDFs mit deiner Unterschrift als Bild, mit Signer-Metadaten direkt im PDF-Info-Dictionary; jede nachträgliche Änderung an Highlights/Notes lässt das Hash-Badge auf der Signatur von grün auf rot springen.
- 📚 **Library mit Sidecar-Dateien** — alle Annotationen + Metadaten als JSON neben der PDF, mit Tags, Inline-Filter und schlanker Such-Funktion.
- 🔗 **Markdown-Export für Obsidian/Zettelkasten** — Highlights und Notizen rauskippen als Markdown mit YAML-Frontmatter (Wikilink-Optionen, page-grouped, Y-sortiert).

## Quick-Start

### Per Docker (empfohlen)

```bash
docker build -t pagebound:dev -f Dockerfile .
docker run --rm -p 8081:80 pagebound:dev
```

Dann http://localhost:8081 öffnen.

### Per dotnet

```bash
cd src/Pagebound.Web
npm install
npm run build
dotnet run
```

Erfordert .NET 10 SDK und Node 20+.

## Status & Roadmap

Pagebound wird in **10 nutzbaren Releases** (0.1 → 1.0) entwickelt. Jeder Release ist eigenständig im Alltag einsetzbar.

| Release | Inhalt | Status |
|---|---|---|
| 0.1 | Viewer + Highlight + Sticky Notes + Sidecar-JSON | ✅ |
| 0.2 | + Stift, Formen, Outline, Markdown-Notizen, Thumbnails | ✅ |
| 0.3 | + Seitenoperationen (merge/split/rotate/delete) | ✅ |
| 0.4 | + PNG-Signatur + Hash-Integrität | ✅ |
| 0.5 | + Library-Verwaltung + Tags | ✅ Phase 1 (File-System-Access-API folgt) |
| 0.6 | + Multi-PDF Split-View | ✅ Phase 1 (Sync-Scroll folgt) |
| 0.7 | + Markdown-Export + Obsidian-Integration | ✅ |
| 0.8 | + Formulare + Verschlüsselung + Bild→PDF + Compress | 🟡 Compress ✅ — Rest in Arbeit |
| 0.9 | + OCR (Tesseract.js) + Stapelverarbeitung | 🟡 OCR ✅ Phase 1 — Batch folgt |
| 1.0 | + Konvertierungen + A11y-Polish + Doku komplett + Tests | ⏳ |

**Zusatz** (außerhalb Pflichtenheft): Theme-Switcher (Auto/Light/Dark/Sepia), DE/EN-Sprachumschaltung, Sidecar Export/Import, pixel-genauer Text-Layer via PDF.js nativem `TextLayer`.

Details: [docs/02-lastenheft.md](docs/02-lastenheft.md) Abschnitt 6.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | Anforderungsdokument (Vision, FA-/NFA-IDs, Erfolgsktiterien) |
| [docs/02-lastenheft.md](docs/02-lastenheft.md) | Lastenheft (Auftraggeber-Sicht, MoSCoW-Priorisierung, Releases) |
| [docs/03-pflichtenheft.md](docs/03-pflichtenheft.md) | Pflichtenheft (Architektur, 17 Service-Interfaces, Test-Konzept, ADRs) |
| [docs/adrs/](docs/adrs/) | Architecture Decision Records — einzelne Entscheidungen im Detail |
| [CHANGELOG.md](CHANGELOG.md) | Was sich von Commit zu Commit ändert |

## Architektur (kurz)

- **Frontend:** Blazor WebAssembly auf .NET 10
- **PDF-Rendering:** PDF.js via JS-Interop (`pageboundPdf`-Bridge)
- **PDF-Manipulation:** Hybrid — pdf-lib (JS) für Save-Operationen (kein MD5-Crash unter WASM), PdfSharpCore für Page-Ops
- **OCR:** Tesseract.js im Web-Worker mit lazy-loaded Sprach-Modellen
- **Styling:** Tailwind CSS v4 mit CSS-Custom-Properties für Themes
- **State:** Service-basiert via DI, Interface-First (ADR-001)
- **Persistenz:** IndexedDB für Annotations + Library, JSON-Sidecar für Export/Import
- **Hosting:** Statisch (kein Server), Docker mit nginx im Mehrstufen-Build
- **Architektur-Prinzip:** Interface-First — jeder Service hinter `IXxxService`, DI nur gegen Interfaces

## Anti-Tracking

Pagebound enthält **keine Telemetrie und keinen externen Code, der ohne ausdrückliche Aktion lädt**. Tesseract.js zieht beim ersten OCR-Klick seine Sprach-Modelle aus dem offiziellen Project-CDN — alles andere läuft lokal im Browser. Kein Backend, keine Cookies, keine User-Konten.

## Mitwirken

Beiträge sind willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für Setup-Schritte, Code-Stil und Pull-Request-Prozess. Verhaltenskodex: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Lizenz

Apache License 2.0 — siehe [LICENSE](LICENSE) und Third-Party-Hinweise in [NOTICE](NOTICE).

---

*Pagebound ist nicht mit Adobe Inc. verbunden. „Adobe", „Acrobat" und „Acrobat Reader" sind eingetragene Marken von Adobe Inc.*
