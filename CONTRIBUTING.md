# Mitwirken an Pagebound

Vielen Dank für dein Interesse, an Pagebound mitzuwirken! Dieses Dokument beschreibt, wie du dich beteiligen kannst.

## Bevor du loslegst

1. Lies die [README](README.md) für den Überblick und das [Benutzerhandbuch](docs/05-benutzerhandbuch.md) für den vollen Funktionsumfang.
2. Wirf einen Blick auf den Abschnitt **Architektur** in der README — er fasst die wichtigsten Entscheidungen zusammen.
3. Lies den [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Setup der Entwicklungsumgebung

### Voraussetzungen

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 20+](https://nodejs.org/) (für den Tailwind- + esbuild-Build)
- Git
- Empfohlene IDE: Visual Studio 2026, JetBrains Rider, oder VS Code mit C# Dev Kit

### Erstmaliger Build

```bash
git clone https://github.com/<owner>/pagebound.git
cd pagebound

# .NET-Pakete wiederherstellen
dotnet restore

# Frontend-Assets bauen (Tailwind-CSS + JS-Interop-Bridges) — einmalig
cd src/Pagebound.Web
npm install
npm run build

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

### Code-Coverage (Ziel ≥ 60 %)

```bash
dotnet test --filter "FullyQualifiedName!~E2ETests" \
  --settings coverlet.runsettings --collect:"XPlat Code Coverage"
# Ergebnis: tests/**/TestResults/<guid>/coverage.cobertura.xml (line-rate)
```

`coverlet.runsettings` nimmt die reinen **JavaScript-Interop-Shims** aus der
Messung (PDF.js-/pdf-lib-/WebCrypto-/Tesseract-/IndexedDB-/FSA-Wrapper) — deren
Logik läuft im Browser und ist über die E2E-/Browser-Verifikation abgedeckt, nicht
über Unit-Tests. Gemessen wird die testbare .NET-Logik (Services + Domain). Neue
reine Interop-Wrapper bitte entweder dort eintragen oder mit
`[ExcludeFromCodeCoverage]` markieren; **echte Logik gehört getestet, nicht
ausgeschlossen.**

## Architektur-Prinzipien (verbindlich)

Diese Prinzipien gelten für **jeden** Beitrag:

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
5. **Doku aktualisieren.** README, CHANGELOG und — bei neuen Endnutzer-Funktionen — das Benutzerhandbuch.
6. **CI muss grün sein.** Build, Tests, Lighthouse-A11y-Score ≥ 90.
7. **PR-Beschreibung.** Verweise auf das adressierte Issue, beschreibe Was + Warum.

## Übersetzungen

UI-Sprachdateien liegen in `src/Pagebound.Web/wwwroot/resources/` (`de.json`, `en.json`). Weitere Sprachen sind als PRs willkommen. Schlüssel sind in flacher Punkt-Notation (`library.title`, `annotation.highlight.label`); beide Bundles müssen dieselben Schlüssel enthalten.

## Fragen

- Allgemeine Fragen: GitHub Discussions
- Bug-Reports: GitHub Issues mit Label `bug`
- Feature-Wünsche: GitHub Issues mit Label `enhancement`
- Sicherheitsprobleme: bitte privat melden (siehe [SECURITY.md](SECURITY.md)), **nicht** als öffentliches Issue
