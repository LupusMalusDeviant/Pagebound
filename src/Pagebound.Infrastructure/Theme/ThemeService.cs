using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Theme;

/// <summary>
/// Setzt das aktive Theme als <c>data-theme</c>-Attribut auf <c>&lt;html&gt;</c>;
/// die zugehörigen CSS-Variablen liegen in <c>wwwroot/css/app.src.css</c>
/// (Tailwind v4 @theme inline). Persistiert die Wahl in <c>localStorage</c>,
/// damit das initiale Inline-Script in <c>index.html</c> beim nächsten Boot
/// vor dem Blazor-Start FOUC-frei das richtige Theme setzen kann.
///
/// Erfüllt FA-100.
/// </summary>
public sealed class ThemeService : IThemeService
{
    private const string LocalStorageKey = "pb.theme";

    private readonly IJSRuntime _js;
    private ThemeName _current = ThemeName.Auto;

    public ThemeService(IJSRuntime js)
    {
        _js = js;
    }

    public ThemeName CurrentTheme => _current;

    public event Action<ThemeName>? ThemeChanged;

    /// <summary>
    /// Liest das gespeicherte Theme aus localStorage. Aufzurufen einmalig
    /// nach dem ersten Render — vorher ist das DOM-Element noch nicht da.
    /// </summary>
    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var stored = await _js.InvokeAsync<string?>(
                "pageboundShortcuts.getStorage", cancellationToken, LocalStorageKey).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(stored)
                && Enum.TryParse<ThemeName>(stored, ignoreCase: true, out var theme))
            {
                _current = theme;
                ThemeChanged?.Invoke(_current);
            }
        }
        catch
        {
            // localStorage nicht erreichbar — wir bleiben bei Auto.
        }
    }

    public async Task SetThemeAsync(ThemeName theme, CancellationToken cancellationToken)
    {
        _current = theme;
        var attrValue = MapToAttribute(theme);
        try
        {
            await _js.InvokeVoidAsync(
                "pageboundShortcuts.applyTheme", cancellationToken, attrValue).ConfigureAwait(false);
            await _js.InvokeVoidAsync(
                "pageboundShortcuts.setStorage", cancellationToken, LocalStorageKey, theme.ToString()).ConfigureAwait(false);
        }
        catch
        {
            // JS-Bridge nicht erreichbar — Wert wird beim nächsten Render
            // via OnAfterRenderAsync nachträglich appliziert.
        }
        ThemeChanged?.Invoke(theme);
    }

    /// <summary>
    /// "auto" lassen wir bewusst leer — dann greift der
    /// <c>prefers-color-scheme</c>-Fallback in <c>app.src.css</c>.
    /// </summary>
    private static string MapToAttribute(ThemeName theme) => theme switch
    {
        ThemeName.Light => "light",
        ThemeName.Dark => "dark",
        ThemeName.Sepia => "sepia",
        _ => string.Empty
    };
}
