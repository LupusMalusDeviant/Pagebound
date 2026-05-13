# ADR-001: Interface-First-Architektur als verbindliches Prinzip

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound ist ein langlebiges Open-Source-Projekt mit ambitioniertem Funktionsumfang. Folgende Anforderungen werden im Projekt-Verlauf wichtig:

1. **Testbarkeit** — Domain-Logik muss ohne Browser, ohne PDF.js und ohne IndexedDB unit-testbar sein (NFA-071, NFA-072).
2. **Austauschbarkeit** — Der PDF-Renderer (PDF.js heute, eventuell native MAUI-Implementation morgen) und der Storage-Layer (File System Access auf Chromium, OPFS-Fallback auf anderen Browsern) müssen ohne Auswirkung auf Aufrufer ausgetauscht werden können.
3. **Erweiterbarkeit** — Spätere Plugins sollen eigene Implementierungen von z.B. `IExportService` registrieren können.
4. **Mehrfach-Implementationen** — Telemetrie hat eine `NoOpTelemetryService` (Default) und eine `OptInCrashReportService` (User-aktiviert); beide müssen austauschbar gegen das gleiche Interface gebaut sein.

Der Auftraggeber hat dieses Prinzip explizit als verbindlich gefordert.

## Entscheidung

**Jeder DI-registrierte Service besteht aus einem `IXxxService`-Interface und mindestens einer Implementation `XxxService`.**

Konkrete Folgerungen:

1. **Interfaces liegen in `Pagebound.Core/Abstractions/`** — eine reine Bibliothek ohne externe Abhängigkeiten außerhalb des .NET-BCL.
2. **Implementationen liegen in `Pagebound.Infrastructure/`** — physisch getrennt vom Interface.
3. **DI-Container-Registrierungen** im `Program.cs` registrieren ausschließlich gegen Interfaces:
   ```csharp
   builder.Services.AddScoped<IPdfRenderer, PdfJsRenderer>();
   builder.Services.AddScoped<ITelemetryService, NoOpTelemetryService>();
   ```
4. **Aufrufer (UI-Komponenten, andere Services)** hängen nur vom Interface ab, nie von der konkreten Klasse.
5. **Code-Reviews** prüfen explizit, dass dieses Prinzip bei jedem neuen Service eingehalten wird.

## Konsequenzen

**Positiv:**
- Tests mit Mocks (NSubstitute) gegen Interfaces sind trivial.
- Wechsel der Renderer-/Storage-/Telemetrie-Implementierung berührt nur eine DI-Zeile.
- Klare Schicht-Grenzen, leichter Onboarding für Mitwirkende.
- Plug-in-fähig durch Service-Registrierung von außen.

**Negativ:**
- Geringfügig mehr Boilerplate (Interface-Datei + Implementation-Datei statt nur einer Klasse).
- Bei sehr einfachen Services (`IClock`, `IGuidProvider`) entsteht Overhead.

**Mitigation des Negativen:**
- Für triviale Hilfen, die nicht ausgetauscht werden müssen (z.B. eine Konvertierungs-Utility-Klasse), wird **bewusst auf das Interface verzichtet**. Faustregel: hat das Ding einen externen Abhängigkeitsgraph (Browser-API, NuGet-Library, IO) → Interface. Ist es reines C# ohne Seiteneffekte → darf statische Methode oder konkrete Klasse bleiben.

## Alternativen erwogen

- **Implementation-First, Refactoring on Demand** — verworfen, weil das in der Praxis zu Klumpenbildung führt und Tests nachträglich zu schreiben unrealistisch ist.
- **Vollständig statische Klassen** — verworfen, weil DI und Testbarkeit dann praktisch verloren gehen.
- **Adapter-Pattern erst, wenn Austausch nötig wird** — verworfen, weil das bei laufendem Code refactoring-intensiv und fehleranfällig ist.

## Referenz

- Lastenheft NFA-070
- Pflichtenheft Abschnitt 3.1 und 4 (Service-Spezifikationen)
- CONTRIBUTING.md (Code-Review-Pflicht)
