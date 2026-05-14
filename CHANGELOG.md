# Changelog

Alle nennenswerten Änderungen an Pagebound werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added
- Initiale Projekt-Spezifikation: Anforderungsdokument, Lastenheft, Pflichtenheft
- Repo-Skelett: .NET-Solution-Struktur, Lizenz, CI-Skelett, Doku-Standard-Dateien
- Tailwind CSS v4 Setup mit Light/Dark/Sepia-Themes (`wwwroot/css/app.src.css`, `package.json`)
- 8 Service-Interfaces in `Pagebound.Core/Abstractions/`: `IPdfRenderer`, `IAnnotationService`, `ISidecarService`, `IStorageService`, `IHashService`, `IThemeService`, `ILocalizationService`, `ITelemetryService` (Interface-First, ADR-001)
- Domain-Records in `Pagebound.Core/Domain/`: `PdfDocumentHandle`, `Annotation`, `Sidecar`, `LibraryEntry`, `IntegrityRecord`, Enums `HashAlgorithm`/`ThemeName`/`AnnotationType`/`IntegrityStatus`
- Zwei vollständige Service-Implementierungen: `NoOpTelemetryService`, `Sha256HashService`
- i18n-Ressourcen `wwwroot/resources/de.json` und `en.json`
- DI-Registrierungen in `Program.cs` gegen Interfaces
- **PDF.js-Integration**: TypeScript-Bridge `wwwroot/js/pdfjs-bridge.ts` (esbuild-Bundle als IIFE-Global `pageboundPdf`), Worker-Datei `pdf.worker.min.mjs` aus pdfjs-dist
- **`PdfJsRenderer`** in `Pagebound.Infrastructure/Pdf/`: erste Implementation von `IPdfRenderer` (`LoadAsync`, `RenderPageAsync`, `UnloadAsync` vollständig; `ExtractTextAsync`/`SearchAsync`/`GetOutlineAsync` als `NotImplementedException` mit TODO)
- `Microsoft.JSInterop` (10.0.8) als Paket-Referenz in `Pagebound.Infrastructure`
- **Reader-Demo-Page** unter `/reader`: File-Picker, Seitennavigation, Zoom-Stufen (75/100/150/200 %)
- `esbuild.mjs` + `tsconfig.json` für JS-Interop-Bundling
- npm-Scripts erweitert: `build` (CSS+JS), `build:js`, `watch:js`, `typecheck`
- CI-Workflow nutzt `npm run build` (zuvor nur `build:css`)
- Navigation in `MainLayout` mit `NavLink`-Items (Start, Reader)
- **Docker-Setup für lokales / Self-Hosted-Deployment**: Multi-Stage `Dockerfile` (Node-Stage baut Tailwind+esbuild, .NET-10-Stage `dotnet publish`, `nginx:alpine`-Stage liefert statische Site), `infra/docker/nginx.conf` mit korrekten MIME-Types für WASM/PWA/PDF.js und SPA-Fallback auf `index.html`, `.dockerignore` für schlanken Build-Kontext

### Fixed
- Reader-Layout nutzt jetzt die volle Breite des Hauptbereichs — Controls (Header, File-Picker, Navigation, Zoom-Buttons) bleiben auf `max-w-4xl` mittig zentriert, das PDF-`<figure>` nimmt den verfügbaren Platz bis `max-w-[1800px]`. Zoom-Faktoren neu gemappt: der angezeigte „100 %"-Default entspricht jetzt einem internen PDF.js-Scale von 2.0 (vorher 1.5), Stufen jetzt 50 / 75 / 100 / 125 / 150 / 200 %.
- Such-Eingabe bindet jetzt auf `oninput` statt nur `onchange` — Suchen-Button wird sofort beim Tippen aktiv, kein Klick aus dem Feld mehr nötig.
- `buildPageText` in der PDF.js-Bridge fügt einzelne Glyphen wieder zu Wörtern zusammen, statt sie naiv mit Leerzeichen zu trennen. Bei stilisiert gerenderten PDFs (Item-pro-Glyph durch Hand-Positionierung) findet die Suche jetzt zuverlässig.

### Implemented
- **FA-005 Volltext-Suche** (erste Iteration): Eingabefeld in `ReaderPage` mit Optionen „Groß-/Kleinschreibung" und „Ganzes Wort", Trefferliste mit Snippet (Match hervorgehoben), Klick auf Treffer springt zur Seite. `IPdfRenderer.ExtractTextAsync` und `IPdfRenderer.SearchAsync` sind jetzt vollständig implementiert; JS-Bridge führt seitenweise `getTextContent()`, baut robusten Page-Text und liefert Treffer inkl. Snippet zurück.
- Wenn eine geöffnete PDF keinen Text-Layer enthält (typische Designer-PDFs mit Text-als-Vektor), erscheint statt stummer „Keine Treffer" ein klarer Hinweisblock mit Verweis auf das geplante OCR-Feature (FA-050 / Release 0.9).
- `SearchHit`-Record erweitert um `Snippet` und `SnippetMatchStart` (Item-genaue `TextItem[]`-Treffer für Highlight-Overlays bleiben Folge-Iteration).
- **Tastatur-Navigation** (Beitrag zu NFA-031, „vollständige Tastatur-Navigation"): neue Bridge `shortcuts-bridge.ts` (globalName `pageboundShortcuts`) registriert einen window-keydown-Listener und mapped Shortcuts auf `[JSInvokable]`-Aufrufe von `ReaderPage`. Aktive Shortcuts: `←` / `Pg↑` vorherige Seite · `→` / `Pg↓` nächste Seite · `Pos1` / `Ende` erste / letzte Seite · `Strg+F` Suchfeld fokussieren · `Esc` Suche zurücksetzen · `Strg+ +` / `Strg+ −` Zoom-Stufe · `Strg+0` Zoom-Reset. Beim Tippen in Input-Feldern werden alle Shortcuts außer `Esc` und `Strg+F` unterdrückt. esbuild bündelt jetzt zwei Bridges (`pdfjs-bridge.js`, `shortcuts-bridge.js`); `index.html`, Dockerfile und `.gitignore` entsprechend erweitert.
- **Persistenz-Infrastruktur**: neue Bridge `storage-bridge.ts` (globalName `pageboundStorage`) kapselt die Browser-IndexedDB; `IndexedDbStorage` in `Pagebound.Infrastructure/Storage/` implementiert `IStorageService` über die Bridge (JSON-Serialisierung mit camelCase, Drittes esbuild-Bundle). Erfüllt NFA-010 (Offline) und NFA-011 (sofortige Persistenz). `IStorageService.KeysAsync` um optionalen `CancellationToken` erweitert.
- **`AnnotationService`** in `Pagebound.Infrastructure/Annotations/` implementiert `IAnnotationService` mit per-PdfId-Cache und sofortiger Persistenz via `IStorageService` unter dem Schlüssel `annotations:{pdfId}`. Operationen (`CreateAsync`, `UpdateAsync`, `DeleteAsync`, `GetForDocumentAsync`) sind durch `SemaphoreSlim` linearisiert.
- **FA-011 Sticky Notes**: Werkzeug-Toggle in `ReaderPage` zwischen „Auswählen" und „📝 Notiz". Im Notiz-Modus erzeugt ein Klick aufs PDF einen Pin an der genau geklickten Position. Pins werden als kleine farbige Buttons über dem PDF-Bild gerendert (Position als Fraction 0..1, damit zoom-stabil) und öffnen beim Klick einen Editor-Popover mit Textarea, Speichern- und Löschen-Knopf.
- **PDF-Hash bei Datei-Auswahl**: `Sha256HashService` wird auf den Datei-Stream angewendet; das Ergebnis ist die `PdfId`, unter der die Annotationen persistiert werden. Damit folgen die Notizen der PDF, auch wenn sie umbenannt oder kopiert wird.
- Neuer DOM-Utility `pageboundShortcuts.clientPositionToFraction(selector, clientX, clientY)` für zoom-stabile Klick-Positionen.
- **FA-010 Text-Highlight** und **FA-018 Inline-Toolbar bei Text-Selektion**: Über dem PDF-Bild wird ein unsichtbarer Text-Layer aus `IPdfRenderer.ExtractTextAsync`-Items aufgespannt (positionierte transparente `<span>`s, Größen über CSS-Container-Query-Einheiten `cqh`, Fractions 0..1). Markiert der Nutzer Text mit der Maus, wird die Browser-`Selection` per neuer Bridge-Funktion `pageboundShortcuts.getCurrentTextSelection(selector)` in eine Liste von Bounding-Rechtecken (relativ zum Page-Canvas) umgewandelt; eine schwebende **Inline-Toolbar** mit fünf Farb-Buttons erscheint und legt bei Klick eine neue `HighlightAnnotation` an. Bestehende Highlights rendern als farbige Rechtecke mit `mix-blend-mode: multiply` über dem Text-Layer und öffnen beim Klick einen Editor-Popover (Farbwechsel, Löschen). `RenderedPage` um `PageWidthPt`/`PageHeightPt` erweitert, neue Helfer `HighlightAnnotation` und `HighlightRect` im Domain-Layer. `Esc` priorisiert jetzt zuerst aktive Selection/Editor vor dem Such-Reset.
- **FA-006 Inhaltsverzeichnis-Sidebar** (Release 0.2 vorgezogen): neue Bridge-Funktion `pageboundPdf.getOutline(handleId)` löst PDF.js-Destinations (sowohl inline-Arrays als auch Named Destinations) via `getPageIndex` zu Seitenzahlen auf. `IPdfRenderer.GetOutlineAsync` ist jetzt implementiert. Neue rekursive Komponente `OutlineNode.razor` rendert den Tree mit eingerückten Kindern; eine einklappbare Sidebar links vom PDF zeigt das Inhaltsverzeichnis und springt bei Klick zur Zielseite. Toggle-Button „📑 Inhalt" im Werkzeug-Bereich, mit „(leer)"-Hinweis wenn die geöffnete PDF kein TOC hat.

- **FA-012 Markdown-Notizen mit Live-Preview**: Der Sticky-Note-Editor hat jetzt einen Toggle „Bearbeiten ⇄ Vorschau". Beim Öffnen einer befüllten Notiz startet der Editor im Vorschau-Modus; eine leere neue Notiz startet im Bearbeiten-Modus. Die Vorschau rendert via Markdig (`UseAdvancedExtensions().DisableHtml()` → kein roher HTML-Durchschuss, NFA-025) und wird über die neue Tailwind-Klasse `pb-markdown` themed (Headings, Listen, Code-Blöcke, Blockquotes, Tabellen, Links). Editor-Popover ist von 18 rem auf 20 rem verbreitert, damit Vorschau und Markdown-Eingabe komfortabel reinpassen.
- **FA-080 / FA-081 / FA-082 Markdown-Export** (Anti-Adobe-USP, Obsidian-kompatibel): neuer Service `IMarkdownExporter` in `Pagebound.Core.Abstractions` + `MarkdownExporter` in `Pagebound.Infrastructure.Export` sammelt Highlights und Sticky Notes pro PDF (per `PdfId`), gruppiert sie nach Seite, sortiert innerhalb einer Seite nach Y-Position und schreibt YAML-Frontmatter (`title`, `source` als optionaler Wikilink, `pdfHash`, `pages`, `annotations`, `exportedAt`, `exportedBy`, `tags`). Highlights werden als Blockquote-Zitate ausgegeben, Sticky Notes mit ihrem Markdown-Inhalt unterhalb eines `**Notiz:**`-Headers. Neuer JS-Helfer `pageboundShortcuts.downloadFile(filename, content, mimeType)` liefert die generierte `.md`-Datei als Browser-Download (Blob + Object-URL, sauber aufgeräumt). „📤 Markdown"-Button in der Reader-Werkzeugleiste mit Annotation-Anzahl-Badge.
- **FA-015 / FA-016 / FA-017 PNG-Signatur + Hash-Integrität** (Original-USP, Release 0.4 vorgezogen): neuer `SignatureAnnotation`-Helper im Domain-Layer kapselt PNG-Data-URL + 0..1-Fraction-Position + Signaturzeitpunkt + Integritäts-Hash. Neues Interface `IIntegrityService` (Abstractions) und `IntegrityService` (Infrastructure/Crypto) berechnen einen deterministischen SHA-256 über pdfHash, zeitstempel und alle **anderen Annotationen außer Signaturen** in einem kanonisch sortierten String — Signaturen ignorieren sich gegenseitig, damit das Verschieben einer Signatur keine andere Signatur invalidiert. Inhaltsänderungen (Sticky Notes / Highlights anlegen, ändern, löschen) lösen automatische Reverifikation aus und switchen den Status-Badge der Signatur von Grün auf Rot. UI: Werkzeug „✍️ Signatur laden" lädt PNG/JPG bis 2 MB als Data-URL in den Modus, Klick auf das PDF platziert die Unterschrift (25 % × 8 % Default-Größe), Drag-and-Drop verschiebt sie live (`pageboundShortcuts.dragElementToFraction` schreibt während pointermove direkt CSS-`left`/`top` und meldet die finale Fraction über `[JSInvokable] HandleSignatureDragCompleteAsync` zurück; Position wird auf das Page-Canvas geklemmt). Mini-Lösch-Button am Signatur-Rahmen, kleines Farb-Badge oben rechts (✓ Valid, ! Invalid, ? NoHash). UI weist auf die pragmatische Variante laut ADR-006 hin (keine PAdES, keine PDF-Modifikation).
- **FA-020 / FA-021 / FA-022 PDF-Seiten-Werkzeuge** (Acrobat-Pro-Parität, Release 0.3): neue `IPdfManipulator`-Abstraktion in `Pagebound.Core.Abstractions` + `PdfSharpManipulator`-Implementation in `Pagebound.Infrastructure.Pdf` mit `MergeAsync`, `SplitAsync`, `ReorderAsync`, `DeletePagesAsync`, `RotateAsync` über PdfSharpCore; `CompressAsync` und `EncryptAsync` aktuell als `NotImplementedException` für Release 0.8. Domain-Records `CompressionOptions` und `EncryptionOptions` (inkl. `EncryptionStrength`) angelegt. Neue Page `/tools` mit File-Picker, sequenziellem Thumbnail-Rendering (Scale 0.35, Progress-Bar), Seiten-Grid mit Selection (Single + Alle / Keine), 90°-Rotation in beide Richtungen, Löschen-mit-Undo, „💾 Speichern (PDF)"-Knopf der die Operationen verkettet anwendet und das Ergebnis als `<name>_edited.pdf` herunterlädt. Neuer JS-Helfer `pageboundShortcuts.downloadBytes(filename, base64, mimeType)` produziert einen byte-perfekten Blob-Download (für Binär-Dateien, im Gegensatz zu `downloadFile`, das text-kodiert ist). Nav-Link „PDF-Werkzeuge" in der Sidebar.

### Fixed
- Editor-Popover (Sticky Notes / Highlights) und Inline-Toolbar werden nicht mehr von der `<figure>` abgeschnitten: `overflow-auto` → `overflow-visible`, und die Popovers flippen automatisch ihre Position, wenn die Annotation nahe einem Seitenrand sitzt (Pin rechts ⇒ Editor links, Highlight oben ⇒ Toolbar unten, etc.).

### Changed
- Bootstrap-Assets und Demo-Pages (Counter, Weather, NavMenu) durch Tailwind-basiertes Layout ersetzt
- `MainLayout`, `Home`, `NotFound`, `index.html` auf Pagebound-Branding und deutsche Sprache umgestellt
- `_Imports.razor` um `Pagebound.Core.Abstractions` und `Pagebound.Core.Domain` erweitert

### Removed
- Bootstrap-Bibliothek in `wwwroot/lib/`
- Demo-Pages: `Counter.razor`, `Weather.razor`, `NavMenu.razor`
- Generierte `UnitTest1.cs`-Platzhalter in den drei Test-Projekten

## [0.1.0] – geplant

Erstes nutzbares Alpha-Release. Inhalt:
- PDF öffnen, anzeigen, navigieren (FA-001, FA-003)
- Zoom und Volltext-Suche (FA-004, FA-005)
- Text-Highlight in mehreren Farben (FA-010)
- Sticky Notes mit Markdown-Notizen (FA-011, FA-012)
- Sidecar-JSON-Persistenz neben der PDF (FA-070, FA-071, FA-073)
- Offline-Fähigkeit als PWA (NFA-010)
- Lighthouse-Accessibility-Score ≥ 90 (NFA-034)
