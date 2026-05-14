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
