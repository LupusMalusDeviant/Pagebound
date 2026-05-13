# ADR-007: Tailwind CSS mit eigenen Headless-Komponenten statt UI-Library

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound braucht ein durchdachtes UI-System (FA-100 ff., NFA-030 ff.). Der Auftraggeber strebt ein „VS Code / Obsidian"-Design-Profil an — Developer-/Knowledge-Tool-Ästhetik, **nicht** Material-Design-Look, **nicht** Business-App-Optik.

Standard-Optionen für Blazor:

| Option | Stil | Lizenz | Anpassbarkeit |
|---|---|---|---|
| MudBlazor | Material Design | Apache 2.0 (frei) / Pro (kommerziell) | hoch, aber „MudBlazor-Look" sichtbar |
| Radzen Blazor | Business-/Admin-Look | MIT | hoch, Themes kommerziell |
| Fluent UI Blazor | Microsoft Fluent | MIT | mittel, sehr Microsoft-zentriert |
| Tailwind + eigen | beliebig | MIT (Tailwind) | maximal |

## Entscheidung

**Tailwind CSS + eigene Headless-Razor-Komponenten.**

Konkret:
- Tailwind wird über `npm`-Build (`postcss` + `tailwindcss`) eingebunden.
- Tailwind-Output liegt unter `wwwroot/css/app.css`.
- Themes werden über **CSS Custom Properties** umgesetzt (Light, Dark, Sepia, Custom — FA-100).
- Eigene Razor-Komponenten in `src/Pagebound.Web/Components/` implementieren das Headless-Pattern (Verhalten getrennt von Style; Style über Tailwind-Klassen).

## Konsequenzen

**Positiv:**
- **Volle Design-Kontrolle**: kein „sieht aus wie alle anderen MudBlazor-Apps"-Problem.
- **Konsistenter Vibe** zum Knowledge-Tool-Profil (VS Code / Obsidian).
- **Theme-Wechsel via CSS-Variablen**: extrem performant, kein Re-Render der Komponenten nötig.
- **Lizenz unkritisch** (Tailwind MIT, eigener Code Apache 2.0).
- **Lernwert** für den Auftraggeber (Tailwind ist in der Web-Welt verbreitet).

**Negativ:**
- **Mehr eigener Code zu schreiben** — Komponenten wie `Dialog`, `Dropdown`, `Tooltip`, `Tabs`, `Toast` müssen wir selbst implementieren.
- **A11y muss eigenhändig sichergestellt werden** (NFA-030 ff.) — UI-Libraries bieten das oft mit; bei eigenen Komponenten ist sorgfältige ARIA-Beachtung Pflicht.
- **Build-Kette**: `npm`-Schritt vor `dotnet build` (kein einzelnes Build-Tool).

**Mitigation:**
- Wir referenzieren etablierte Headless-Patterns (Headless UI von Tailwind Labs als Vorbild, in C#/Blazor-Form übersetzt).
- A11y wird per Quality-Gate (Lighthouse ≥ 90 — NFA-034) verifiziert; jede neue Komponente muss vor dem PR-Merge a11y-getestet sein.
- CI-Pipeline integriert den `npm run build:css`-Schritt vor `dotnet publish`.

## Alternativen erwogen

- **MudBlazor**: solide, aber Material-Design-Vibe ungewollt. Verworfen wegen Look-Mismatch.
- **Fluent UI Blazor**: Microsoft-Look ist akzeptabel, aber weniger flexibel. Verworfen, weil Tailwind langfristig flexibler.
- **Radzen**: Business-Look passt schlecht zur Reading-App. Verworfen.
- **Reine CSS-Datei ohne Tailwind**: zu viel Boilerplate, kein Utility-First-Vorteil. Verworfen.

## Referenz

- Lastenheft TEC-04, FA-100, NFA-030 ff.
- Pflichtenheft Abschnitt 6.5 (Tailwind-Build)
- CONTRIBUTING.md (npm-Schritt im Setup)
