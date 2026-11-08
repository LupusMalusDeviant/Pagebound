# Core-Verträge

## Zweck

`src/Pagebound.Core/Abstractions` ist die Trennlinie der Architektur: **24 Dateien mit 25 Interfaces**, hinter denen jede Umsetzung steckt. Die Web-Schicht kennt nur diese Interfaces, nie eine konkrete Klasse aus `Pagebound.Infrastructure` (ADR-001, Interface-First-DI). Das ist der Grund, warum eine Brücke austauschbar ist, warum `Pagebound.Core` ohne Browser prüfbar bleibt und warum diese Struktur ohne ausdrückliche Freigabe nicht geändert wird.

## Dateien

| Pfad | Interface | Umsetzung |
|------|-----------|-----------|
| `IAnnotationService.cs:10` | Annotationen anlegen, ändern, lesen, beobachten | `AnnotationService` |
| `IBatchRuleStore.cs:9` | Stapel-Regeln ablegen | `BatchRuleStore` |
| `IDesignFolderService.cs:18` | Design-Ordner im Dateisystem | `BrowserDesignFolderService` |
| `IEditorDraftService.cs:10` | Designer-Entwürfe | `EditorDraftService` |
| `IFileHandleService.cs:13` | persistente Datei-Handles | `FileSystemAccessHandleService` |
| `IHashService.cs:9` | SHA-256 über Stream oder Speicherblock | `Sha256HashService` (Singleton) |
| `IImageToPdfConverter.cs:13` | Bilder zu PDF | `JsImageToPdfConverter` |
| `IIntegrityService.cs:17` | Integritätsnachweis für Signaturen | `IntegrityService` |
| `ILibraryService.cs:13` | Bibliothek, Identität über Hash | `LibraryService` |
| `ILocalizationService.cs:8` | Textbündel und `T()` | `LocalizationService` |
| `IMarkdownExporter.cs:10` | Annotationen als Markdown | `MarkdownExporter` |
| `IOcrService.cs:10` | Texterkennung je Seite | `TesseractOcrService` |
| `IPdfArchiveService.cs:20` | PDF/A-2b und PDF/UA-1 | `JsPdfArchiveService` |
| `IPdfConverter.cs:9` | PDF in neun Zielformate | `JsPdfConverter` |
| `IPdfEncryptor.cs:14` | AES-256-Verschlüsselung | `JsPdfEncryptor` |
| `IPdfFormService.cs:14` | AcroForms lesen und füllen | `JsPdfFormService` |
| `IPdfManipulator.cs:14` | 18 Operationen am PDF | `JsPdfLibManipulator` |
| `IPdfRenderer.cs:10` | Laden, Rendern, Text, Suche, Outline | `PdfJsRenderer` |
| `IPdfSignService.cs:17` | zertifikatbasierte Signatur | `JsPdfSignService` |
| `ISidecarService.cs:12` | Sidecar lesen, schreiben, migrieren | `JsonSidecarService` |
| `ISidecarService.cs:64` | `ISidecarMigration` — eine Schemastufe | (je Migration eine Klasse) |
| `IStorageService.cs:8` | Schlüssel-Wert plus Blobs | `IndexedDbStorage` |
| `ITelemetryService.cs:8` | Fehler und Ereignisse melden | `NoOpTelemetryService` (Singleton) |
| `IThemeService.cs:9` | Theme setzen | `ThemeService` |
| `IWorkspaceService.cs:15` | Workspace-Ordner | `BrowserWorkspaceService` |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

**Keine** — und das ist die Eigenschaft, die zählt. Dieses Feature hat keine ausgehende Kante im geprüften Graph, weil es nur Interfaces und Domain-Typen enthält. Jede andere Schicht zeigt hierher; es zeigt auf nichts zurück.

### Extern (Packages)

- Keine. Nur die Basisklassenbibliothek von .NET.

## Öffentliche API / Interface

Das Feature **ist** die API. Zwei Verträge mit Sonderstellung:

```csharp
// src/Pagebound.Core/Abstractions/ITelemetryService.cs:8
public interface ITelemetryService
{
    bool IsEnabled { get; }
    Task TrackExceptionAsync(Exception exception, IReadOnlyDictionary<string, string>? context, CancellationToken ct);
    Task TrackEventAsync(string eventName, IReadOnlyDictionary<string, string>? properties, CancellationToken ct);
}
```

`ITelemetryService` existiert, damit es **eine** Stelle gibt, an der Telemetrie hinginge — und damit maschinell prüfbar ist, dass dort nichts hingeht: `tools/privacy-check.mjs` verlangt, dass `Program.cs` weiterhin `NoOpTelemetryService` registriert (`Program.cs:36`). Ein Vertrag als Sperre, nicht als Erweiterungspunkt.

```csharp
// src/Pagebound.Core/Abstractions/ISidecarService.cs:64
public interface ISidecarMigration
{
    string FromVersion { get; }
    // …
}
```

`ISidecarMigration` ist der einzige Vertrag, der **nicht** in der DI landet: Migrationen werden vom Sidecar-Dienst selbst aufgelöst. Deshalb sind es 25 Interfaces, aber nur 24 Registrierungen in `Program.cs:35`–`62`.

## Datenfluss / Call-Flow

Dieses Feature hat keinen Ablauf — es hat eine Regel, und die gilt in jeder Richtung:

1. `Pagebound.Web` bindet ein Interface ein (`@inject IPdfRenderer R`), nie eine Klasse.
2. `Program.cs` verbindet Interface und Umsetzung an **einer** Stelle (`:35`–`62`).
3. `Pagebound.Infrastructure` setzt um und darf den Browser kennen; `Pagebound.Core` darf das nicht.
4. Deshalb laufen die 219 .NET-Prüfungen ohne Browser: sie prüfen `Pagebound.Core`, und was dort liegt, braucht keinen.

Kompositionswurzeln erzeugen im Kantengraph bewusst keine Kanten — sonst hinge jedes Feature an jedem. Wer wissen will, wer ein Interface wirklich benutzt, sucht die Aufrufer im Code; dass eine Methode existiert, heißt nicht, dass sie genutzt wird.

## Offene Fragen / TODOs

- 25 Interfaces für ein Produkt dieser Größe sind viel; mehrere haben genau eine Umsetzung und werden es absehbar behalten (`IHashService`, `IMarkdownExporter`). Der Nutzen liegt hier weniger im Austausch als in der Prüfbarkeit ohne Browser — und bei `ITelemetryService` in der Sperre.
- `IPdfManipulator` hat 18 Methoden (`IPdfManipulator.cs:16`–`141`) und ist damit kein Vertrag mehr, sondern ein Sammelbecken. Ein Aufteilen wäre sauberer, würde aber acht Features anfassen.
