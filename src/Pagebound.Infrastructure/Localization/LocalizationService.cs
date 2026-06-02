using System.Net.Http.Json;
using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Localization;

/// <summary>
/// Lädt JSON-Bundles aus <c>wwwroot/resources/{lang}.json</c> und liefert
/// einen einfachen Key→String-Resolver mit optionaler Argument-Interpolation
/// (Platzhalter <c>{name}</c> oder <c>{0}</c>). Persistiert die aktive Sprache
/// in <c>localStorage</c>, damit das Pre-Boot-Script in <c>index.html</c>
/// das <c>lang</c>-Attribut vor dem ersten Render schon richtig hat.
///
/// Erfüllt FA-101, FA-102, NFA-050/051/052.
/// </summary>
public sealed class LocalizationService : ILocalizationService
{
    private const string LocalStorageKey = "pb.lang";
    private const string DefaultLanguage = "de";

    private readonly HttpClient _http;
    private readonly IJSRuntime _js;
    private readonly Dictionary<string, IReadOnlyDictionary<string, string>> _bundles = new();
    private string _current = DefaultLanguage;

    public LocalizationService(HttpClient http, IJSRuntime js)
    {
        _http = http;
        _js = js;
    }

    public string CurrentLanguage => _current;

    public IReadOnlyList<string> AvailableLanguages { get; } = new[] { "de", "en" };

    public event Action? LanguageChanged;

    /// <summary>
    /// Initialisiert den Service: liest die zuletzt gewählte Sprache aus
    /// <c>localStorage</c>, fällt sonst auf <c>de</c> zurück und lädt das
    /// zugehörige Bundle. Vor dem ersten Render aufrufen.
    /// </summary>
    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var stored = await _js.InvokeAsync<string?>(
                "pageboundShortcuts.getStorage", cancellationToken, LocalStorageKey).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(stored) && AvailableLanguages.Contains(stored))
            {
                _current = stored;
            }
        }
        catch
        {
            // localStorage gesperrt — Default greift.
        }

        await LoadBundleAsync(_current, cancellationToken).ConfigureAwait(false);
    }

    public async Task SetLanguageAsync(string languageCode, CancellationToken cancellationToken)
    {
        if (!AvailableLanguages.Contains(languageCode)) return;
        if (_current == languageCode) return;

        // Speichern + Hard-Reload: jede Komponente nutzt T() im Render-Pfad,
        // ein App-weiter Reload ist deutlich simpler als jede Komponente eigene
        // `LanguageChanged`-Subscriptions schreiben zu lassen (NFA-051: vollständig
        // übersetzt zur Laufzeit, keine Mischsprache nach Wechsel).
        try
        {
            await _js.InvokeVoidAsync(
                "pageboundShortcuts.setStorage", cancellationToken, LocalStorageKey, languageCode).ConfigureAwait(false);
            await _js.InvokeVoidAsync("pageboundShortcuts.reload", cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Reload nicht möglich — Wert ist gespeichert, beim nächsten Boot greift er.
        }
    }

    public string T(string key, IReadOnlyDictionary<string, object>? args = null)
    {
        if (!_bundles.TryGetValue(_current, out var bundle) || !bundle.TryGetValue(key, out var template))
        {
            // Missing-Key-Fallback: Schlüssel selbst zurückgeben, damit fehlende
            // Übersetzungen sofort im UI sichtbar werden statt leise zu schlucken.
            return key;
        }

        if (args is null || args.Count == 0) return template;

        var result = template;
        foreach (var (k, v) in args)
        {
            result = result.Replace("{" + k + "}", v?.ToString() ?? string.Empty);
        }
        return result;
    }

    private async Task LoadBundleAsync(string lang, CancellationToken cancellationToken)
    {
        if (_bundles.ContainsKey(lang)) return;

        // Netz-zuerst mit Cache-Bust: Pagebound ist eine PWA — der Service-Worker
        // (und ggf. der Browser-HTTP-Cache) liefert sonst eine veraltete
        // {lang}.json, eine Deploy-Version hinterher. Folge: neu hinzugekommene
        // i18n-Schlüssel erscheinen als rohe Keys im UI (z. B. „nav.pdf"). Der
        // eindeutige Query-Param matcht KEINEN SW-/HTTP-Cache-Eintrag und erzwingt
        // damit ein frisches Laden. Schlägt das fehl (offline), greift der Fallback
        // ohne Query — den bedient der Service-Worker aus seinem Cache.
        var bust = DateTime.UtcNow.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var json = await TryLoadBundleAsync($"resources/{lang}.json?v={bust}", cancellationToken).ConfigureAwait(false)
                   ?? await TryLoadBundleAsync($"resources/{lang}.json", cancellationToken).ConfigureAwait(false);
        if (json is not null)
        {
            _bundles[lang] = json;
        }
    }

    private async Task<Dictionary<string, string>?> TryLoadBundleAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            // Der Query-Param in url (Cache-Bust) matcht keinen Service-Worker-/
            // HTTP-Cache-Eintrag → es wird frisch über das Netz geladen.
            return await _http.GetFromJsonAsync<Dictionary<string, string>>(url, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Netzfehler / kein Bundle — Aufrufer versucht den Fallback bzw. fällt
            // am Ende auf rohe Keys zurück.
            return null;
        }
    }
}
