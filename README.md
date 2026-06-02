# Pagebound

> **Schlanker, datenschutzfreundlicher Adobe-Acrobat-Reader-Ersatz als Open-Source-PWA.**
> Blazor WebAssembly · .NET 10 · Apache License 2.0

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4.svg)](https://dotnet.microsoft.com/)
[![Status](https://img.shields.io/badge/Status-0.8_Beta-brightgreen.svg)](#status--roadmap)

> **Beta (0.8)** — voll nutzbar, alle 1.0-Inhalte sind drin (plus Extras: WYSIWYG-Designer, Redaktion, MCP-Server …).
>
> 🌐 **Live ausprobieren:** **[pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev)** — läuft zu 100 % im Browser, nichts wird hochgeladen. Lokal via Docker oder `dotnet run` (s. u.).

---

## Was ist Pagebound?

Pagebound ist ein quelloffenes PDF-Werkzeug, das den Adobe Acrobat Reader im Alltag vollständig ersetzen will — schlank, schnell, datenschutzfreundlich, ohne Cloud-Zwang, ohne Telemetrie, ohne Pro-Paywall. Plus drei Knowledge-Worker-Features, die Acrobat fehlen:

- 📝 **PNG-Signatur mit Hash-Integrität** — signiere PDFs mit deiner Unterschrift als Bild, mit Signer-Metadaten direkt im PDF-Info-Dictionary; jede nachträgliche Änderung an Highlights/Notes lässt das Hash-Badge auf der Signatur von grün auf rot springen.
- 📚 **Library mit Sidecar-Dateien** — alle Annotationen + Metadaten als JSON neben der PDF, mit Tags, Inline-Filter und schlanker Such-Funktion.
- 🔗 **Markdown-Export für Obsidian/Zettelkasten** — Highlights und Notizen rauskippen als Markdown mit YAML-Frontmatter (Wikilink-Optionen, page-grouped, Y-sortiert).

## Funktionen (bereits drin)

- **Viewer** — PDFs öffnen, Seitennavigation, Zoom, Volltext-Suche, Inhaltsverzeichnis-Sidebar, Thumbnails; **Nachtmodus** (invertierte Anzeige) und **fortlaufende Leseansicht**
- **Split-View** — zwei PDFs nebeneinander (eigene Navigation/Annotation/Suche je Pane), ziehbare Trennlinie + optionales Synchron-Scrollen
- **Annotieren** — Text-Highlights (5 Farben), Sticky Notes mit Markdown-Vorschau, Stift, Rechteck/Pfeil/Linie
- **Annotationen einbrennen (Flatten)** — Highlights, Notizen, Stift, Formen und Signaturen fest in die PDF brennen → eigenständige „flache" Datei
- **Schwärzen / Redaktion** — Bereiche dauerhaft schwärzen; der Inhalt darunter wird **entfernt** (echte Redaktion, nicht nur überdeckt)
- **Signieren** — PNG-Signatur platzieren (Drag/Resize) + Signer-Daten + Hash-Integritäts-Badge
- **Formulare** — AcroForms ausfüllen (Text/Checkbox/Radio/Dropdown/Listbox), editierbar oder geflattet speichern
- **Seiten-Werkzeuge** — Merge, Split, Neu-Sortieren, Löschen, Drehen, JPEG-Komprimierung
- **Stempeln** — diagonales Text-Wasserzeichen und/oder Seitenzahlen (Bates) auf jede Seite
- **Bilder → PDF** — PNG/JPG zu PDF (Seitengröße wählbar, Reihenfolge per Drag & Drop)
- **Konvertieren** — PDF → PNG/JPG (ZIP, je Seite ein Bild), reiner Text (.txt) oder eigenständiges HTML
- **Stapelverarbeitung** — mehrere PDFs auf einmal komprimieren / verschlüsseln / → Text, Ergebnis als eine ZIP
- **Verschlüsseln** — Passwortschutz mit AES-256 (WebCrypto, gegen PDF.js verifiziert)
- **OCR** — Tesseract.js für nicht-durchsuchbare PDFs (Scans, Designer-Layouts)
- **Library** — automatisch erfasst, Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), optionaler zentraler Sidecar-Workspace-Ordner, JSON-Sidecar-Export/Import
- **Markdown-Export** — Highlights + Notizen, Obsidian-kompatibel (YAML-Frontmatter, Wikilinks)
- **WYSIWYG-Designer** (`/editor`) — Flyer, Briefe, Rechnungen (mit §-19-Vorlage), Geschäftsbriefe (DIN 5008) und 16:9-Folien direkt im Browser entwerfen: Block-Editor (Überschrift/Text/Bild/Form/Tabelle), Text- & Hintergrundfarben, Schnittmarken; Export als **pixelgenaues PDF** (Print-CSS), HTML oder JSON; Entwürfe lokal in IndexedDB
- **MCP-Server für LLM-Agenten** — Pagebounds PDF-Operationen **tokenlos**, lokal über **stdio** oder **gehostet** über **Streamable HTTP** (`…/mcp`); **16 Tools** (Seiten-Werkzeuge, Split, Stempeln, AES-256-Verschlüsselung, AcroForm-Formulare lesen/ausfüllen/**anlegen**, Metadaten, Text, **Text-Diff/Vergleich**, Bilder→PDF), base64-I/O mit Größen-/Seiten-Limits
- **Darstellung** — „Warm Ink"-Design, Settings-Panel mit Theme (Hell/Dunkel), **8 Akzentfarben**, Schriftgröße, Dichte & Bewegung; DE/EN, Offline-PWA, keine Telemetrie

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
| 0.5 | + Library + Tabelle/Grid/Liste + Tags + Auto-Collapse-Sidebar + Sidecar-Workspace | ✅ |
| 0.6 | + Multi-PDF Split-View + Sync-Scroll + ziehbare Trennlinie | ✅ |
| 0.7 | + Markdown-Export + Obsidian-Integration | ✅ |
| 0.8 | + Formulare + Verschlüsselung + Bild→PDF + Compress | ✅ |
| 0.9 | + OCR (Tesseract.js) + Stapelverarbeitung | ✅ (gespeicherte Batch-Regeln FA-052 folgen) |
| 1.0 | + Konvertierungen + Redesign + Security-Check + A11y (WCAG AA) + Doku + Tests | ✅ Inhalt komplett (Konvertierungen, „Warm Ink"-Redesign, Security-Check, A11y WCAG AA, E2E-Harness, Coverage 75 %, Benutzerhandbuch) — Release (Tag + public) ausstehend |

**Zusatz** (außerhalb Pflichtenheft): „Warm Ink"-Redesign mit Settings/Tweaks (Dark/Light, 8 Akzentfarben, Schriftgröße, Dichte, Bewegung), DE/EN-Sprachumschaltung, Sidecar Export/Import, pixel-genauer Text-Layer via PDF.js nativem `TextLayer`.

**Beta-Erweiterungen** (nach 1.0-Inhalt): Stempeln (Wasserzeichen/Seitenzahlen), **Annotationen einbrennen**, **Schwärzen/Redaktion**, **Reader-Komfort** (Nachtmodus + fortlaufende Ansicht), **WYSIWYG-Designer** (`/editor`, mehrseitig — Flyer Vorder-/Rückseite, Folien-Decks, Seiten-Hintergrundbilder), **100 % self-hosted OCR** (kein CDN, keine externen Requests), ein **gehosteter MCP-Server** (auf **16 Tools** ausgebaut — Split, Stempeln, AES-256-Verschlüsselung, AcroForm-Formulare lesen/ausfüllen/**anlegen**, Metadaten und **Text-Diff/Vergleich** ergänzt) und ein **Live-Deployment** unter [pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev).

### Ausblick / Geplant

Aus der Wettbewerbsanalyse priorisiert (Nutzen ↔ Aufwand). ✅ = bereits umgesetzt.

| Vorhaben | Nutzen | Aufwand | Status |
|---|---|---|---|
| **PDF-Vergleich (Text-Diff)** — als MCP-Tool ✅, im Reader (Split-View-Diff) geplant | hoch | M | MCP ✅ / Reader geplant |
| **Redaktions-Audit** (Report: keine Resttext-Layer, Hash vorher/nachher) | hoch (Kanzlei-Vertrauen) | S–M | geplant |
| **Tabellen-Extraktion** (PDF→CSV/strukturiert), auch als MCP-Tool | hoch | M–L | geplant |
| **Weitere MCP-Tools** (Metadaten ✅, Feld-Anlegen ✅; Konvertierung, Tabellen geplant) | hoch | M | teilweise ✅ |
| **Formular-*Erstellung*** — Felder anlegen via MCP (`pdf_create_field`) ✅, Designer-Form-Builder geplant | mittel-hoch | L | MCP ✅ / UI geplant |
| **PDF/A-Export** (Archivierung) + **A11y-Tagging** (PDF/UA) | hoch (Behörden/Recht) | M–L | geplant |
| **Digitale Signaturen (PAdES/eIDAS)** — zertifikatsbasiert statt Bild+Hash | sehr hoch | XL | geplant |
| **Mobile-/Touch-UX-Politur** (Tablet-Annotation, Stift) | mittel-hoch | M | geplant |
| **Große Dateien** (Streaming-/Lazy-Rendering jenseits der WASM-RAM-Grenze) | mittel | L | geplant |
| **Öffentlicher Release** (Tag) + gespeicherte Batch-Regeln (FA-052) | — | S | geplant |

Details: [docs/02-lastenheft.md](docs/02-lastenheft.md) Abschnitt 6.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/05-benutzerhandbuch.md](docs/05-benutzerhandbuch.md) | **Benutzerhandbuch** — alle Funktionen für Endnutzer (Reader, Annotationen, Werkzeuge, Konvertieren, Stapel, Verschlüsselung, Workspace, Tastatur, Datenschutz) |
| [docs/01-requirements.md](docs/01-requirements.md) | Anforderungsdokument (Vision, FA-/NFA-IDs, Erfolgsktiterien) |
| [docs/02-lastenheft.md](docs/02-lastenheft.md) | Lastenheft (Auftraggeber-Sicht, MoSCoW-Priorisierung, Releases) |
| [docs/03-pflichtenheft.md](docs/03-pflichtenheft.md) | Pflichtenheft (Architektur, 17 Service-Interfaces, Test-Konzept, ADRs) |
| [docs/04-deployment-guide.md](docs/04-deployment-guide.md) | Deployment-Guide (Docker, dotnet run, static hosting, CI/CD, TLS, Troubleshooting) |
| [mcp/README.md](mcp/README.md) | **MCP-Server** — Pagebounds PDF-Operationen für LLM-Agenten, tokenlos: lokal (stdio) **oder gehostet** (Streamable HTTP, `https://pagebound.app.lupusmalus.dev/mcp`) |
| [docs/adrs/](docs/adrs/) | Architecture Decision Records — einzelne Entscheidungen im Detail |
| [CHANGELOG.md](CHANGELOG.md) | Was sich von Commit zu Commit ändert |

## Architektur (kurz)

- **Frontend:** Blazor WebAssembly auf .NET 10
- **PDF-Rendering:** PDF.js via JS-Interop (`pageboundPdf`-Bridge)
- **PDF-Manipulation:** vollständig pdf-lib (JS) — Merge/Split/Reorder/Delete/Rotate, Compress, Bild→PDF, Signatur-Embed. PdfSharpCore ist **nicht** im Web-Pfad (sein Save-Pfad ruft `MD5.Create()` auf, das unter Blazor WASM crasht)
- **Verschlüsselung:** AES-256 (ISO 32000-2 V5/R6) via WebCrypto — hardware-beschleunigt, kein MD5, im Browser gegen PDF.js verifiziert
- **Formulare:** AcroForms lesen + ausfüllen über die pdf-lib-Form-API (alle Standard-Feldtypen)
- **OCR:** Tesseract.js im Web-Worker mit lazy-loaded Sprach-Modellen
- **WYSIWYG-Designer:** nativer Block-Editor (contentEditable, **kein** Fremd-Editor/CDN), PDF-Export über den Browser-Druck (Print-CSS + dynamische `@page`-Größe), Entwürfe als JSON in IndexedDB
- **Redaktion (Schwärzen):** betroffene Seiten werden via PDF.js rasterisiert und die Bereiche schwarz eingebrannt → Text/Vektor darunter wird **physisch entfernt** (echte Redaktion); unberührte Seiten bleiben vektor-treu
- **MCP-Server:** TypeScript (`@modelcontextprotocol/sdk`), Dual-Transport (stdio **und** Streamable HTTP), dieselben Engines wie die App (pdf-lib + pdfjs-dist); gehostet als eigener Node-Container hinter Caddy, tokenlos mit Größen-/Seiten-Limits
- **Styling:** „Warm Ink"-Design-System (warm-dunkle oklch-Tokens, editorial) auf Tailwind v4; self-gehostete Fonts (Newsreader/Hanken Grotesk/JetBrains Mono, kein Google-Fonts-Request); Theme/Akzent/Dichte/Schriftgröße/Bewegung im Settings-Panel (`pageboundTweaks` → CSS-Variablen + localStorage)
- **State:** Service-basiert via DI, Interface-First (ADR-001)
- **Persistenz:** IndexedDB für Annotations + Library, JSON-Sidecar für Export/Import
- **Hosting:** Statisch (kein Server), Docker mit nginx im Mehrstufen-Build
- **Architektur-Prinzip:** Interface-First — jeder Service hinter `IXxxService`, DI nur gegen Interfaces

## Anti-Tracking

Pagebound enthält **keine Telemetrie und keinen externen Code** — und macht **keinerlei externe Requests**. Auch die OCR ist vollständig **self-hosted**: Tesseract.js-Worker, WASM-Core (`wwwroot/tesseract/`) und die Sprach-Modelle eng/deu (`wwwroot/tessdata/`) werden mit ausgeliefert, nichts kommt von einem CDN. Damit funktioniert OCR auch komplett offline. Kein Backend, keine Cookies, keine User-Konten. (Die CSP `connect-src 'self'` erzwingt das technisch.)

## Mitwirken

Beiträge sind willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für Setup-Schritte, Code-Stil und Pull-Request-Prozess. Verhaltenskodex: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Lizenz

Apache License 2.0 — siehe [LICENSE](LICENSE) und Third-Party-Hinweise in [NOTICE](NOTICE).

---

*Pagebound ist nicht mit Adobe Inc. verbunden. „Adobe", „Acrobat" und „Acrobat Reader" sind eingetragene Marken von Adobe Inc.*
