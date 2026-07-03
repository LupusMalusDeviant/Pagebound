# Lokalisierung, Theme & UI-Shell

## Zweck

Zweisprachige UI (Deutsch/Englisch) über JSON-Ressourcen-Bundles mit einer schlanken `L.T(key, args)`-API inkl. Platzhalter-Interpolation (FA-102, NFA-050 bis NFA-052). Dazu Theme-Verwaltung (hell/dunkel plus Akzentfarben, FA-100/FA-101) auf Basis von CSS-Variablen und Tailwind v4. Ein Pre-Boot-Skript in `index.html` liest Sprache/Theme aus localStorage, bevor Blazor startet — damit gibt es keinen Flash of Unstyled/Untranslated Content (FOUC). Die UI-Shell (`MainLayout`, `SettingsPanel`, `Icon`) bindet beides zusammen.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/ILocalizationService.cs` | Interface: `T()`, `CurrentLanguage`, `LanguageChanged` |
| `src/Pagebound.Core/Abstractions/IThemeService.cs` | Interface: `CurrentTheme`, `SetThemeAsync`, `ThemeChanged` |
| `src/Pagebound.Core/Domain/ThemeName.cs` | Theme-Enum (Light/Dark/…) |
| `src/Pagebound.Infrastructure/Localization/LocalizationService.cs` | Lädt JSON-Bundles, Key→String-Mapping + Interpolation |
| `src/Pagebound.Infrastructure/Theme/ThemeService.cs` | Setzt Theme-Klasse/CSS-Variablen, persistiert Auswahl |
| `src/Pagebound.Web/wwwroot/resources/de.json` | Deutsches Sprach-Bundle |
| `src/Pagebound.Web/wwwroot/resources/en.json` | Englisches Sprach-Bundle |
| `src/Pagebound.Web/Layout/MainLayout.razor` | App-Shell: Navigation, Seitenrahmen |
| `src/Pagebound.Web/Layout/SettingsPanel.razor` | Einstellungen: Sprache, Theme, Akzentfarbe |
| `src/Pagebound.Web/Layout/Icon.razor` | Zentrale Icon-Komponente |
| `src/Pagebound.Web/wwwroot/css/app.src.css` | Tailwind-v4-Quelle + CSS-Variablen (Themes/Akzentfarben) |
| `src/Pagebound.Web/wwwroot/index.html` | Pre-Boot-Skript gegen FOUC (Theme/Sprache vor Blazor-Start) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Storage & Persistenz** — Sprach- und Theme-Auswahl werden in localStorage persistiert (Pre-Boot-lesbar). Siehe [`./storage-persistenz.md`](./storage-persistenz.md).

*(Umgekehrt konsumieren praktisch alle Features `L.T()` und die Theme-CSS-Variablen — dieses Feature ist die Basis-Schicht der UI.)*

### Extern (Packages)

- `tailwindcss` v4 — Utility-CSS, kompiliert `app.src.css` → `app.css`

## Öffentliche API / Interface

```csharp
public interface ILocalizationService
{
    string CurrentLanguage { get; }
    IReadOnlyList<string> AvailableLanguages { get; }
    event Action? LanguageChanged;

    string T(string key, IReadOnlyDictionary<string, object>? args = null);
    Task SetLanguageAsync(string languageCode, CancellationToken ct);
}

public interface IThemeService
{
    ThemeName CurrentTheme { get; }
    event Action<ThemeName>? ThemeChanged;
    Task SetThemeAsync(ThemeName theme, CancellationToken ct);
}
```

## Datenfluss / Call-Flow

1. **Boot:** Pre-Boot-Skript in `index.html` liest Theme + Sprache aus localStorage und setzt die Theme-Klasse/CSS-Variablen am `<html>`-Element, bevor Blazor lädt (kein FOUC).
2. **Blazor-Start:** `LocalizationService` lädt das passende Bundle aus `wwwroot/resources/{lang}.json`; Komponenten rendern Texte über `L.T("key")` mit optionaler `{Platzhalter}`-Interpolation.
3. **Sprachwechsel:** `SettingsPanel` → `SetLanguageAsync` → Bundle nachladen, persistieren, `LanguageChanged` feuern → Komponenten re-rendern.
4. **Theme-Wechsel:** `SettingsPanel` → `SetThemeAsync` → CSS-Klasse/Variablen umschalten, persistieren, `ThemeChanged` feuern; Akzentfarben laufen als CSS-Variablen durch `app.src.css`.
