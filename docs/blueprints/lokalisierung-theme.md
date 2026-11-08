# Lokalisierung & Theme

## Zweck

Zweisprachige Oberfläche (Deutsch und Englisch) über JSON-Textbündel mit einer schmalen `L.T(key, args)`-API samt Platzhaltern, plus Theme (hell und dunkel) und Akzentfarben über CSS-Variablen. Das Vor-Boot-Skript in `index.html` liest Sprache und Theme aus localStorage, bevor Blazor startet — damit blitzt kein ungestylter oder unübersetzter Zustand auf. Fast jedes andere Feature hängt hier dran.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/ILocalizationService.cs` | Vertrag: `T()`, `CurrentLanguage`, `LanguageChanged` (`:8`) |
| `src/Pagebound.Core/Abstractions/IThemeService.cs` | Vertrag: `CurrentTheme`, `SetThemeAsync`, `ThemeChanged` (`:9`) |
| `src/Pagebound.Core/Domain/ThemeName.cs` | Die zugelassenen Themes |
| `src/Pagebound.Infrastructure/Localization/LocalizationService.cs` | Lädt die Bündel, bildet Schlüssel auf Text ab, interpoliert; greift über die Interop-Brücke auf localStorage und Theme zu (`:48`) |
| `src/Pagebound.Infrastructure/Theme/ThemeService.cs` | Setzt Theme-Attribut und CSS-Variablen, sichert die Auswahl |
| `src/Pagebound.Web/wwwroot/resources/de.json` | Deutsches Textbündel |
| `src/Pagebound.Web/wwwroot/resources/en.json` | Englisches Textbündel |

Die Shell-Komponenten (`MainLayout`, `SettingsPanel`, `Icon`) gehören zu [App-Shell & Start](./app-shell.md); das Vor-Boot-Skript und `app.src.css` ebenfalls.

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Interop-Hilfen (UI)** (Querschnitt, via `getStorage`, `setStorage`, `reload`, `applyTheme`): localStorage lesen und schreiben, Theme am `<html>`-Element setzen, nach einem Sprachwechsel neu laden — `src/Pagebound.Infrastructure/Localization/LocalizationService.cs:48`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

Das ist die einzige ausgehende Kante. Umgekehrt binden **zwölf** Features `ILocalizationService` ein — dieses Feature ist die Grundschicht der Oberfläche.

### Extern (Packages)

- `tailwindcss` v4 — kompiliert `app.src.css` nach `app.css`; die Theme- und Akzent-Variablen stehen dort, nicht im C#-Code
- Der HttpClient aus `Program.cs:25` lädt die Bündel aus `wwwroot/resources/` — eine Anfrage an die eigene Herkunft, kein externer Dienst

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

`T()` ist **synchron** und liefert immer eine Zeichenkette. Fehlt ein Schlüssel, kommt der Schlüssel selbst zurück statt einer Ausnahme — eine fehlende Übersetzung zeigt sich damit in der Oberfläche, bricht aber keine Seite.

## Datenfluss / Call-Flow

1. **Vor dem Start:** das Skript in `index.html` liest `?lang=de|en` und `pb.lang` aus localStorage und setzt `lang` am `<html>`-Element, dann Theme und Akzent als Attribute (`index.html:46`–`61`). Das passiert vor dem Laden der WASM-Laufzeit.
2. **Blazor-Start:** `Program.cs` holt Theme und Sprache in den C#-Zustand, **bevor** `RunAsync` läuft, damit der erste Render stimmt (`Program.cs:64` ff.).
3. `LocalizationService` lädt das Bündel `wwwroot/resources/{lang}.json`; Komponenten rendern über `L.T("key")` mit optionalen `{Platzhaltern}`.
4. **Sprachwechsel:** `SettingsPanel` → `SetLanguageAsync` → Bündel nachladen, in localStorage sichern (`getStorage`/`setStorage`, `LocalizationService.cs:48`), `LanguageChanged` auslösen; wo ein Neuaufbau nötig ist, löst `reload` das aus.
5. **Themewechsel:** `SetThemeAsync` → Attribut und Variablen umschalten (`applyTheme`), sichern, `ThemeChanged` auslösen. Akzentfarben laufen rein über CSS-Variablen in `app.src.css`.

## Offene Fragen / TODOs

- Zwei Bündel müssen von Hand synchron gehalten werden. Eine Prüfung, dass `de.json` und `en.json` dieselben Schlüssel haben, gibt es nicht; ein fehlender Schlüssel fällt erst in der Oberfläche auf.
- Ein Sprachwechsel kann ein Neuladen auslösen (`reload`, `shortcuts-bridge.ts:679`). Welche Fälle das genau sind, ist aus dem Dienst nicht abzulesen — im Code zu verifizieren.
