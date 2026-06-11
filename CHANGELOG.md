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
- **Frei platzierbare Overlays** (Text/Bild/Fläche): Position/Größe in % der Seite, Pointer-Drag & -Resize (Maus, **Touch**, Stift), Drehung, Deckkraft, Stapel-Reihenfolge, Ellipsen — Flyer-Gestaltung über dem Block-Fluss
- **Spalten-Block** (2–4 Rich-Text-Spalten, Abstand einstellbar) und **QR-Code-Block** (lokal generiert, kein Netz)
- **Bild-Werkzeuge**: Eckenradius, Rahmen, Schatten; Bilder werden beim Einbetten automatisch komprimiert (max. 2000 px, JPEG-Re-Encode — kleinere Entwürfe/Sidecars)
- **Tastatur-Shortcuts**: Strg+S (Entwurf speichern), Strg+Z/Y (Struktur-Undo/Redo außerhalb der Textbearbeitung), Entf (Block/Overlay löschen)
- **Serie aus CSV**: Platzhalter wie `{{name}}` werden je CSV-Zeile ersetzt (Kopfzeile = Feldnamen, `,`/`;` automatisch erkannt, Werte HTML-encodiert) — Serienbriefe/-flyer als ein Mehrseiten-Dokument
- **PWA-File-Handler**: `.pbdesign.json`-Dateien lassen sich per Doppelklick direkt im Designer öffnen (installierte PWA, Chromium)

### Werkzeuge (neu)
- **Formular-Builder** (`/form-builder`): Felder (Text/Checkbox) per Klick auf gerenderten PDF-Seiten platzieren, per Pointer ziehen/skalieren (Maus/Touch/Stift), Namen editieren — Export als echtes AcroForm-PDF (ausfüllbar in jedem Reader); schließt die Roadmap-Lücke „visuelles Drag-Platzieren" (D1)
- **PDF → PDF/A (Best Effort)**: XMP-Metadaten (pdfaid 2/B), sRGB-OutputIntent (eingebettetes CC0-ICC-Profil), Entfernen von OpenAction/JavaScript/AA, optionales Formular-Flatten, Trailer-ID; **nicht eingebettete Schriften werden als Warnung gemeldet, nicht repariert** — keine Konformitätsgarantie, extern prüfen (z. B. veraPDF). In den PDF-Werkzeugen und als MCP-Tool `pdf_to_pdfa` (22 Tools)

- **PDF/A-Härtung**: Nicht eingebettete Standard-14-Schriften (Helvetica/Times/Courier) werden jetzt optional durch metrisch kompatible **Liberation-Fonts** ersetzt und eingebettet (SIL OFL 1.1, self-hosted, PWA lädt sie nur bei Bedarf) — die häufigste PDF/A-Warnung verschwindet damit; Symbol/ZapfDingbats und Sonder-Encodings bleiben ehrliche Warnungen
- **PDF/UA (Kennzeichnung + Bericht)**: setzt MarkInfo/Lang/DisplayDocTitle + XMP `pdfuaid`, prüft und meldet Tagging-Status (StructTreeRoot), Titel, Alt-Texte und ToUnicode — explizit ohne Konformitätsgarantie, echtes Tagging bleibt außerhalb des Scopes. In den PDF-Werkzeugen und als MCP-Tool `pdf_ua_prepare`
- **Zertifikatsbasierte PDF-Signatur (P12/PFX)**: klassische PDF-32000-Signatur (`adbe.pkcs7.detached`, SHA-256, CMS mit signierten Attributen) — in Adobe/Foxit prüfbar; Zertifikat und Passwort verlassen den Browser nie. In den PDF-Werkzeugen und als MCP-Tool `pdf_sign`. Ehrliche Grenzen: kein PAdES-B-T (kein Zeitstempel-Server — offline-first), kein LTV, ohne signingCertificateV2; bereits signierte PDFs werden abgelehnt
- **Vergleichsmodus startet automatisch**, sobald in der Split-View beide PDFs geladen sind (`/split?compare=1`)
- **Werkzeug-Ergebnisse zurück in den Reader**: Nach einer Aktion im „Werkzeuge"-Tab bietet ein Banner „Im Reader öffnen" an — das Ergebnis ersetzt das geöffnete Dokument ohne Datei-Dialog
- **Touch-Umsortieren von Blöcken** im Designer (Pointer-Drag am Grip-Handle mit Ziel-Markierung; Maus nutzt weiter natives Drag & Drop)
- **Bild-Zuschnitt** im Designer: vier Kanten-Regler mit Live-Vorschau (clip-path), „Anwenden" backt den Zuschnitt per Canvas ein (Undo-fähig)

### UI-Konsolidierung
- **Split-View & Vergleich zusammengeführt**: `/compare` leitet auf die Split-View im Vergleichsmodus um (`/split?compare=1`); eine gemeinsame Diff-Engine/-Anzeige statt zweier Implementierungen, ein Navigationseintrag statt zwei
- **PDF-Werkzeuge im Reader**: Tab-Leiste „Dokument | Werkzeuge" direkt im Reader-Fenster — das geöffnete PDF wird in die Werkzeuge übernommen (kein erneutes Laden); `/tools` bleibt als eigenständige Seite erhalten (gleiche Komponente)

### MCP-Server
- Tokenloser MCP-Server für LLM-Agenten (stdio + Streamable HTTP), 24 Tools (inkl. `pdf_sign`, `pdf_to_pdfa`, `pdf_ua_prepare`), gehostet unter `…/mcp` mit Größen-/Seiten-Limits
- **Designer-Tools** (`design_catalog`, `design_create`, `design_validate`, `design_render_html`): Pagebound-Designs im PWA-kompatiblen Format (`*.pbdesign.json`) auflisten, aus Vorlagen erzeugen (Titel/Theme/Layout überschreibbar), validieren/normalisieren und als druckbares Standalone-HTML rendern

### Plattform
- Blazor WebAssembly (.NET 10), „Warm Ink"-Design (8 Akzentfarben, Hell/Dunkel, Dichte/Schriftgröße/Bewegung), DE/EN
- Offline-PWA mit sanftem Update-Hinweis (neuer Service-Worker → „Neu laden"-Banner statt stillem Stale-Cache), keine Telemetrie, keine externen Requests (CSP `connect-src 'self'`), self-hosted Fonts
- Docker + nginx Deployment, CI: Build, Unit-Tests, E2E (Playwright), Lighthouse-A11y
