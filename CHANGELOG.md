# Changelog

Alle nennenswerten Änderungen an Pagebound werden in dieser Datei dokumentiert.
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.9.0-beta] — 2026-06-11

Pagebound ist im Alltag voll nutzbar und live unter
[pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev) (App +
gehosteter MCP-Server). Ein offizieller `1.0`-Release-Tag steht noch aus. Diese
Liste fasst den aktuellen Funktionsumfang zusammen.

### Reader & Annotation
- Viewer mit Seitennavigation, Zoom, Volltext-Suche, Outline, Thumbnails
- Nachtmodus + fortlaufende Leseansicht
- Split-View für zwei PDFs (eigene Navigation/Suche je Pane, optionales Sync-Scrollen, Text-Vergleich beider PDFs)
- Annotationen: Highlights (5 Farben), Sticky Notes mit Markdown, Stift, Formen (Rechteck/Pfeil/Linie)
- Annotationen einbrennen (Flatten) und echte Schwärzung/Redaktion (Inhalt wird physisch entfernt) — mit optionalem Audit-Report (SHA-256 vorher/nachher + Resttext-Prüfung)
- PNG-Signatur mit Hash-Integritäts-Badge

### Werkzeuge
- Seiten-Operationen: Merge, Split, Reorder, Delete, Rotate, JPEG-Komprimierung
- AcroForms ausfüllen + Formularfelder anlegen (Text/Checkbox) + Dokument-Metadaten setzen (alles in /tools), Stempeln (Wasserzeichen / Bates-Seitenzahlen)
- Bilder → PDF, Konvertierung PDF → PNG/JPG/Text/HTML/CSV (Best-Effort-Tabellen-Extraktion), Stapelverarbeitung (ZIP) mit gespeicherten Regeln
- AES-256-Verschlüsselung (WebCrypto, gegen PDF.js verifiziert)
- OCR (Tesseract.js, 100 % self-hosted — kein CDN)
- PDF-Vergleich / Text-Diff unter `/compare` und direkt in der Split-View

### Library & Export
- Automatisch erfasste Library mit Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), zentralem Sidecar-Workspace
- JSON-Sidecar Export/Import, Markdown-Export (Obsidian-kompatibel, YAML-Frontmatter)

### Designer
- WYSIWYG-Block-Editor unter `/editor`: mehrseitig, Vorlagen (Rechnung § 19, DIN-5008-Brief, Flyer, 16:9-Folie), Text-/Hintergrundfarben, Seiten-Hintergrundbilder, Export als PDF/HTML/JSON
- **Design-Themes**: 6 eingebaute Presets (Klassik/Modern/Editorial/Dunkel/Frisch/Elegant) mit dokumentweiten Schriften (selbst gehostete Fonts) und Farben (Überschrift/Text/Akzent/Seite), frei anpassbar, Export/Import als JSON-Theme-Datei
- **Hintergrund-Grafiken**: Deckkraft, Ausrichtung (oben/mittig/unten), Kacheln für Muster, „auf alle Seiten übernehmen"; WebP zusätzlich zu PNG/JPG
- **Flyer-Formate**: DIN lang hoch (105 × 210 mm) und DIN A6 quer (Postkarte)
- **Undo/Redo** für Struktur-Änderungen (Blöcke/Seiten/Theme/Layout, bis 50 Schritte)
- **JSON-Import** (Roundtrip zum JSON-Export) mit DOM-basiertem HTML-Sanitizer und Werte-Validierung (nur Hex-Farben/`data:image`-URLs)
- **Überlauf-Warnung** pro Seite, wenn Inhalt das Papierformat sprengt (würde im PDF abgeschnitten)
- Schriftgröße pro Block (pt), gefüllte Rechtecke (Farbflächen); Fix: Tabellenkopf-Hintergrund griff im Editor/Druck nie (`thead`-Selektor ohne `thead`-Element)
- **Design-Ordner auf dem Ausführungssystem** (File-System-Access-API, Chromium): frei wählbarer Ordner für Designs als `*.pbdesign.json`, Handle überlebt Sessions (IndexedDB); Designs sind **Schablonen** — „Verwenden" lädt eine Kopie und lässt die Datei unangetastet, nur der explizite Modus **„Template bearbeiten"** schreibt zurück
- **5 Standard-Designs** zum Ablegen in den Ordner (Event-Flyer DIN lang, Party-Flyer dunkel, Postkarte A6, Speisekarte, Vereins-Flyer) — vorhandene Dateien werden beim Ablegen nie überschrieben
- **UI-Redesign der Bedienflächen**: alle Emojis durch stroke-basierte Inline-SVG-Icons ersetzt (folgen `currentColor`/Theme), konsistente Button-Höhen, Hover-/Fokus-/Disabled-Zustände
- **Mobile-Tauglichkeit**: Werkzeug-Seitenleiste als einblendbarer Drawer (mit Backdrop), Zoom der Seiten-Leinwand mit **Auto-Fit** (Seite passt sich der Viewport-Breite an; Druck bleibt unverändert in Originalgröße), kompaktere Bühne auf kleinen Screens
- **Drag & Drop**: Blöcke per Grip-Handle umsortieren (auch seitenübergreifend, mit Einfüge-Indikator), Seiten in der Seitenliste per Drag sortieren, Bilder direkt auf die Leinwand ziehen (werden Bild-Blöcke auf der Zielseite), JSON-/Design-Dateien per Drop importieren

### MCP-Server
- Tokenloser MCP-Server für LLM-Agenten (stdio + Streamable HTTP), 21 Tools (inkl. `pdf_extract_tables`), gehostet unter `…/mcp` mit Größen-/Seiten-Limits
- **Designer-Tools** (`design_catalog`, `design_create`, `design_validate`, `design_render_html`): Pagebound-Designs im PWA-kompatiblen Format (`*.pbdesign.json`) auflisten, aus Vorlagen erzeugen (Titel/Theme/Layout überschreibbar), validieren/normalisieren und als druckbares Standalone-HTML rendern

### Plattform
- Blazor WebAssembly (.NET 10), „Warm Ink"-Design (8 Akzentfarben, Hell/Dunkel, Dichte/Schriftgröße/Bewegung), DE/EN
- Offline-PWA mit sanftem Update-Hinweis (neuer Service-Worker → „Neu laden"-Banner statt stillem Stale-Cache), keine Telemetrie, keine externen Requests (CSP `connect-src 'self'`), self-hosted Fonts
- Docker + nginx Deployment, CI: Build, Unit-Tests, E2E (Playwright), Lighthouse-A11y
