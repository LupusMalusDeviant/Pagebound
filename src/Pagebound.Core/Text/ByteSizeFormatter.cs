using System.Globalization;

namespace Pagebound.Core.Text;

/// <summary>
/// Dateigrößen für die Anzeige („512 KB", „1,5 MB"). Das Dezimalzeichen folgt
/// der App-Sprache (DE: Komma, sonst Punkt) — nicht der Browserkultur: die App
/// läuft mit InvariantGlobalization (Bean PDF-Tool-icu1), und eine deutsch
/// eingestellte Oberfläche soll auch in einem englischen Browser „1,5 MB" zeigen.
/// Ersetzt drei abweichende Kopien (Library, Werkzeuge, Stapel).
/// </summary>
public static class ByteSizeFormatter
{
    private const long Kb = 1024, Mb = Kb * 1024, Gb = Mb * 1024;

    public static string Format(long bytes, string? language)
    {
        if (bytes < 0) bytes = 0;
        if (bytes < Kb) return bytes.ToString(CultureInfo.InvariantCulture) + " B";
        if (bytes < Mb) return Number(bytes / (double)Kb, 0, language) + " KB";
        if (bytes < Gb) return Number(bytes / (double)Mb, 1, language) + " MB";
        return Number(bytes / (double)Gb, 2, language) + " GB";
    }

    private static string Number(double value, int decimals, string? language)
    {
        var s = value.ToString("F" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        return UsesDecimalComma(language) ? s.Replace('.', ',') : s;
    }

    private static bool UsesDecimalComma(string? language) =>
        language is not null && language.StartsWith("de", StringComparison.OrdinalIgnoreCase);
}
