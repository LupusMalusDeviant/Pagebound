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
