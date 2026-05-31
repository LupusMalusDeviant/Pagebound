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

## Funktionen (bereits drin)

- **Viewer** — PDFs öffnen, Seitennavigation, Zoom, Volltext-Suche, Inhaltsverzeichnis-Sidebar, Thumbnails
- **Split-View** — zwei PDFs nebeneinander (eigene Navigation/Annotation/Suche je Pane), ziehbare Trennlinie + optionales Synchron-Scrollen
- **Annotieren** — Text-Highlights (5 Farben), Sticky Notes mit Markdown-Vorschau, Stift, Rechteck/Pfeil/Linie
- **Signieren** — PNG-Signatur platzieren (Drag/Resize) + Signer-Daten + Hash-Integritäts-Badge
- **Formulare** — AcroForms ausfüllen (Text/Checkbox/Radio/Dropdown/Listbox), editierbar oder geflattet speichern
- **Seiten-Werkzeuge** — Merge, Split, Neu-Sortieren, Löschen, Drehen, JPEG-Komprimierung
- **Bilder → PDF** — PNG/JPG zu PDF (Seitengröße wählbar, Reihenfolge per Drag & Drop)
- **Verschlüsseln** — Passwortschutz mit AES-256 (WebCrypto, gegen PDF.js verifiziert)
- **OCR** — Tesseract.js für nicht-durchsuchbare PDFs (Scans, Designer-Layouts)
- **Library** — automatisch erfasst, Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), JSON-Sidecar-Export/Import
- **Markdown-Export** — Highlights + Notizen, Obsidian-kompatibel (YAML-Frontmatter, Wikilinks)
- **Komfort** — Theme-Switcher (Auto/Hell/Dunkel/Sepia), DE/EN, Offline-PWA, keine Telemetrie

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
| 0.5 | + Library-Verwaltung + Tabelle/Grid/Liste-Ansichten + Tags | 🟡 Ansichten ✅ — Auto-Collapse-Sidebar + zentraler Workspace folgen |
| 0.6 | + Multi-PDF Split-View + Sync-Scroll + ziehbare Trennlinie | ✅ |
| 0.7 | + Markdown-Export + Obsidian-Integration | ✅ |
| 0.8 | + Formulare + Verschlüsselung + Bild→PDF + Compress | ✅ |
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
| [docs/04-deployment-guide.md](docs/04-deployment-guide.md) | Deployment-Guide (Docker, dotnet run, static hosting, CI/CD, TLS, Troubleshooting) |
| [docs/adrs/](docs/adrs/) | Architecture Decision Records — einzelne Entscheidungen im Detail |
| [CHANGELOG.md](CHANGELOG.md) | Was sich von Commit zu Commit ändert |

## Architektur (kurz)

- **Frontend:** Blazor WebAssembly auf .NET 10
- **PDF-Rendering:** PDF.js via JS-Interop (`pageboundPdf`-Bridge)
- **PDF-Manipulation:** vollständig pdf-lib (JS) — Merge/Split/Reorder/Delete/Rotate, Compress, Bild→PDF, Signatur-Embed. PdfSharpCore ist **nicht** im Web-Pfad (sein Save-Pfad ruft `MD5.Create()` auf, das unter Blazor WASM crasht)
- **Verschlüsselung:** AES-256 (ISO 32000-2 V5/R6) via WebCrypto — hardware-beschleunigt, kein MD5, im Browser gegen PDF.js verifiziert
- **Formulare:** AcroForms lesen + ausfüllen über die pdf-lib-Form-API (alle Standard-Feldtypen)
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
