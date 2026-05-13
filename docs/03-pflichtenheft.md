# Pflichtenheft: Pagebound

| Feld | Wert |
|---|---|
| Projekt | **Pagebound** (Arbeitstitel) |
| Dokumenttyp | Pflichtenheft |
| Version | 0.1 (Entwurf) |
| Stand | 2026-05-13 |
| Status | Zur Abstimmung |
| Bezug | Anforderungsdokument `01-requirements.md`, Lastenheft `02-lastenheft.md` (jeweils Version 0.1) |
| Auftragnehmer | Projektinitiator (Solo-Entwickler) |

> Dieses Pflichtenheft beschreibt die Realisierung der im Lastenheft geforderten Leistungen. Es ist die technische Antwort des Auftragnehmers auf die fachlichen Anforderungen des Auftraggebers. Konkrete Implementierungsdetails (z.B. Methoden-Signaturen) sind beispielhaft – sie können während der Realisierung präzisiert werden, solange die fachlichen Anforderungen erfüllt bleiben.

---

## 1. Einleitung

### 1.1 Zweck
Dieses Dokument definiert, **wie** das System Pagebound implementiert wird. Es beschreibt Architektur, Komponenten, Schnittstellen, Datenmodelle, Realisierungs-Plan, Tests und Architektur-Entscheidungen.

### 1.2 Lese-Reihenfolge für Mitwirkende
Wer das Projekt verstehen will, liest in folgender Reihenfolge:
1. `01-requirements.md` (Was und Warum)
2. `02-lastenheft.md` (Auftrag und Priorität)
3. Dieses Dokument (Wie)
4. `docs/adrs/*` (Architektur-Entscheidungen im Detail)
5. README im Repo-Root (Setup)

### 1.3 Konventionen
- **MUST / SHOULD / MAY** entsprechen der Lastenheft-Priorisierung Muss / Soll / Kann.
- Code-Beispiele sind exemplarisch (C# 12 / .NET 10 Syntax).
- IDs (`FA-XXX`, `NFA-XXX`) referenzieren das Anforderungsdokument.

---

## 2. Systemübersicht

### 2.1 Kontext-Diagramm

```
+---------------------------------------------------------------+
|                       Endnutzer (Browser)                     |
+---------------------------------------------------------------+
        ^                ^                       ^
        | HTTP (initial) | File System Access    | Local Storage
        v                v                       v
+--------------+   +------------------+   +-----------------+
| Static Host  |   | OS Dateisystem   |   | IndexedDB + OPFS|
| (CDN/CNAME)  |   | (PDF + Sidecar)  |   | (Library/Cache) |
+--------------+   +------------------+   +-----------------+
        |
        | Erstes Laden / Updates
        v
+---------------------------------------------------------------+
|  Pagebound PWA (Blazor WASM, .NET 10)                         |
|  +---------+ +---------+ +---------+ +---------+              |
|  | Viewer  | | Library | | Annot.  | | Signat. |              |
|  +---------+ +---------+ +---------+ +---------+              |
|  +---------+ +---------+ +---------+ +---------+              |
|  | Export  | | OCR     | | Batch   | | Sync*   |              |
|  +---------+ +---------+ +---------+ +---------+              |
|  +--------------------------------------------+               |
|  |  Application / Domain (C# / Interface-First)|              |
|  +--------------------------------------------+               |
|  +-------------+ +--------------+ +----------------------+    |
|  | PDF.js (JS) | | PdfSharpCore | | Tesseract.js (JS)    |    |
|  | via Interop | | (.NET)       | | via Interop          |    |
|  +-------------+ +--------------+ +----------------------+    |
+---------------------------------------------------------------+
                                                  * Optional, ab v1.x
```

### 2.2 Systemtyp
Pagebound ist eine **Single-Page-Progressive-Web-App (SPA-PWA)**:
- **Client-only**: kein zwingender Server, alle Operationen im Browser.
- **Offline-fähig** durch Service Worker.
- **Installierbar** als PWA über Browser-„App installieren".
- **Statisch deployable** als reine HTML/JS/WASM/CSS-Datei-Sammlung.

### 2.3 Technologie-Stack (Übersicht)

| Schicht | Technologie | Lizenz |
|---|---|---|
| Frontend-Framework | Blazor WebAssembly auf .NET 10 | MIT |
| Sprache | C# 12 / TypeScript (nur für JS-Interop-Module) | – |
| Styling | Tailwind CSS + eigene Komponenten | MIT |
| PDF-Rendering | PDF.js (Mozilla) via JS-Interop | Apache 2.0 |
| PDF-Manipulation | PdfSharpCore | MIT |
| OCR | Tesseract.js via JS-Interop | Apache 2.0 |
| Markdown-Rendering | Markdig | BSD-2-Clause |
| Local Storage | Blazored.LocalStorage + Custom IndexedDB-Wrapper | MIT |
| Tests (Unit + Components) | xUnit + bUnit | Apache 2.0 / MIT |
| Tests (E2E) | Playwright .NET | Apache 2.0 |
| CI/CD | GitHub Actions | – |
| Hosting | CNAME auf GitHub/Cloudflare Pages, eigene Domain | – |

---

## 3. Architektur

### 3.1 Architektur-Stil
Pagebound folgt einer **Feature-Folder-Architektur (Vertical Slices)** statt klassischer Layered- oder Clean-Architecture. Begründung: Solo-Entwicklung profitiert von Co-Location aller Feature-Bestandteile (UI + Service + Tests) und vermeidet den Layer-Overhead, der bei Teams sinnvoller wird.

**Globale Architektur-Prinzipien (verbindlich, siehe ADR-001):**
1. **Interface-First**: jeder DI-registrierte Service hat ein Interface `IXxxService` und mindestens eine Implementation `XxxService`.
2. **Dependency Inversion**: höhere Schichten (UI / Feature) hängen nur von Abstraktionen (Interfaces) ab, nicht von Implementierungen.
3. **Single Responsibility**: jede Klasse hat einen Grund zu existieren; lange Klassen werden in mehrere Services zerlegt.
4. **Testbarkeit**: jede Domänen-Logik ist ohne Browser, ohne PDF.js und ohne IndexedDB unit-testbar (Mocks gegen Interfaces).
5. **Konfigurations-Aware**: Telemetrie, Sync, optionale Features werden als Service-Registrierung umschaltbar gemacht.

### 3.2 Projekt-Struktur (Solution)

```
Pagebound.sln
├─ src/
│  ├─ Pagebound.Web/                          # Blazor WASM Frontend
│  │  ├─ App.razor
│  │  ├─ Program.cs                           # DI-Container-Bootstrap
│  │  ├─ Features/                            # Vertical Slices
│  │  │  ├─ Library/
│  │  │  │  ├─ LibraryPage.razor
│  │  │  │  ├─ ILibraryViewModel.cs
│  │  │  │  ├─ LibraryViewModel.cs
│  │  │  │  └─ LibraryItem.razor
│  │  │  ├─ Reader/
│  │  │  ├─ Annotation/
│  │  │  ├─ Signature/
│  │  │  ├─ Export/
│  │  │  ├─ Ocr/
│  │  │  ├─ Batch/
│  │  │  └─ Settings/
│  │  ├─ Components/                          # Geteilte UI-Komponenten
│  │  │  ├─ Button.razor
│  │  │  ├─ Dialog.razor
│  │  │  └─ ...
│  │  ├─ Resources/                           # i18n (de.json, en.json)
│  │  └─ wwwroot/
│  │     ├─ index.html
│  │     ├─ manifest.webmanifest
│  │     ├─ service-worker.js
│  │     ├─ css/ (Tailwind output)
│  │     └─ js/                               # JS-Interop-Module
│  │        ├─ pdfjs-bridge.ts
│  │        ├─ tesseract-bridge.ts
│  │        ├─ fs-access.ts
│  │        └─ indexeddb-bridge.ts
│  │
│  ├─ Pagebound.Core/                         # Domain + Application
│  │  ├─ Domain/                              # Reine Modelle
│  │  │  ├─ Annotation.cs
│  │  │  ├─ Sidecar.cs
│  │  │  ├─ LibraryEntry.cs
│  │  │  ├─ Signature.cs
│  │  │  └─ ...
│  │  ├─ Abstractions/                        # Service-Interfaces
│  │  │  ├─ IPdfRenderer.cs
│  │  │  ├─ IPdfManipulator.cs
│  │  │  ├─ ISidecarService.cs
│  │  │  ├─ IHashService.cs
│  │  │  ├─ ISignatureService.cs
│  │  │  ├─ ILibraryService.cs
│  │  │  ├─ IAnnotationService.cs
│  │  │  ├─ IExportService.cs
│  │  │  ├─ IOcrService.cs
│  │  │  ├─ IBatchProcessor.cs
│  │  │  ├─ IStorageService.cs
│  │  │  ├─ IEncryptionService.cs
│  │  │  ├─ ILocalizationService.cs
│  │  │  ├─ IThemeService.cs
│  │  │  └─ ITelemetryService.cs
│  │  └─ Application/                         # Use Cases / Orchestrierung
│  │     ├─ OpenPdfUseCase.cs
│  │     ├─ SignPdfUseCase.cs
│  │     └─ ...
│  │
│  └─ Pagebound.Infrastructure/               # Konkrete Implementierungen
│     ├─ Pdf/
│     │  ├─ PdfJsRenderer.cs                  # IPdfRenderer via JS-Interop
│     │  └─ PdfSharpManipulator.cs            # IPdfManipulator
│     ├─ Storage/
│     │  ├─ IndexedDbStorage.cs               # IStorageService
│     │  └─ FileSystemSidecarService.cs       # ISidecarService
│     ├─ Crypto/
│     │  ├─ Sha256HashService.cs              # IHashService
│     │  └─ AesEncryptionService.cs           # IEncryptionService
│     ├─ Ocr/
│     │  └─ TesseractOcrService.cs            # IOcrService
│     ├─ Telemetry/
│     │  ├─ NoOpTelemetryService.cs           # Default
│     │  └─ OptInCrashReportService.cs        # Bei User-Zustimmung
│     └─ ...
│
├─ tests/
│  ├─ Pagebound.Core.Tests/                   # Unit-Tests (xUnit)
│  ├─ Pagebound.Web.Tests/                    # Component-Tests (bUnit)
│  └─ Pagebound.E2ETests/                     # Playwright .NET
│
├─ docs/
│  ├─ 01-requirements.md
│  ├─ 02-lastenheft.md
│  ├─ 03-pflichtenheft.md
│  ├─ user-handbook.md
│  ├─ contributor-guide.md
│  └─ adrs/
│     ├─ 001-interface-first.md
│     ├─ 002-blazor-wasm.md
│     └─ ...
│
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ deploy.yml
├─ README.md
├─ CHANGELOG.md
├─ LICENSE
└─ NOTICE
```

### 3.3 Schichten und ihre Verantwortung

| Schicht | Inhalt | Hängt ab von |
|---|---|---|
| `Pagebound.Web` | UI (Blazor-Komponenten, Pages, View-Models), JS-Interop-Glue, DI-Bootstrap | `Pagebound.Core`, `Pagebound.Infrastructure` |
| `Pagebound.Infrastructure` | Konkrete Service-Implementierungen, externe Bibliotheken | `Pagebound.Core` (nur Abstractions + Domain) |
| `Pagebound.Core` | Domain-Modelle, Service-Interfaces, Use-Case-Orchestrierung | – (rein) |

Die Trennung `Core` / `Infrastructure` ist gewählt, damit die Domain-Logik **vollständig unit-testbar** ist, ohne Blazor- oder Browser-Abhängigkeiten zu mocken (bUnit/Playwright nur für UI-Schicht nötig).

---

## 4. Service-Spezifikationen (Interface-First)

Die folgenden Interfaces definieren die zentralen Services. Methodensignaturen sind exemplarisch – Anpassungen in der Implementierungsphase sind möglich, solange die fachliche Funktion erhalten bleibt.

### 4.1 `IPdfRenderer` – PDF-Anzeige
Erfüllt FA-001, FA-003, FA-004, FA-005, FA-006, FA-007, FA-008.

```csharp
public interface IPdfRenderer
{
    Task<PdfDocumentHandle> LoadAsync(Stream pdf, LoadOptions options, CancellationToken ct);
    Task<RenderedPage> RenderPageAsync(PdfDocumentHandle handle, int pageNumber, RenderOptions options, CancellationToken ct);
    Task<IReadOnlyList<TextItem>> ExtractTextAsync(PdfDocumentHandle handle, int pageNumber, CancellationToken ct);
    Task<IReadOnlyList<SearchHit>> SearchAsync(PdfDocumentHandle handle, string query, SearchOptions options, CancellationToken ct);
    Task<PdfOutline?> GetOutlineAsync(PdfDocumentHandle handle, CancellationToken ct);
    Task UnloadAsync(PdfDocumentHandle handle);
}
```
**Default-Implementierung:** `PdfJsRenderer` – wickelt PDF.js via JS-Interop.

### 4.2 `IPdfManipulator` – PDF-Bearbeitung
Erfüllt FA-020 bis FA-027.

```csharp
public interface IPdfManipulator
{
    Task<byte[]> MergeAsync(IReadOnlyList<Stream> pdfs, CancellationToken ct);
    Task<IReadOnlyList<byte[]>> SplitAsync(Stream pdf, IReadOnlyList<int> splitAfterPages, CancellationToken ct);
    Task<byte[]> ReorderAsync(Stream pdf, IReadOnlyList<int> newOrder, CancellationToken ct);
    Task<byte[]> DeletePagesAsync(Stream pdf, IReadOnlyList<int> pageIndices, CancellationToken ct);
    Task<byte[]> RotateAsync(Stream pdf, IReadOnlyDictionary<int, int> rotationDegrees, CancellationToken ct);
    Task<byte[]> CompressAsync(Stream pdf, CompressionOptions options, IProgress<int>? progress, CancellationToken ct);
    Task<byte[]> EncryptAsync(Stream pdf, EncryptionOptions options, CancellationToken ct);
}
```
**Default-Implementierung:** `PdfSharpManipulator` (basiert auf PdfSharpCore).

### 4.3 `IPdfBuilder` – PDF-Erstellung
Erfüllt FA-025.

```csharp
public interface IPdfBuilder
{
    Task<byte[]> FromImagesAsync(IReadOnlyList<Stream> images, BuildOptions options, CancellationToken ct);
}
```

### 4.4 `IAnnotationService` – Annotationen verwalten
Erfüllt FA-010 bis FA-014, FA-018.

```csharp
public interface IAnnotationService
{
    Task<Annotation> CreateAsync(NewAnnotation input, CancellationToken ct);
    Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken ct);
    Task DeleteAsync(AnnotationId id, CancellationToken ct);
    Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken ct);
    IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId);
}
```

### 4.5 `ISignatureService` – PNG-Signatur mit Integrität
Erfüllt FA-015, FA-016, FA-017, FA-042.

```csharp
public interface ISignatureService
{
    Task<SignatureResult> SignAsync(Stream pdf, SignatureInput input, CancellationToken ct);
    Task<IntegrityVerification> VerifyAsync(Stream pdf, Sidecar? sidecar, CancellationToken ct);
}

public sealed record SignatureInput(
    byte[] PngImage,
    SignaturePlacement Placement,
    bool ComputeIntegrityHash);

public sealed record SignatureResult(
    byte[] SignedPdf,
    Signature Signature,
    IntegrityRecord Integrity);

public sealed record IntegrityVerification(
    IntegrityStatus Status,
    string? ExpectedHash,
    string? ActualHash,
    DateTimeOffset? SignedAt);

public enum IntegrityStatus { Valid, Invalid, NoHashPresent, AmbiguousSources }
```

**Spezifikation FA-016/017:**
- Hash-Algorithmus: **SHA-256**.
- Hash-Berechnung: über das **gesamte PDF nach Einbettung der Signatur**, jedoch **mit dem Hash-Feld auf einem festen Sentinel-Wert** (z.B. 64×`0x00`). Das vermeidet das Henne-Ei-Problem („Hash hängt vom Hash ab"), das man von PAdES her kennt.
- Speicherort 1 (im PDF): Custom-Metadata-Eintrag `/Pagebound:IntegrityHash` (PDF-Standard erlaubt beliebige Custom-Keys im `Info`-Dictionary oder XMP-Metadata).
- Speicherort 2 (Sidecar): Feld `integrity.hash` mit gleichem Wert. Bei Konflikt → Status `AmbiguousSources`, UI zeigt Warnung.
- Wichtige Klarstellung in der UI: Das ist eine **Integritäts-Prüfung**, keine kryptografisch signierte Identität. Wer den PDF-Inhalt ändert UND beide Hashes neu setzt, bekommt einen gültigen Hash. Echte Signaturen kommen mit FA-043 (PAdES) post-1.0.

### 4.6 `IHashService` – Hashing
Erfüllt NFA-024.

```csharp
public interface IHashService
{
    Task<string> ComputeAsync(Stream data, HashAlgorithm algorithm, CancellationToken ct);
    Task<string> ComputeAsync(ReadOnlyMemory<byte> data, HashAlgorithm algorithm, CancellationToken ct);
}

public enum HashAlgorithm { Sha256, Sha384, Sha512 }
```

**Default-Implementierung:** `Sha256HashService` nutzt die WebCrypto-API via JS-Interop für Streaming-Hash großer PDFs, oder `System.Security.Cryptography` für kleine Buffer.

### 4.7 `ISidecarService` – Sidecar-Persistenz
Erfüllt FA-070 bis FA-074.

```csharp
public interface ISidecarService
{
    Task<Sidecar?> TryLoadAsync(string pdfPath, CancellationToken ct);
    Task SaveAsync(Sidecar sidecar, string pdfPath, CancellationToken ct);
    Task<Sidecar> CreateNewAsync(string pdfPath, PdfMeta meta, CancellationToken ct);
    Task<MigrationResult> MigrateAsync(Sidecar sidecar, CancellationToken ct);
}
```

**Such-Strategie:** Beim Öffnen einer PDF werden zwei Orte geprüft:
1. `<pdfPath>.pagebound.json` (Default, neben PDF)
2. `<workspaceRoot>/<pdfHash>.pagebound.json` (zentraler Workspace, falls konfiguriert)

Bei beiden gefunden → Konflikt-Dialog (User entscheidet, welches aktuell ist).

### 4.8 `ILibraryService` – Library-Verwaltung
Erfüllt FA-060 bis FA-064.

```csharp
public interface ILibraryService
{
    Task<LibraryEntry> AddAsync(string pdfPath, CancellationToken ct);
    Task RemoveAsync(LibraryEntryId id, CancellationToken ct);
    Task UpdateAsync(LibraryEntry entry, CancellationToken ct);
    Task<IReadOnlyList<LibraryEntry>> QueryAsync(LibraryQuery query, CancellationToken ct);
    Task<LibraryEntry?> GetAsync(LibraryEntryId id, CancellationToken ct);
    Task<IReadOnlyList<string>> GetAllTagsAsync(CancellationToken ct);
}

public sealed record LibraryQuery(
    string? FullTextSearch = null,
    IReadOnlyList<string>? Tags = null,
    LibrarySort Sort = LibrarySort.LastOpenedDesc,
    int? Skip = null,
    int? Take = null);
```

### 4.9 `IOcrService` – Texterkennung
Erfüllt FA-050.

```csharp
public interface IOcrService
{
    Task<OcrResult> RecognizeAsync(Stream pdf, OcrOptions options, IProgress<OcrProgress>? progress, CancellationToken ct);
}

public sealed record OcrOptions(
    IReadOnlyList<string> Languages,    // z.B. ["deu", "eng"]
    int? PageStart = null,
    int? PageEnd = null,
    bool EmbedAsHiddenTextLayer = true);
```

**Default-Implementierung:** `TesseractOcrService` via Tesseract.js. Sprach-Modelle (eng.traineddata, deu.traineddata) werden lazy aus dem CDN nachgeladen und gecached.

### 4.10 `IBatchProcessor` – Stapelverarbeitung
Erfüllt FA-051, FA-052.

```csharp
public interface IBatchProcessor
{
    Task<BatchResult> RunAsync(BatchJob job, IProgress<BatchProgress>? progress, CancellationToken ct);
    Task<BatchRule> SaveRuleAsync(BatchRule rule, CancellationToken ct);
    Task<IReadOnlyList<BatchRule>> GetRulesAsync(CancellationToken ct);
}

public sealed record BatchJob(
    IReadOnlyList<string> InputFiles,
    IReadOnlyList<BatchOperation> Operations,
    BatchOutputStrategy Output);
```

**Operationen (komponierbar):** `Ocr`, `Compress`, `Encrypt`, `Rename`, `Watermark`, `Merge`, `Split`, `Convert`.

### 4.11 `IExportService` – Export & Konvertierung
Erfüllt FA-030, FA-031, FA-032, FA-080, FA-081, FA-082.

```csharp
public interface IExportService
{
    Task<byte[]> ExportAsync(Stream pdf, ExportFormat format, ExportOptions options, CancellationToken ct);
}

public enum ExportFormat { Png, Jpg, Text, Html, MarkdownNotes }
```

Für `MarkdownNotes` wird intern `IMarkdownExporter` aufgerufen (siehe 4.12).

### 4.12 `IMarkdownExporter` – Obsidian-Export
Erfüllt FA-080, FA-081, FA-082.

```csharp
public interface IMarkdownExporter
{
    Task<string> ExportAsync(PdfId pdfId, MarkdownExportOptions options, CancellationToken ct);
}

public sealed record MarkdownExportOptions(
    bool IncludeHighlights = true,
    bool IncludeNotes = true,
    bool IncludeYamlFrontmatter = true,
    bool UseWikilinks = true,
    string? VaultRoot = null);
```

**Export-Format (Obsidian-kompatibel):**
```markdown
---
title: "My Paper"
author: "Some Author"
tags: [research, quantum]
source: "[[paper.pdf]]"
exportedAt: 2026-05-13T14:30:00Z
---

# My Paper

## Page 3

> Highlighted text from page 3.

**Note:** This is interesting because...

## Page 7

> Another highlight.
```

### 4.13 `IStorageService` – Local Storage / IndexedDB
Erfüllt NFA-010, NFA-011, NFA-012.

```csharp
public interface IStorageService
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct);
    Task SetAsync<T>(string key, T value, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    Task<bool> ExistsAsync(string key, CancellationToken ct);
    IAsyncEnumerable<string> KeysAsync(string prefix);
}
```

### 4.14 `IEncryptionService` – Verschlüsselung von Sidecars
Erfüllt NFA-023, FA-074.

```csharp
public interface IEncryptionService
{
    Task<byte[]> EncryptAsync(byte[] plaintext, string password, CancellationToken ct);
    Task<byte[]> DecryptAsync(byte[] ciphertext, string password, CancellationToken ct);
}
```
**Algorithmus:** AES-256-GCM mit PBKDF2-SHA-256 (≥ 600.000 Iterationen) zur Schlüsselableitung.

### 4.15 `ILocalizationService` – i18n
Erfüllt FA-102, NFA-050, NFA-051, NFA-052.

```csharp
public interface ILocalizationService
{
    string T(string key, IReadOnlyDictionary<string, object>? args = null);
    Task SetLanguageAsync(string languageCode);
    string CurrentLanguage { get; }
    IReadOnlyList<string> AvailableLanguages { get; }
    event Action? LanguageChanged;
}
```
**Format der Ressourcen:** JSON pro Sprache (`Resources/de.json`, `Resources/en.json`), Flachstruktur mit Punkt-Notation (`library.title`, `annotation.highlight.label`).

### 4.16 `IThemeService` – Theme-Verwaltung
Erfüllt FA-100, FA-101.

```csharp
public interface IThemeService
{
    Task SetThemeAsync(ThemeName theme);
    Task SetCustomThemeAsync(CustomTheme theme);
    ThemeName CurrentTheme { get; }
    event Action<ThemeName>? ThemeChanged;
}

public enum ThemeName { Auto, Light, Dark, Sepia, Custom }
```

### 4.17 `ITelemetryService` – Opt-in Telemetrie
Erfüllt NFA-020, NFA-021.

```csharp
public interface ITelemetryService
{
    bool IsEnabled { get; }
    Task TrackExceptionAsync(Exception ex, IReadOnlyDictionary<string, string>? context, CancellationToken ct);
    Task TrackEventAsync(string eventName, IReadOnlyDictionary<string, string>? properties, CancellationToken ct);
}
```

**Default-Implementierung:** `NoOpTelemetryService` – tut nichts. Erst wenn der Nutzer in den Settings explizit „Anonyme Crash-Reports senden" aktiviert, wird `OptInCrashReportService` registriert (gewechselt zur Laufzeit über `IServiceProvider`-Re-Resolve).

---

## 5. Datenmodell

### 5.1 Sidecar-JSON-Schema (Version 1.0)

```json
{
  "schemaVersion": "1.0",
  "createdBy": "pagebound/0.5.2",
  "createdAt": "2026-05-13T14:30:00Z",
  "updatedAt": "2026-05-13T14:45:00Z",

  "pdfMeta": {
    "filename": "paper.pdf",
    "fileHashSha256": "abc123...",
    "fileSize": 1234567,
    "pageCount": 42
  },

  "library": {
    "title": "My Paper",
    "author": "Some Author",
    "tags": ["research", "quantum"],
    "rating": 4,
    "readingProgress": {
      "currentPage": 15,
      "lastReadAt": "2026-05-13T14:30:00Z"
    },
    "customFields": {}
  },

  "annotations": [
    {
      "id": "ann-9f3e",
      "type": "highlight",
      "pageNumber": 3,
      "rectangles": [{ "x": 100, "y": 200, "width": 300, "height": 20 }],
      "color": "#ffeb3b",
      "extractedText": "highlighted text",
      "createdAt": "2026-05-13T14:35:00Z"
    },
    {
      "id": "ann-2c11",
      "type": "note",
      "pageNumber": 3,
      "position": { "x": 400, "y": 200 },
      "contentMarkdown": "## Important\n\nThis is **Markdown**.",
      "createdAt": "2026-05-13T14:36:00Z"
    },
    {
      "id": "ann-7b8d",
      "type": "ink",
      "pageNumber": 5,
      "paths": [/* SVG-Path-Strings */],
      "color": "#1976d2",
      "strokeWidth": 2.0,
      "createdAt": "2026-05-13T14:38:00Z"
    },
    {
      "id": "ann-4a02",
      "type": "shape",
      "pageNumber": 6,
      "shape": "rectangle",
      "rect": { "x": 50, "y": 100, "width": 200, "height": 80 },
      "color": "#ff5722",
      "strokeWidth": 2.0,
      "createdAt": "2026-05-13T14:39:00Z"
    }
  ],

  "signatures": [
    {
      "id": "sig-5e1f",
      "pageNumber": 42,
      "imagePngBase64": "iVBORw0K...",
      "position": { "x": 400, "y": 700, "width": 200, "height": 80 },
      "signedAt": "2026-05-13T14:40:00Z"
    }
  ],

  "integrity": {
    "algorithm": "sha256",
    "hash": "def456...",
    "scope": "full-pdf-after-signature-with-sentinel-hash",
    "computedAt": "2026-05-13T14:40:00Z"
  },

  "exports": {
    "lastMarkdownExportAt": "2026-05-13T14:42:00Z"
  }
}
```

### 5.2 Schema-Migration
Bei neuen Schema-Versionen registriert die `ISidecarService`-Implementierung Migratoren:

```csharp
public interface ISidecarMigration
{
    string FromVersion { get; }
    string ToVersion { get; }
    Task<JsonNode> MigrateAsync(JsonNode source, CancellationToken ct);
}
```

Migrationen werden in der Reihenfolge der Versionen angewendet (`1.0 → 1.1 → 2.0`).

### 5.3 IndexedDB-Schema

Datenbank: `pagebound`, Version-Tracking über IndexedDB-Versions-Migrationen.

| ObjectStore | Key | Value | Index |
|---|---|---|---|
| `library` | `id` (UUID) | `LibraryEntry` JSON | `lastOpenedAt`, `tags` (multiEntry) |
| `pdfBlobs` | `id` (UUID) | PDF Blob | – |
| `sidecarsFallback` | `pdfId` | Sidecar JSON | – (nur wenn File System Access nicht verfügbar) |
| `settings` | `key` | beliebig | – |
| `batchRules` | `id` (UUID) | `BatchRule` JSON | `name` |
| `recentSearches` | autoIncrement | `RecentSearch` | `createdAt` |
| `tagsCache` | `tag` | Anzahl | – |

### 5.4 Domain-Objekte (Auszug)

```csharp
public sealed record Annotation(
    AnnotationId Id,
    PdfId PdfId,
    AnnotationType Type,
    int PageNumber,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    JsonElement TypeSpecificData);

public sealed record Sidecar(
    string SchemaVersion,
    PdfMeta PdfMeta,
    LibraryEntry LibraryEntry,
    IReadOnlyList<Annotation> Annotations,
    IReadOnlyList<Signature> Signatures,
    IntegrityRecord? Integrity);

public sealed record LibraryEntry(
    LibraryEntryId Id,
    string PdfPath,
    string Title,
    IReadOnlyList<string> Tags,
    DateTimeOffset AddedAt,
    DateTimeOffset? LastOpenedAt,
    ReadingProgress? Progress);
```

---

## 6. Externe Bibliotheken im Detail

### 6.1 PDF.js (Apache 2.0) – Rendering
- Version: ≥ v4.x (Stand 2026)
- Eingebunden über `wwwroot/js/pdfjs-bridge.ts` (TypeScript-Wrapper).
- Bündelung über esbuild; Worker-Datei (`pdf.worker.min.js`) liegt als separate Datei.
- C#-Seite spricht ausschließlich mit dem TypeScript-Wrapper, nicht direkt mit PDF.js — dadurch ist `PdfJsRenderer` durch eine andere Renderer-Implementierung austauschbar (Interface-First).

### 6.2 PdfSharpCore (MIT) – Manipulation
- Pure-C#-Library, läuft direkt in Blazor WASM.
- Begrenzungen: Komprimierung ist weniger ausgefeilt als kommerzielle Libraries. Für FA-026 wird ein einfaches Re-Encoding der eingebetteten Bilder umgesetzt; verlustfreie Strom-Optimierung ist Phase 0.8+-Detail.
- Verschlüsselung: AES-128 ja, AES-256 erfordert ggf. eigene Erweiterung oder Fork.

### 6.3 Tesseract.js (Apache 2.0) – OCR
- WASM-basierte Tesseract-Portierung.
- Sprach-Modelle (z.B. `deu.traineddata`, `eng.traineddata`) werden bei Bedarf nachgeladen.
- Pro Seite typische Dauer: 5–30 s je nach Hardware/Sprache.
- Output: Tesseract-Hocr-Format → wird in PDF als Hidden-Text-Layer eingebettet via PdfSharpCore.

### 6.4 Markdig (BSD-2-Clause) – Markdown-Rendering
- Pure-C#-Library, hervorragend für Live-Preview von Notizen.
- Mit Erweiterungen (Tables, Footnotes, GFM-kompatibel).

### 6.5 Tailwind CSS (MIT) – Styling
- Build-Pipeline: PostCSS + Tailwind CLI → kompiliert CSS in `wwwroot/css/app.css`.
- Konfiguration in `tailwind.config.js`; Theme-Variablen über CSS Custom Properties für Light/Dark/Sepia/Custom.

---

## 7. Realisierungs-Plan: Release-Roadmap

Jeder Meilenstein liefert eine nutzbare Version. Reihenfolge orientiert sich an „so früh wie möglich nutzbar".

### Release 0.1 – Alpha (Lese-MVP)
**Inhalt:** Viewer + Highlight + Sticky Notes + Sidecar-JSON

**Implementiert:**
- FA-001 (PDF öffnen), FA-003 (Navigation), FA-004 (Zoom), FA-005 (Suche), FA-008 (PDF-Versionen)
- FA-010 (Highlight), FA-011 (Sticky Notes)
- FA-070 (Sidecar), FA-071 (Schema-Version), FA-073 (Auto-Erkennung)
- NFA-010 (Offline), NFA-011 (Auto-Save), NFA-020 (keine Telemetrie), NFA-040 (Lizenz)

**Tests:** Unit-Tests für `IPdfRenderer`-Mock, `IAnnotationService`, `ISidecarService`. Playwright-Smoke: PDF öffnen + Highlight setzen + Reload + Highlight noch da.

**Definition of Done:** Auftraggeber liest ein Paper, setzt 10 Highlights, schließt den Browser, öffnet wieder → alle Highlights da. Lighthouse Accessibility ≥ 90.

### Release 0.2 – Annotation komplett
**Inhalt:** + Stift, Formen, Outline, Suche-Polish, Markdown-Notizen

**Implementiert:**
- FA-006 (Outline), FA-007 (Thumbnails), FA-012 (Markdown), FA-013 (Stift), FA-014 (Formen), FA-018 (Inline-Toolbar)

**Risiken:** Stift-Performance auf Mobile-Browsern (Touch-Events). → Test früh, ggf. simplify mit `requestAnimationFrame`-Throttling.

### Release 0.3 – PDF-Manipulation
**Inhalt:** + Seitenoperationen (Reorder, Löschen, Drehen, Merge, Split)

**Implementiert:** FA-020 bis FA-024.

**Risiken:** Große PDFs (>500 MB) reorder-en kann den Browser-RAM sprengen. → Streaming-Workflow via PdfSharpCore in Web-Worker auslagern.

### Release 0.4 – Killer-Feature 1: PNG-Signatur + Hash
**Inhalt:** + Signature + Integritäts-Hash (USP)

**Implementiert:** FA-015, FA-016, FA-017.

**Konkrete Aufgaben:**
1. Implementierung `ISignatureService` mit Sentinel-Hash-Verfahren.
2. UI: Signatur-Tool im Annotation-Modus.
3. Statusanzeige beim Öffnen (grünes Häkchen / rotes Warndreieck).
4. UI-Text klärt explizit: „Dies ist eine Integritätsprüfung, keine rechtsgültige Signatur."

### Release 0.5 – Killer-Feature 2: Library
**Inhalt:** + Library-Verwaltung + Tags + Multi-View

**Implementiert:** FA-060 bis FA-064, FA-072.

**Migration:** Bestehende Sidecars werden beim ersten Library-Scan registriert.

### Release 0.6 – Killer-Feature 3: Split-View
**Inhalt:** + Multi-PDF Split-View

**Implementiert:** FA-090, FA-091, FA-092 (optional).

### Release 0.7 – Markdown-Export
**Inhalt:** + Markdown-Export + Obsidian-Integration

**Implementiert:** FA-080, FA-081, FA-082.

### Release 0.8 – Pro-Features
**Inhalt:** + AcroForms + PDF-Verschlüsselung + Bild→PDF + Komprimierung

**Implementiert:** FA-025, FA-026, FA-027, FA-040, FA-041.

### Release 0.9 – OCR + Stapelverarbeitung
**Inhalt:** + OCR (Tesseract.js) + Batch-Processor

**Implementiert:** FA-050, FA-051, FA-052.

**Performance-Hinweis:** Tesseract.js läuft in WebWorker, blockiert UI nicht.

### Release 1.0 – Polish
**Inhalt:** + PDF→Bild/Text/HTML + A11y-Polish + Doku komplett + Cross-Browser-Verifikation

**Implementiert:** FA-030, FA-031, FA-032 (visuell), FA-100, FA-101.

**Definition of Done für 1.0:**
- Alle Muss-Anforderungen (FA + NFA) erfüllt.
- Alle Soll-Anforderungen erfüllt oder begründet zurückgestellt.
- Unit-Coverage ≥ 60 %.
- Lighthouse Accessibility ≥ 90.
- Manuell verifiziert auf Chrome, Edge, Firefox, Safari (letzte 2 Versionen).
- Touch-Bedienung auf 1× iPad/iPhone und 1× Android-Tablet/Phone verifiziert.
- README, User-Handbook, Contributor-Guide, alle ADRs vorhanden.

---

## 8. Test-Konzept

### 8.1 Test-Pyramide

```
       /\
      /  \  E2E (Playwright)    <-- ~5 % Aufwand, ~5 Tests, Kern-Workflows
     /----\
    /      \  Component (bUnit)  <-- ~25 % Aufwand, ~50 Tests, alle nicht-trivialen Komponenten
   /--------\
  /          \  Unit (xUnit)      <-- ~70 % Aufwand, ~300+ Tests, Domain + Application
 /------------\
```

### 8.2 Was wird wie getestet

| Schicht | Framework | Beispiel |
|---|---|---|
| Domain | xUnit + FluentAssertions | `Sidecar.AddAnnotation_ShouldUpdateTimestamp` |
| Application/Use-Case | xUnit + NSubstitute | `SignPdfUseCase_ShouldComputeHashAndStoreInBothPlaces` |
| Service-Implementierung | xUnit (Integration) | `PdfSharpManipulator_Merge_ShouldProduceValidPdf` |
| Blazor-Komponente | bUnit | `LibraryItem_ClickingOpenButton_ShouldRaiseOpenEvent` |
| E2E-Workflow | Playwright .NET | `OpenPdf_Highlight_Reload_ShouldShowHighlight` |
| A11y | Lighthouse-CI + axe-core | Jeder PR-CI, Score-Gate ≥ 90 |
| Performance | Lighthouse-CI | First Contentful Paint < 2 s |

### 8.3 Mocking-Strategie
Dank Interface-First-Architektur (NFA-070) sind alle externen Abhängigkeiten austauschbar:
- `IPdfRenderer` → in Tests durch `FakePdfRenderer` ersetzt (gibt vordefinierte Seiten zurück, kein JS-Interop nötig).
- `IStorageService` → `InMemoryStorage` für Test-Isolation.
- `ITelemetryService` → `NoOpTelemetryService` (auch Produktions-Default).

### 8.4 CI-Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml (Skizze)
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4 (10.x)
      - run: dotnet restore
      - run: dotnet build -c Release
      - run: dotnet test --collect:"XPlat Code Coverage"
      - uses: codecov/codecov-action@v4
      - run: dotnet publish src/Pagebound.Web -c Release -o publish
      - name: Playwright E2E
        run: dotnet test tests/Pagebound.E2ETests
      - name: Lighthouse CI
        run: npx @lhci/cli@latest autorun
        env:
          LHCI_ASSERT_PRESET: "a11y >= 90"
```

---

## 9. Sicherheits-Konzept

### 9.1 Bedrohungs-Analyse (verkürzt)

| Bedrohung | Auswirkung | Mitigation |
|---|---|---|
| XSS via PDF-Inhalt (z.B. Custom Field) | Beliebige JS-Ausführung | Renderng nur über PDF.js (sandboxed), kein dynamischer `innerHTML` mit PDF-Strings |
| Malicious PDF crasht App | DoS | PDF.js-Worker isoliert; bei Crash UI-Recovery anzeigen |
| Sidecar mit manipuliertem Inhalt | UI-Fehler, falsche Hash-Anzeige | Schema-Validierung beim Laden; bei ungültigem JSON → Fehler-Dialog |
| Verschlüsselte Sidecar / Passwort-Brute-Force | Privatsphäre | PBKDF2 ≥ 600.000 Iter, GCM AEAD |
| MITM beim ersten Laden | Code-Injection | HTTPS only, SRI-Hashes für CDN-Skripte, CSP-Header |
| Telemetrie-Leak | Privacy-Verletzung | Default no-op, opt-in explizit, anonymisierter Stack-Trace ohne PDF-Inhalte |

### 9.2 Content Security Policy (CSP)
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' (sync-endpoint-wenn-konfiguriert);
worker-src 'self' blob:;
object-src 'none';
```

### 9.3 Daten im Speicher
- PDF-Passworte: nur in `SecureString`-äquivalent (clear on dispose), nie persistiert.
- Sidecar-Verschlüsselungs-Schlüssel: nie persistiert; UI fragt bei jedem Öffnen erneut.

---

## 10. Architecture Decision Records (ADRs)

Die folgenden ADRs werden als separate Dateien im Repo unter `docs/adrs/` gepflegt. Hier kurz zusammengefasst:

### ADR-001: Interface-First-Architektur als verbindliches Prinzip
**Status:** Akzeptiert
**Kontext:** Wir wollen Services austauschen können (Renderer, Storage, Telemetrie) und alles unit-testbar halten.
**Entscheidung:** Jeder DI-registrierte Service hat ein `IXxx`-Interface in `Pagebound.Core/Abstractions/`. Implementierungen liegen in `Pagebound.Infrastructure/`. DI-Bindings im `Program.cs` registrieren ausschließlich gegen Interfaces.
**Konsequenzen:** + Testbarkeit + Austauschbarkeit + Klarheit der Schicht-Grenzen / − geringfügig mehr Boilerplate.

### ADR-002: Blazor WebAssembly statt JavaScript-Framework
**Status:** Akzeptiert
**Kontext:** Auftraggeber präferiert C# und plant langfristig .NET MAUI Hybrid für Native Apps.
**Entscheidung:** Blazor WASM auf .NET 10 als Frontend-Framework.
**Konsequenzen:** + Einheitliche Sprache C# über Web + Native / + Spätere MAUI-Portierung erleichtert / − Initiale Bundle-Größe (~3–5 MB AOT) / − Performance-Nachteil auf iOS Safari bei großen PDFs / − PDF.js trotzdem als JS-Dependency.
**Alternativen erwogen:** React/TypeScript (besser für Bundle-Größe), Svelte (vergleichbar), .NET MAUI nativ (kein Web).

### ADR-003: PDF.js via JS-Interop für Rendering
**Status:** Akzeptiert
**Kontext:** Es existiert keine reife pure-.NET-PDF-Render-Library, die in WASM läuft. PdfSharpCore kann zwar manipulieren, nicht rendern.
**Entscheidung:** PDF.js (Mozilla) wird via TypeScript-Bridge-Module in `wwwroot/js/` eingebunden. C#-Seite kennt nur das Interface `IPdfRenderer`.
**Konsequenzen:** + Industrie-Standard-Renderer / + Apache 2.0 / − Doppel-Bundle (Blazor + PDF.js) / − Bridge-Schicht muss gewartet werden.

### ADR-004: PdfSharpCore für PDF-Manipulation
**Status:** Akzeptiert
**Kontext:** Wir brauchen Merge/Split/Rotate/Compress/Encrypt in C#. iText scheidet wegen AGPL/kommerziell aus. QuestPDF kommerziell-only ab 1M $ Umsatz.
**Entscheidung:** PdfSharpCore (MIT) – läuft in WASM, Apache-kompatibel.
**Konsequenzen:** + Lizenz-passend / + reines C# / − weniger Features als iText / − AES-256-Encryption ggf. eigene Erweiterung nötig.

### ADR-005: JSON-Sidecar mit Schema-Versionierung
**Status:** Akzeptiert
**Kontext:** Annotation-Daten dürfen nicht ins PDF, weil PDF-Standard begrenzt erweiterbar und nicht git-friendly.
**Entscheidung:** JSON-Sidecar `<pdfPath>.pagebound.json` mit `schemaVersion`-Feld und Migrator-Kette.
**Konsequenzen:** + Mensch-lesbar / + Git-friendly / + Forward-/Backward-Compat / − User muss Sidecar beim Kopieren mitnehmen / − keine echte Standard-Annotation in der PDF.

### ADR-006: Eigenes PNG+SHA256-Schema statt PAdES (für MVP)
**Status:** Akzeptiert
**Kontext:** PAdES (ISO 32000-2) ist im Browser ohne kryptografisches CA-Schlüsselmaterial schwer umsetzbar. Auftraggeber wünscht trotzdem Integritätsprüfung.
**Entscheidung:** Eigenes Schema: PNG-Signaturbild als Annotation + SHA-256-Hash des fertigen PDF (mit Sentinel-Hash-Wert während der Berechnung). Hash gespeichert in PDF-Metadata und Sidecar.
**Konsequenzen:** + Im Browser umsetzbar / + Hybrid-Persistenz robust / − Nicht eIDAS-konform / − Kann theoretisch umgangen werden, wenn jemand sowohl PDF als auch Hashes neu setzt (offen kommuniziert in UI).
**Roadmap:** Echte PAdES-Signatur als FA-043 nach 1.0 nachgereicht.

### ADR-007: Eigene Komponenten mit Tailwind statt UI-Library
**Status:** Akzeptiert
**Kontext:** Auftraggeber will VS-Code/Obsidian-Vibe – keine Material-Klone (MudBlazor), keine Business-Optik (Radzen).
**Entscheidung:** Tailwind CSS + Headless-Komponenten-Pattern (eigene Razor-Komponenten mit Tailwind-Klassen).
**Konsequenzen:** + Volle Design-Kontrolle / + USP-Look / − Mehr eigener UI-Code zu schreiben.

### ADR-008: Feature-Folder statt Clean Architecture
**Status:** Akzeptiert
**Kontext:** Solo-Projekt; Clean Architecture mit 4 Schichten erzeugt Overhead.
**Entscheidung:** Feature-Folder in `Pagebound.Web/Features/`. Trennung zwischen `Core` (Domain + Abstractions) und `Infrastructure` (Implementierungen) bleibt für Testbarkeit erhalten, aber innerhalb von `Web` wird nach Feature gruppiert.
**Konsequenzen:** + Schnellere Navigation / + Co-Location / − Risiko unklarer Grenzen wenn Features wachsen — abgemildert durch Code-Reviews mit Self-Discipline.

### ADR-009: GitHub Actions für CI/CD
**Status:** Akzeptiert
**Kontext:** Offensichtliche Wahl bei GitHub-Hosting; kostenlos für Open-Source.
**Entscheidung:** GitHub Actions für Build, Test, Lighthouse-Audit, Deploy zu CNAME-Hosting.
**Konsequenzen:** + Kostenlos / + Integriert / − Vendor-Lock-in (akzeptabel).

### ADR-010: Apache License 2.0
**Status:** Akzeptiert
**Kontext:** Permissiv, mit Patent-Schutz-Klauseln, breit akzeptiert in Open-Source.
**Entscheidung:** Apache 2.0 für eigenen Code; nur kompatible Third-Party-Lizenzen.
**Konsequenzen:** + Maximale Adoption / + Patent-Schutz / − Forks dürfen kommerziell-closed werden (akzeptabel).

### ADR-011: Auto-Save mit IndexedDB als primärer Persistenz, Sidecar-Datei als Export
**Status:** Akzeptiert
**Kontext:** Aggressives Auto-Save (NFA-011) verträgt sich schlecht mit synchroner Datei-System-API; Schreibrechte sind unzuverlässig zwischen Browsern.
**Entscheidung:** Annotation-Änderungen werden sofort in IndexedDB persistiert. Sidecar-Datei wird beim PDF-Schließen oder explizit per „Speichern unter" geschrieben. UI zeigt dezent „Geändert seit letztem Speichern".
**Konsequenzen:** + Zuverlässige Persistenz / − User muss verstehen, dass Sidecar-Export ein expliziter Schritt ist — wird in Onboarding kommuniziert.

---

## 11. Risiken (technisch)

| ID | Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|---|---|---|---|---|
| R-001 | PDF.js ändert API stark in v5 | mittel | hoch | Version-Pinning, Bridge-Schicht abstrahiert |
| R-002 | Blazor WASM Bundle wächst auf > 8 MB | mittel | mittel | AOT, Trim, Lazy-Loading von OCR/Batch-Modulen |
| R-003 | Solo-Momentum verliert sich | hoch | hoch | Meilenstein-Schnitt, jeder Release nutzbar; CHANGELOG nach jeder Session |
| R-004 | Erwartung „PDF→Word in guter Qualität" | mittel | mittel | UI klar kommunizieren, KI-Phase v2 angekündigt |
| R-005 | File System Access nur in Chromium | hoch (bereits Realität) | mittel | Fallback Download-Workflow, OPFS langfristig |
| R-006 | Tesseract.js zu langsam bei großen PDFs (>500 S.) | mittel | niedrig | WebWorker + Progress-UI + Cancel-fähig |
| R-007 | PdfSharpCore AES-256 unzureichend | mittel | mittel | Eigene Erweiterung oder Fork |
| R-008 | iOS Safari blockiert IndexedDB-Quota für PWA | niedrig | hoch | OPFS-Fallback prüfen, User informieren |
| R-009 | Schema-Migration über mehrere Versionen wird komplex | mittel | mittel | Strenger Test-Coverage-Anspruch für Migratoren |
| R-010 | A11y-Score 90 wird im Reader (PDF-Inhalt) verfehlt | mittel | niedrig | Score ist auf App-UI bezogen, nicht PDF-Inhalt |

---

## 12. Schnittstellen-Detail

### 12.1 JS-Interop (Browser ↔ C#)

Die JS-Interop-Schicht ist klein und gut abgegrenzt:

| TypeScript-Modul | Verantwortung | C#-Counterpart |
|---|---|---|
| `pdfjs-bridge.ts` | PDF.js-Methoden weiterreichen | `PdfJsRenderer` |
| `tesseract-bridge.ts` | Tesseract.js-Worker steuern | `TesseractOcrService` |
| `fs-access.ts` | File System Access API (open/save/handle) | `FileSystemSidecarService` |
| `indexeddb-bridge.ts` | IndexedDB-Wrapper (Promise-basiert) | `IndexedDbStorage` |
| `webcrypto-bridge.ts` | SubtleCrypto für SHA-256 großer Streams | `Sha256HashService` |
| `theme-bridge.ts` | OS-Theme erkennen (`prefers-color-scheme`) | `ThemeService` |

### 12.2 Dateisystem-Schnittstellen

**Chromium-Pfad (File System Access API):**
1. User wählt PDF → `FileSystemFileHandle`.
2. Sidecar-Datei: Pagebound prüft `FileSystemDirectoryHandle` des Eltern-Ordners → versucht `<filename>.pagebound.json` zu lesen.
3. Schreiben: über `FileSystemWritableFileStream`.

**Firefox/Safari-Pfad (Fallback):**
1. User wählt PDF via `<input type="file">` → kein direktes Schreibrecht.
2. Sidecar wird in IndexedDB unter `sidecarsFallback` gespeichert.
3. UI zeigt „Sidecar exportieren" zum Download.

### 12.3 Externe Schnittstellen (Daten-Austausch)

| Schnittstelle | Format | Anwendung |
|---|---|---|
| PDF (Import) | ISO 32000-1/-2 | Datei öffnen |
| PDF (Export) | ISO 32000-1 | Datei speichern |
| Sidecar JSON | Eigenes Schema, JSON Schema Draft-07 dokumentiert | Persistenz + Backup + Migration |
| Markdown-Export | CommonMark + YAML-Frontmatter | Obsidian/Zettelkasten |
| Bild-Export | PNG, JPG | Sharing, Embedded-Use |
| Text-Export | UTF-8 plain | Volltext-Indexierung extern |
| HTML-Export | HTML5 standalone | Web-Sharing, Archivierung |

---

## 13. Build, Deploy & Hosting

### 13.1 Lokaler Build
```bash
dotnet build src/Pagebound.Web -c Release
dotnet publish src/Pagebound.Web -c Release -o publish/
```

### 13.2 Tailwind
```bash
npx tailwindcss -i src/Pagebound.Web/wwwroot/css/app.src.css \
                -o src/Pagebound.Web/wwwroot/css/app.css \
                --minify
```
In CI als Vor-Schritt vor `dotnet publish`.

### 13.3 Deployment
- `publish/wwwroot/` enthält alle statischen Dateien.
- Upload auf Cloudflare Pages oder GitHub Pages.
- Eigene Domain via CNAME.
- Service Worker (`service-worker.js`) cached alle Assets für Offline-Nutzung.

### 13.4 Versionierung
- Semantic Versioning (SemVer): `MAJOR.MINOR.PATCH`.
- Pre-1.0: Roadmap-Releases 0.1 – 0.9 als minor Bumps; jeder Release-Tag in Git.

---

## 14. Glossar (Tech-spezifisch)

| Begriff | Bedeutung |
|---|---|
| **DI** | Dependency Injection – Auflösung von Service-Instanzen über Container |
| **PWA** | Progressive Web App – installierbare, offline-fähige Web-App |
| **WASM** | WebAssembly – Maschinen-Code-Format im Browser |
| **AOT** | Ahead-of-Time Compilation – `.dll` → optimierter Maschinencode vor Auslieferung |
| **JS-Interop** | Aufruf von JavaScript aus C# (und umgekehrt) in Blazor |
| **OPFS** | Origin Private File System – browsereigenes Datei-System ohne User-Dialog |
| **bUnit** | Blazor-Test-Framework für Component-Tests |
| **Playwright** | Microsoft-Test-Framework für E2E-Browser-Tests |
| **Vertical Slice** | Feature-Folder-Architektur (alle Schichten eines Features beieinander) |
| **MoSCoW** | Priorisierung: Must / Should / Could / Won't (hier: Muss / Soll / Kann) |
| **Sentinel-Hash** | Platzhalter-Wert während Hash-Berechnung, um Henne-Ei-Problem zu vermeiden |
| **CSP** | Content Security Policy – Browser-Sicherheitsmechanismus gegen XSS |
| **ADR** | Architecture Decision Record |
| **SRI** | Subresource Integrity – Hash-Prüfung externer Skripte |
| **PAdES** | PDF Advanced Electronic Signatures (ISO 32000) |

---

## 15. Dokument-Historie

| Version | Datum | Änderung | Autor |
|---|---|---|---|
| 0.1 | 2026-05-13 | Erstentwurf nach Anforderungs-Workshop (6 Phasen) | Projektinitiator |
