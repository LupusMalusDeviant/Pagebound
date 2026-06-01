# Mitwirken an Pagebound

Vielen Dank für dein Interesse, an Pagebound mitzuwirken! Dieses Dokument beschreibt, wie du dich beteiligen kannst.

## Bevor du loslegst

1. Lies die drei Planungs-Dokumente, um den Kontext zu verstehen:
   - [docs/01-requirements.md](docs/01-requirements.md) – was Pagebound ist und warum
   - [docs/02-lastenheft.md](docs/02-lastenheft.md) – welche Funktionen mit welcher Priorität
   - [docs/03-pflichtenheft.md](docs/03-pflichtenheft.md) – wie es technisch umgesetzt wird
2. Lies die [ADRs](docs/adrs/), um zu verstehen, *warum* bestimmte Architektur-Entscheidungen getroffen wurden.
3. Lies den [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Setup der Entwicklungsumgebung

### Voraussetzungen

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 20+](https://nodejs.org/) (für Tailwind CSS Build)
- Git
- Empfohlene IDE: Visual Studio 2026, JetBrains Rider, oder VS Code mit C# Dev Kit

### Erstmaliger Build

```bash
git clone https://github.com/<owner>/pagebound.git
cd pagebound

# .NET-Pakete wiederherstellen
dotnet restore

# Tailwind-CSS-Build (einmalig)
cd src/Pagebound.Web
npm install
npm run build:css

# Zurück zum Repo-Root
cd ../..

# Lokal starten
dotnet run --project src/Pagebound.Web
```

### Tests laufen lassen

```bash
# Unit- & Component-Tests (ohne E2E)
dotnet test --filter "FullyQualifiedName!~E2ETests"

# Nur Unit-Tests
dotnet test tests/Pagebound.Core.Tests
```

**E2E-Tests (Playwright).** Sie fahren einen echten Browser gegen die *laufende*
App. Der Harness ist so gebaut, dass er sich **sauber überspringt** (statt rot zu
werden), wenn weder Server noch Browser bereitstehen — `dotnet test` bleibt also
auch ohne Setup grün. Für einen echten Lauf:

```bash
# 1) App in einem Terminal starten (Dev-Server auf :5099)
dotnet run --project src/Pagebound.Web --urls http://localhost:5099

# 2) In einem zweiten Terminal die E2E-Tests laufen lassen
#    (lädt beim ersten Mal Chromium nach; PAGEBOUND_URL ist optional, Default :5099)
PAGEBOUND_URL=http://localhost:5099 dotnet test tests/Pagebound.E2ETests
```

In CI übernimmt das der eigene `e2e-tests`-Job (publish → statisch serven →
Playwright `--with-deps` → `dotnet test`).

## Architektur-Prinzipien (verbindlich)

Diese Prinzipien gelten für **jeden** Beitrag (siehe [ADR-001](docs/adrs/001-interface-first.md)):

1. **Interface-First.** Jeder DI-registrierte Service besteht aus einem Interface `IXxxService` in `Pagebound.Core/Abstractions/` und mindestens einer Implementation in `Pagebound.Infrastructure/`.
2. **Tests gegen Interfaces.** Nutze Mocks (`NSubstitute`) gegen Interfaces, nicht gegen konkrete Klassen.
3. **Feature-Folder.** UI + ViewModel + Components eines Features liegen zusammen in `src/Pagebound.Web/Features/<FeatureName>/`.
4. **Keine Layer-Verletzungen.** `Pagebound.Core` darf keine UI- oder Infrastructure-Referenzen haben. `Pagebound.Infrastructure` darf nur `Core` referenzieren, nicht `Web`.

## Code-Stil

- C#-Konventionen folgen [.editorconfig](.editorconfig). Aktiviere "Format on Save" in deinem Editor.
- Interfaces mit `I`-Prefix (erzwungen via Analyzer).
- Private Felder als `_camelCase`.
- Maximale Zeilenlänge 120 Zeichen (Empfehlung, nicht hart erzwungen).
- Kommentare nur wo das *Warum* nicht-trivial ist. Code soll selbsterklärend sein.

## Pull-Request-Prozess

1. **Issue zuerst.** Größere Änderungen bitte erst als Issue diskutieren.
2. **Fork & Branch.** Branch-Name: `feat/<kurz>`, `fix/<kurz>`, `docs/<kurz>`, `refactor/<kurz>`.
3. **Commits klein und fokussiert.** [Conventional Commits](https://www.conventionalcommits.org/de/) erwünscht.
4. **Tests dazu.** Neue Funktionalität braucht Unit-Tests. Bug-Fixes brauchen Regressionstests.
5. **Doku aktualisieren.** README, CHANGELOG, ADR (wenn architekturrelevant), Anwender-Handbuch.
6. **CI muss grün sein.** Build, Tests, Lighthouse-A11y-Score ≥ 90.
7. **PR-Beschreibung.** Verweise auf das adressierte Issue, beschreibe Was+Warum, nenne betroffene FA-/NFA-IDs aus dem Lastenheft.

## ADR-Prozess

Architekturrelevante Entscheidungen werden als ADR (Architecture Decision Record) dokumentiert. Wann eine ADR fällig ist:

- Neue externe Bibliothek wird aufgenommen
- Service-Schnitt wird grundlegend geändert
- Datenmodell wird verändert
- Build/Deploy/CI-Strategie wird angepasst
- Performance-/Security-Trade-off mit Auswirkung auf andere Module

Format: Eine neue Datei `docs/adrs/<nnn>-<kurzer-titel>.md`, Nummerierung fortlaufend. Vorlage siehe bestehende ADRs.

## Übersetzungen

UI-Sprachdateien liegen in `src/Pagebound.Web/Resources/`. Ab MVP gibt es `de.json` und `en.json`. Weitere Sprachen sind als PRs willkommen. Schlüssel sind in flacher Punkt-Notation (`library.title`, `annotation.highlight.label`).

## Fragen

- Allgemeine Fragen: GitHub Discussions
- Bug-Reports: GitHub Issues mit Label `bug`
- Feature-Wünsche: GitHub Issues mit Label `enhancement`, bitte vorher prüfen, ob es im Lastenheft schon erwähnt ist
- Sicherheitsprobleme: bitte privat melden (siehe SECURITY.md, sobald vorhanden), **nicht** als öffentliches Issue
