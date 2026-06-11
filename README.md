# Pagebound

> **Schlanker, datenschutzfreundlicher Adobe-Acrobat-Reader-Ersatz als Open-Source-PWA.**
> Blazor WebAssembly · .NET 10 · Apache License 2.0

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4.svg)](https://dotnet.microsoft.com/)
[![Status](https://img.shields.io/badge/Status-Beta-brightgreen.svg)](#status)

> **Beta — im Alltag voll nutzbar.** Läuft zu 100 % im Browser, nichts wird hochgeladen.
>
> 🌐 **Live ausprobieren:** **[pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev)** — oder lokal via Docker / `dotnet run` (s. u.).

---

## Was ist Pagebound?

Pagebound ist ein quelloffenes PDF-Werkzeug, das den Adobe Acrobat Reader im Alltag vollständig ersetzen will — schlank, schnell, datenschutzfreundlich, ohne Cloud-Zwang, ohne Telemetrie, ohne Pro-Paywall. Plus drei Knowledge-Worker-Features, die Acrobat fehlen:

- 📝 **PNG-Signatur mit Hash-Integrität** — signiere PDFs mit deiner Unterschrift als Bild, mit Signer-Metadaten direkt im PDF-Info-Dictionary; jede nachträgliche Änderung an Highlights/Notes lässt das Hash-Badge auf der Signatur von grün auf rot springen.
- 📚 **Library mit Sidecar-Dateien** — alle Annotationen + Metadaten als JSON neben der PDF, mit Tags, Inline-Filter und schlanker Such-Funktion.
- 🔗 **Markdown-Export für Obsidian/Zettelkasten** — Highlights und Notizen rauskippen als Markdown mit YAML-Frontmatter (Wikilink-Optionen, page-grouped, Y-sortiert).

## Funktionen

- **Viewer** — PDFs öffnen, Seitennavigation, Zoom, Volltext-Suche, Inhaltsverzeichnis-Sidebar, Thumbnails; **Nachtmodus** (invertierte Anzeige) und **fortlaufende Leseansicht**
- **Split-View** — zwei PDFs nebeneinander (eigene Navigation/Annotation/Suche je Pane), ziehbare Trennlinie + optionales Synchron-Scrollen
- **Annotieren** — Text-Highlights (5 Farben), Sticky Notes mit Markdown-Vorschau, Stift, Rechteck/Pfeil/Linie
- **Annotationen einbrennen (Flatten)** — Highlights, Notizen, Stift, Formen und Signaturen fest in die PDF brennen → eigenständige „flache" Datei
- **Schwärzen / Redaktion** — Bereiche dauerhaft schwärzen; der Inhalt darunter wird **entfernt** (echte Redaktion, nicht nur überdeckt), optional mit **Audit-Report** (SHA-256 vorher/nachher + Resttext-Prüfung)
- **Signieren** — PNG-Signatur platzieren (Drag/Resize) + Signer-Daten + Hash-Integritäts-Badge
- **Formulare & Metadaten** — AcroForms ausfüllen (Text/Checkbox/Radio/Dropdown/Listbox, editierbar/geflattet), **Formularfelder anlegen** (Text/Checkbox) und **Dokument-Metadaten** (Titel/Autor/Betreff/Stichwörter) lesen & setzen — alles in /tools
- **Seiten-Werkzeuge** — Merge, Split, Neu-Sortieren, Löschen, Drehen, JPEG-Komprimierung
- **Stempeln** — diagonales Text-Wasserzeichen und/oder Seitenzahlen (Bates) auf jede Seite
- **Bilder → PDF** — PNG/JPG zu PDF (Seitengröße wählbar, Reihenfolge per Drag & Drop)
- **Konvertieren** — PDF → PNG/JPG (ZIP, je Seite ein Bild), reiner Text (.txt), eigenständiges HTML oder **CSV** (Best-Effort-Tabellen-Extraktion)
- **Stapelverarbeitung** — mehrere PDFs auf einmal komprimieren / verschlüsseln / → Text, Ergebnis als eine ZIP; **gespeicherte Regeln** (benannte Presets)
- **Verschlüsseln** — Passwortschutz mit AES-256 (WebCrypto, gegen PDF.js verifiziert)
- **OCR** — Tesseract.js für nicht-durchsuchbare PDFs (Scans, Designer-Layouts), **100 % self-hosted** (kein CDN)
- **Library** — automatisch erfasst, Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), optionaler zentraler Sidecar-Workspace-Ordner, JSON-Sidecar-Export/Import
- **Markdown-Export** — Highlights + Notizen, Obsidian-kompatibel (YAML-Frontmatter, Wikilinks)
- **WYSIWYG-Designer** (`/editor`) — Flyer, Briefe, Rechnungen (mit §-19-Vorlage), Geschäftsbriefe (DIN 5008) und 16:9-Folien direkt im Browser entwerfen: mehrseitiger Block-Editor (Überschrift/Text/Bild/Form/Tabelle), **Design-Themes** (6 Presets, anpassbar, als JSON exportier-/importierbar), Text- & Hintergrundfarben, Seiten-Hintergrundbilder (Deckkraft/Position/Kacheln, auch WebP), Flyer-Formate **DIN lang & A6**, **frei platzierbare Overlays** (Text/Bild/Fläche mit Touch-fähigem Drag/Resize, Drehung, Deckkraft), **Spalten- & QR-Code-Blöcke**, Bild-Werkzeuge (Eckenradius/Rahmen/Schatten, Auto-Kompression), **Serie aus CSV** (`{{platzhalter}}`), Tastatur-Shortcuts, Schriftgröße pro Block, **Undo/Redo**, Überlauf-Warnung, Schnittmarken; **Design-Ordner auf dem eigenen System** (Chromium-FSA-API) mit 5 mitgelieferten Standard-Designs — Designs wirken als **Schablonen** („Verwenden" lädt eine Kopie, nur „Template bearbeiten" schreibt in die Datei zurück); Export als **pixelgenaues PDF** (Print-CSS), HTML oder JSON — **JSON-Import** inklusive (Roundtrip); Entwürfe lokal in IndexedDB
- **Formular-Builder** (`/form-builder`) — Text-/Checkbox-Felder **per Klick auf der PDF-Seite platzieren**, ziehen & skalieren (auch Touch), Export als echtes **AcroForm-PDF**
- **PDF → PDF/A (Best Effort)** — XMP (pdfaid 2/B), sRGB-OutputIntent, Bereinigung (OpenAction/JS), optionales Flatten; nicht eingebettete Fonts werden **ehrlich als Warnung gemeldet** (keine Konformitätsgarantie — extern z. B. mit veraPDF prüfen)
- **PDF-Vergleich** — zwei PDFs auf Text-Ebene vergleichen (wortgenau, seitenweise), in der **Split-View** (`/compare` leitet dorthin um), komplett lokal
- **MCP-Server für LLM-Agenten** — Pagebounds PDF-Operationen **tokenlos**, lokal über **stdio** oder **gehostet** über **Streamable HTTP** (`…/mcp`); **22 Tools** (Seiten-Werkzeuge, Split, Stempeln, AES-256-Verschlüsselung, AcroForm-Formulare lesen/ausfüllen/anlegen, Metadaten, **PDF/A Best-Effort**, Text, Text-Diff/Vergleich, Tabellen→CSV, Bilder→PDF, **Designer**: Designs erzeugen/validieren/als HTML rendern im PWA-kompatiblen `*.pbdesign.json`-Format), base64-I/O mit Größen-/Seiten-Limits
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

## Status

**Beta — im Alltag voll nutzbar.** Alle Kernfunktionen sind implementiert, durch Unit- und E2E-Tests abgedeckt und unter [pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev) live (App + gehosteter MCP-Server). Ein offizieller `1.0`-Release-Tag steht noch aus.

### Geplant

- **A11y-Tagging** (PDF/UA) für Barrierefreiheit; PDF/A über den Best-Effort-Konverter hinaus härten (Font-Einbettung)
- **Digitale Signaturen** (PAdES/eIDAS, zertifikatsbasiert) als Ergänzung zur Bild-+-Hash-Signatur
- **Mobile-/Touch-Politur** und **Streaming-Rendering** für sehr große Dateien
- **Öffentlicher Release-Tag** (`v1.0`)

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/05-benutzerhandbuch.md](docs/05-benutzerhandbuch.md) | **Benutzerhandbuch** — alle Funktionen für Endnutzer (Reader, Annotationen, Werkzeuge, Konvertieren, Stapel, Verschlüsselung, Workspace, Tastatur, Datenschutz) |
| [docs/04-deployment-guide.md](docs/04-deployment-guide.md) | **Deployment-Guide** — Docker, dotnet run, static hosting, CI/CD, TLS, Troubleshooting |
| [mcp/README.md](mcp/README.md) | **MCP-Server** — Pagebounds PDF-Operationen für LLM-Agenten, tokenlos: lokal (stdio) **oder gehostet** (Streamable HTTP, `https://pagebound.app.lupusmalus.dev/mcp`) |
| [CHANGELOG.md](CHANGELOG.md) | Änderungen von Release zu Release |

## Architektur (kurz)

- **Frontend:** Blazor WebAssembly auf .NET 10
- **PDF-Rendering:** PDF.js via JS-Interop (`pageboundPdf`-Bridge)
- **PDF-Manipulation:** vollständig pdf-lib (JS) — Merge/Split/Reorder/Delete/Rotate, Compress, Bild→PDF, Signatur-Embed. PdfSharpCore ist **nicht** im Web-Pfad (sein Save-Pfad ruft `MD5.Create()` auf, das unter Blazor WASM crasht)
- **Verschlüsselung:** AES-256 (ISO 32000-2 V5/R6) via WebCrypto — hardware-beschleunigt, kein MD5, im Browser gegen PDF.js verifiziert
- **Formulare:** AcroForms lesen + ausfüllen über die pdf-lib-Form-API (alle Standard-Feldtypen)
- **OCR:** Tesseract.js im Web-Worker mit lazy-loaded Sprach-Modellen, vollständig self-hosted (kein CDN)
- **WYSIWYG-Designer:** nativer Block-Editor (contentEditable, **kein** Fremd-Editor/CDN), PDF-Export über den Browser-Druck (Print-CSS + dynamische `@page`-Größe), Entwürfe als JSON in IndexedDB
- **Redaktion (Schwärzen):** betroffene Seiten werden via PDF.js rasterisiert und die Bereiche schwarz eingebrannt → Text/Vektor darunter wird **physisch entfernt** (echte Redaktion); unberührte Seiten bleiben vektor-treu
- **MCP-Server:** TypeScript (`@modelcontextprotocol/sdk`), Dual-Transport (stdio **und** Streamable HTTP), dieselben Engines wie die App (pdf-lib + pdfjs-dist); gehostet als eigener Node-Container hinter Caddy, tokenlos mit Größen-/Seiten-Limits
- **Styling:** „Warm Ink"-Design-System (warm-dunkle oklch-Tokens, editorial) auf Tailwind v4; self-gehostete Fonts (Newsreader/Hanken Grotesk/JetBrains Mono, kein Google-Fonts-Request); Theme/Akzent/Dichte/Schriftgröße/Bewegung im Settings-Panel (`pageboundTweaks` → CSS-Variablen + localStorage)
- **State & Persistenz:** Service-basiert via DI, Interface-First (jeder Service hinter `IXxxService`); IndexedDB für Annotations + Library, JSON-Sidecar für Export/Import
- **Hosting:** Statisch (kein Server), Docker mit nginx im Mehrstufen-Build

## Anti-Tracking

Pagebound enthält **keine Telemetrie und keinen externen Code** — und macht **keinerlei externe Requests**. Auch die OCR ist vollständig **self-hosted**: Tesseract.js-Worker, WASM-Core (`wwwroot/tesseract/`) und die Sprach-Modelle eng/deu (`wwwroot/tessdata/`) werden mit ausgeliefert, nichts kommt von einem CDN. Damit funktioniert OCR auch komplett offline. Kein Backend, keine Cookies, keine User-Konten. (Die CSP `connect-src 'self'` erzwingt das technisch.)

## Mitwirken

Beiträge sind willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md) für Setup-Schritte, Code-Stil und Pull-Request-Prozess. Verhaltenskodex: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Lizenz

Apache License 2.0 — siehe [LICENSE](LICENSE) und Third-Party-Hinweise in [NOTICE](NOTICE).

---

*Pagebound ist nicht mit Adobe Inc. verbunden. „Adobe", „Acrobat" und „Acrobat Reader" sind eingetragene Marken von Adobe Inc.*
