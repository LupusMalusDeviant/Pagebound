# Pagebound.Core.Application

Hier liegen die **Use Cases** der Anwendung — Orchestrierung mehrerer Service-Interfaces zur Erfüllung einer fachlichen Aufgabe.

Use Cases sind dünne C#-Klassen, die per Konstruktor-Injection ihre benötigten `IXxxService`-Abhängigkeiten erhalten.

## Beispiele für erwartete Use Cases

- `OpenPdfUseCase` — kombiniert `IPdfRenderer.LoadAsync` + `ISidecarService.TryLoadAsync` + `ISignatureService.VerifyAsync` + `ILibraryService.UpdateAsync` (Last-Opened-Timestamp).
- `SignPdfUseCase` — kombiniert `ISignatureService.SignAsync` + `IHashService.ComputeAsync` + Sidecar-Update.
- `ExportHighlightsToMarkdownUseCase` — kombiniert `IAnnotationService.GetForDocumentAsync` + `IMarkdownExporter.ExportAsync`.
- `AddPdfToLibraryUseCase` — kombiniert `IPdfRenderer.LoadAsync` (Meta-Daten lesen) + `ILibraryService.AddAsync` + erste Sidecar-Erzeugung.

## Regel

Ein Use Case enthält **keine** Domain-Logik. Domain-Logik gehört in die Domain-Klassen. Use Cases sind reine Koordinatoren.

Use Cases bekommen ihre eigenen Unit-Tests in `tests/Pagebound.Core.Tests/Application/`. Service-Abhängigkeiten werden via NSubstitute gemockt.
