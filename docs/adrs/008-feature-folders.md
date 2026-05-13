# ADR-008: Feature-Folder (Vertical Slices) statt Clean Architecture

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Bei .NET-Projekten existieren mehrere etablierte Architektur-Stile:

- **Clean Architecture / Onion**: Vier Schichten (Domain, Application, Infrastructure, Presentation). Jede Schicht ein eigenes Projekt. Sehr strikt entkoppelt.
- **Layered Architecture**: Drei Schichten (UI, Business, Data). Klassisch, etwas weniger streng als Clean.
- **Feature-Folder / Vertical Slices**: Gruppierung nach **Feature**, nicht nach technischer Schicht. Eine Folder enthält UI + ViewModel + Service-Interfaces + Tests dieses Features.

Pagebound ist ein **Solo-Projekt**. Der Trade-off zwischen Strukturen ist entscheidend.

## Entscheidung

**Wir nutzen Feature-Folder innerhalb des Web-Projekts, kombiniert mit einer leichten Drei-Projekt-Aufteilung für Testbarkeit.**

Konkrete Struktur:

```
src/Pagebound.Web/
├─ Features/                        ← Feature-Folder
│  ├─ Library/                      → LibraryPage.razor + ViewModel + Komponenten
│  ├─ Reader/
│  ├─ Annotation/
│  ├─ Signature/
│  ├─ Export/
│  ├─ Ocr/
│  └─ Batch/
└─ Components/                      ← Geteilte UI-Bausteine

src/Pagebound.Core/                 ← Domain + Abstractions (rein, keine externen Refs)
├─ Domain/
├─ Abstractions/                    ← Service-Interfaces
└─ Application/                     ← Use-Case-Orchestrierung

src/Pagebound.Infrastructure/       ← Konkrete Service-Implementierungen
└─ Pdf/, Storage/, Crypto/, Ocr/, Telemetry/, …
```

**Begründung der Drei-Projekt-Aufteilung trotz Feature-Folder:**
- `Pagebound.Core` als reine Bibliothek erlaubt unit-testbare Domain ohne Browser-/Blazor-Abhängigkeiten.
- `Pagebound.Infrastructure` kapselt externe Bibliotheken (PdfSharpCore, PDF.js-Interop) — wenn diese ausgetauscht werden, ist nur ein Projekt betroffen.
- `Pagebound.Web` ist die UI-Schicht; Feature-Folder gruppieren UI-Belange feinkörnig.

## Konsequenzen

**Positiv:**
- **Schnellere Navigation**: alles zu „Library" liegt zusammen.
- **Co-Location** von UI + ViewModel + Komponenten reduziert Datei-Springerei.
- **Weniger Projekt-Overhead** als Clean Architecture (4–6 Projekte).
- **Testbarkeit erhalten** durch Core/Infrastructure-Trennung.

**Negativ:**
- **Risiko unklarer Grenzen**, wenn Features groß werden (z.B. Library wächst auf 20+ Razor-Dateien).
- **Disziplin nötig**: Feature-Folder darf nicht zu „God-Folder" werden.

**Mitigation:**
- Self-Discipline-Regel: maximal ~15 Dateien pro Feature-Folder. Bei Überschreiten Sub-Folder bilden (z.B. `Library/Filtering/`, `Library/Sorting/`).
- Code-Reviews achten auf Folder-Hygiene.
- ADR-Änderung möglich, wenn das Projekt wirklich auf größeres Team wächst.

## Alternativen erwogen

- **Clean Architecture mit 4+ Projekten**: zu viel Overhead für Solo, viel „durch die Schichten reichen".
- **Single-Projekt-Lösung**: keine Trennung zwischen Domain und UI → Domain wäre nicht unit-testbar ohne Browser.
- **Hexagonal Architecture (Ports & Adapters)**: konzeptionell ähnlich zu unserem Drei-Projekt-Setup, aber mehr Namens-Overhead. Verworfen zugunsten von einfacher zu kommunizierender Struktur.

## Referenz

- Lastenheft TEC-07 (Interface-First)
- Pflichtenheft Abschnitt 3.1, 3.2 (Architektur und Struktur)
- ADR-001 (Interface-First)
