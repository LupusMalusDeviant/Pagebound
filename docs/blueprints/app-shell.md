# App-Shell & Start

## Zweck

Der Rahmen, in dem alle anderen Features laufen: die DI-Registrierung aller Dienste hinter ihren Interfaces, das Routing, das Layout mit Navigation und Einstellungen, die Startseite und das Nachladen der großen JS-Brücken. Ohne dieses Feature gibt es keine Komposition — die Fachfeatures kennen einander nicht, sie kennen nur Interfaces aus `Pagebound.Core`.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Program.cs` | Kompositionswurzel: 24 Dienste hinter ihren Interfaces (Zeilen 35–62), HttpClient für die Sprachbündel, Sync von Theme und Sprache vor dem ersten Render |
| `src/Pagebound.Web/App.razor` | Router: `Found` → Layout, `NotFound` → `/not-found` |
| `src/Pagebound.Web/_Imports.razor` | Gemeinsame `@using`-Liste aller Razor-Komponenten |
| `src/Pagebound.Web/Pages/Home.razor` | Startseite auf `/` (`Home.razor:1`) |
| `src/Pagebound.Web/Pages/NotFound.razor` | Seite auf `/not-found` (`NotFound.razor:1`) |
| `src/Pagebound.Web/Layout/MainLayout.razor` | Shell: Navigation, Seitenrahmen, Einstiegspunkt der Einstellungen |
| `src/Pagebound.Web/Layout/SettingsPanel.razor` | Einstellungen: Sprache, Theme, Akzentfarbe, Dichte |
| `src/Pagebound.Web/Layout/Icon.razor` | Eine Icon-Komponente für die ganze App (keine Icon-Bibliothek, keine externen Requests) |
| `src/Pagebound.Web/wwwroot/index.html` | Hülle: Metadaten, Vor-Boot-Skript gegen FOUC (`index.html:40`–`72`), Boot-Bildschirm `#pb-boot` (`index.html:78`), Skript-Reihenfolge boot.js dann lazy-bridges.js (`index.html:108`, `111`) |
| `src/Pagebound.Web/wwwroot/js/lazy-bridges.js` | Platzhalter für die drei großen Brücken, die erst beim ersten Zugriff geladen werden (`lazy-bridges.js:28`–`31`) |
| `src/Pagebound.Web/wwwroot/css/app.src.css` | Tailwind-v4-Quelle samt Theme- und Akzent-Variablen; dazu die handgeschriebenen `@media`-Blöcke für das Telefon-Layout anderer Features (siehe unten) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Library & Workspace** (Typ, Laufzeit, via `ILibraryService`, `LibraryEntry`, `PdfMeta`, `LibraryQuery`, `LibrarySort`): die Shell zeigt zuletzt geöffnete Dokumente und verlinkt in die Bibliothek — `src/Pagebound.Web/Layout/MainLayout.razor:4`. Siehe [`./library-workspace.md`](./library-workspace.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): alle Shell-Texte laufen über `L.T()` — `src/Pagebound.Web/Layout/MainLayout.razor:3`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `load`, `apply`): die Shell liest und setzt die UI-Feineinstellungen über die Tweaks-Brücke — `src/Pagebound.Web/Layout/MainLayout.razor:281`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

### Extern (Packages)

- `Microsoft.AspNetCore.Components.WebAssembly` — Blazor-WASM-Host, Router, DI
- `tailwindcss` v4 — kompiliert `app.src.css` nach `app.css`

## Öffentliche API / Interface

Die Shell exportiert keine Fach-API. Ihr Vertrag ist die DI-Tabelle: jedes Fachfeature bekommt seine Abhängigkeit als Interface injiziert, nie als konkrete Klasse (ADR-001). Zwei Dienste sind Singletons (`IHashService`, `ITelemetryService`), die übrigen 22 pro Bereich (Scoped) — `src/Pagebound.Web/Program.cs:35`–`62`.

Routen der App:

| Route | Seite |
|-------|-------|
| `/` | `Pages/Home.razor:1` |
| `/reader` | `Features/Reader/ReaderPage.razor:1` |
| `/split` | `Features/Reader/SplitViewPage.razor:1` |
| `/compare` | `Features/Reader/ComparePage.razor:1` |
| `/library` | `Features/Library/LibraryPage.razor:1` |
| `/tools` | `Features/PdfTools/PdfToolsPage.razor:1` |
| `/organize` | `Features/PdfTools/OrganizerPage.razor:1` |
| `/form-builder` | `Features/PdfTools/FormBuilderPage.razor:1` |
| `/batch` | `Features/PdfTools/BatchPage.razor:1` |
| `/editor`, `/editor/{Id}` | `Features/Editor/DesignerPage.razor:1`–`2` |
| `/not-found` | `Pages/NotFound.razor:1` |

## Datenfluss / Call-Flow

1. `index.html` lädt. Das Vor-Boot-Skript liest `?lang=de|en` und `pb.lang` aus localStorage und setzt `lang` am `<html>`-Element, dann Theme und Akzent als `data-theme` (`index.html:46`–`61`). Das passiert vor Blazor, damit kein ungestylter oder unübersetzter Zustand aufblitzt.
2. Der Boot-Bildschirm `#pb-boot` steht im HTML, nicht in Blazor (`index.html:78`) — er ist sichtbar, bevor die WASM-Laufzeit da ist, und trägt bereits die Drop-Zone des Datei-Eintritts.
3. `src/Pagebound.Web/wwwroot/js/boot.js` wird geladen (`index.html:108`), danach `src/Pagebound.Web/wwwroot/js/lazy-bridges.js` (`index.html:111`). Letzteres legt für `pageboundPdf`, `pageboundPdfManipulator` und `pageboundSign` je einen Proxy-Platzhalter an; der erste Aufruf lädt das echte Bündel nach und ruft dann die echte Funktion (`lazy-bridges.js:28`–`31`, Lade-Logik ab `:36`).
4. `Program.cs` registriert die 24 Dienste und baut den Host; **vor** `RunAsync` werden Theme und Sprache aus localStorage in den C#-Zustand gespiegelt, damit der erste Render bereits stimmt (`Program.cs:64` ff.).
5. `App.razor` übergibt an `MainLayout`; die Seite zur Route rendert innerhalb der Shell.

## Telefon-Layout in `app.src.css`

Seit der Entscheidung vom 2026-11-08 (`CLAUDE.md`, Abschnitt „Style-Regeln") liegt das Telefon-Verhalten der Arbeitsflächen in handgeschriebenen `@media`-Blöcken dieser Datei, nicht als Responsive-Präfixe im Markup. Die Feature-Dateien setzen nur Klassen und Zustandsklassen; was sie bewirken, steht hier.

| Block in `app.src.css` | Für welches Feature |
|------------------------|---------------------|
| `@media (max-width: 640px)` mit `.pb-reader…` | [PDF-Reader & Rendering](./pdf-reader.md) |
| `@media (max-width: 640px)` mit `.pb-editor-toolbar` und `.pb-swatch` | [Designer (WYSIWYG)](./designer.md) |
| `@media (max-width: 860px)` mit `.pb-split…` | [Split-View & Vergleich](./split-view-vergleich.md) |
| `@media (min-width: 641px)` mit `.pb-phone-only`, `@media (min-width: 1024px)` mit `.pb-mobile-only` | zwei Sichtbarkeits-Helfer, je eine Grenze |
| `@media (hover: none) and (pointer: coarse)` mit `.pb-reader-keyhint` | Tastenkürzel nur auf Geräten mit Tasten |

Das heißt für die Änderungsverfolgung: eine Änderung an dieser Datei kann Features berühren, zu denen **keine** Kante führt. Der Kantengraph sieht CSS-Klassen nicht. Wer `app.src.css` anfasst, prüft die Features in der Tabelle mit.

`app.css` ist Build-Ausgabe und nicht eingecheckt (`.gitignore:66`); die CI erzeugt sie im Schritt „Build CSS + JS bridges" aus `app.src.css`.

## Offene Fragen / TODOs

- Nur drei Brücken werden verzögert geladen. `pageboundMind` bleibt bewusst synchron, weil `wysiwyg-editor.ts` `renderMindmapDataUrl` synchron aufruft und ein Promise dort ein falscher Wert wäre (Begründung im Kopf von `lazy-bridges.js`).
- `MainLayout.razor` trägt neben Navigation auch Logik für die Tweaks; eine klarere Trennung wäre möglich, ist aber keine erkannte Fehlerquelle.
