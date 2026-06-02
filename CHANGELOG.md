# Changelog

Alle nennenswerten Änderungen an Pagebound werden in dieser Datei dokumentiert.
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Beta] — aktueller Stand

Pagebound ist im Alltag voll nutzbar und live unter
[pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev) (App +
gehosteter MCP-Server). Ein offizieller `1.0`-Release-Tag steht noch aus. Diese
Liste fasst den aktuellen Funktionsumfang zusammen.

### Reader & Annotation
- Viewer mit Seitennavigation, Zoom, Volltext-Suche, Outline, Thumbnails
- Nachtmodus + fortlaufende Leseansicht
- Split-View für zwei PDFs (eigene Navigation/Suche je Pane, optionales Sync-Scrollen)
- Annotationen: Highlights (5 Farben), Sticky Notes mit Markdown, Stift, Formen (Rechteck/Pfeil/Linie)
- Annotationen einbrennen (Flatten) und echte Schwärzung/Redaktion (Inhalt wird physisch entfernt)
- PNG-Signatur mit Hash-Integritäts-Badge

### Werkzeuge
- Seiten-Operationen: Merge, Split, Reorder, Delete, Rotate, JPEG-Komprimierung
- AcroForms ausfüllen (alle Standard-Feldtypen), Stempeln (Wasserzeichen / Bates-Seitenzahlen)
- Bilder → PDF, Konvertierung PDF → PNG/JPG/Text/HTML, Stapelverarbeitung (ZIP)
- AES-256-Verschlüsselung (WebCrypto, gegen PDF.js verifiziert)
- OCR (Tesseract.js, 100 % self-hosted — kein CDN)
- PDF-Vergleich / Text-Diff unter `/compare`

### Library & Export
- Automatisch erfasste Library mit Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), zentralem Sidecar-Workspace
- JSON-Sidecar Export/Import, Markdown-Export (Obsidian-kompatibel, YAML-Frontmatter)

### Designer
- WYSIWYG-Block-Editor unter `/editor`: mehrseitig, Vorlagen (Rechnung § 19, DIN-5008-Brief, Flyer, 16:9-Folie), Text-/Hintergrundfarben, Seiten-Hintergrundbilder, Export als PDF/HTML/JSON

### MCP-Server
- Tokenloser MCP-Server für LLM-Agenten (stdio + Streamable HTTP), 16 Tools, gehostet unter `…/mcp` mit Größen-/Seiten-Limits

### Plattform
- Blazor WebAssembly (.NET 10), „Warm Ink"-Design (8 Akzentfarben, Hell/Dunkel, Dichte/Schriftgröße/Bewegung), DE/EN
- Offline-PWA, keine Telemetrie, keine externen Requests (CSP `connect-src 'self'`), self-hosted Fonts
- Docker + nginx Deployment, CI: Build, Unit-Tests, E2E (Playwright), Lighthouse-A11y
