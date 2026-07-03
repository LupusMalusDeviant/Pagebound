# Pagebound.Core.Abstractions

Hier liegen **alle Service-Interfaces** (`IXxxService`) der Anwendung. Implementierungen befinden sich physisch getrennt in `Pagebound.Infrastructure/`.

Verbindliches Architekturprinzip: **Interface-First** (siehe [ADR-0001](../../../docs/adr/0001-interface-first.md)).

## Erwartete Interfaces (Pflichtenheft Abschnitt 4)

| Interface | Erfüllt | Implementierung in |
|---|---|---|
| `IPdfRenderer` | FA-001, FA-003, FA-004, FA-005, FA-006, FA-007, FA-008 | `Pagebound.Infrastructure/Pdf/PdfJsRenderer` |
| `IPdfManipulator` | FA-015, FA-020 bis FA-027 | `Pagebound.Infrastructure/Pdf/JsPdfLibManipulator` (Embed via pdf-lib) + `PdfSharpManipulator` (Seitenoperationen) |
| `IPdfBuilder` | FA-025 | `Pagebound.Infrastructure/Pdf/PdfSharpBuilder` |
| `IAnnotationService` | FA-010 bis FA-014, FA-018 | `Pagebound.Infrastructure/Annotations/` |
| `ISignatureService` | FA-015, FA-016, FA-017, FA-042 | `Pagebound.Infrastructure/Signature/` |
| `IHashService` | NFA-024 | `Pagebound.Infrastructure/Crypto/Sha256HashService` |
| `ISidecarService` | FA-070 bis FA-074 | `Pagebound.Infrastructure/Storage/FileSystemSidecarService` |
| `ILibraryService` | FA-060 bis FA-064 | `Pagebound.Infrastructure/Library/` |
| `IOcrService` | FA-050 | `Pagebound.Infrastructure/Ocr/TesseractOcrService` |
| `IBatchProcessor` | FA-051, FA-052 | `Pagebound.Infrastructure/Batch/` |
| `IExportService` | FA-030, FA-031, FA-032 | `Pagebound.Infrastructure/Export/` |
| `IMarkdownExporter` | FA-080, FA-081, FA-082 | `Pagebound.Infrastructure/Export/MarkdownExporter` |
| `IStorageService` | NFA-010, NFA-011 | `Pagebound.Infrastructure/Storage/IndexedDbStorage` |
| `IEncryptionService` | NFA-023, FA-074 | `Pagebound.Infrastructure/Crypto/AesEncryptionService` |
| `ILocalizationService` | FA-102, NFA-050, NFA-051, NFA-052 | `Pagebound.Infrastructure/Localization/` |
| `IThemeService` | FA-100, FA-101 | `Pagebound.Infrastructure/Theme/` |
| `ITelemetryService` | NFA-020, NFA-021 | `Pagebound.Infrastructure/Telemetry/NoOpTelemetryService` |

## Regel

**Eine Interface-Datei hier kostet eine Implementation-Datei dort.** Wenn das Verhältnis kippt (mehr Interfaces als Implementations), prüfen wir, ob eine Abstraktion wirklich gerechtfertigt ist (vgl. ADR-001 Mitigation).
