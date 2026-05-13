namespace Pagebound.Core.Abstractions;

/// <summary>
/// Übersetzungs-Service. Lädt JSON-Ressourcen aus wwwroot/resources/ und
/// liefert Schlüssel→String-Mapping mit Platzhalter-Interpolation.
/// Erfüllt FA-102, NFA-050, NFA-051, NFA-052.
/// </summary>
public interface ILocalizationService
{
    string CurrentLanguage { get; }

    IReadOnlyList<string> AvailableLanguages { get; }

    event Action? LanguageChanged;

    string T(string key, IReadOnlyDictionary<string, object>? args = null);

    Task SetLanguageAsync(string languageCode, CancellationToken cancellationToken);
}
