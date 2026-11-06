namespace Pagebound.Core.Text;

/// <summary>
/// Sortiert Titel so, wie man es im Deutschen erwartet — unabhängig von der
/// Kultur des Browsers und auch im invarianten Globalisierungsmodus (die App
/// läuft mit InvariantGlobalization, Bean PDF-Tool-icu1; dort wäre
/// CurrentCultureIgnoreCase rein ordinal und „Äpfel" landete hinter „Zebra").
///
/// Regeln: Groß-/Kleinschreibung egal; Umlaute und Akzente zählen als
/// Grundbuchstabe (ä→a, é→e, ø→o; DIN 5007-1); ß zählt als „ss". Bei Gleichstand
/// entscheidet der Grundbuchstabe vor dem Akzent („Apfel" vor „Äpfel"), dann
/// ordinal — damit ist die Reihenfolge stabil und total.
/// Bewusst ohne Kultur-APIs und ohne string.Normalize: das Ergebnis ist überall gleich.
/// </summary>
public sealed class TitleComparer : IComparer<string?>
{
    public static readonly TitleComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        if (ReferenceEquals(x, y)) return 0;
        if (x is null) return -1;
        if (y is null) return 1;

        var primary = string.CompareOrdinal(Fold(x), Fold(y));
        if (primary != 0) return primary;
        var caseInsensitive = string.Compare(x, y, StringComparison.OrdinalIgnoreCase);
        if (caseInsensitive != 0) return caseInsensitive;
        return string.CompareOrdinal(x, y);
    }

    /// <summary>Kleinbuchstaben, Diakritika entfernt, ß→ss, Ligaturen aufgelöst.</summary>
    public static string Fold(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length + 4);
        foreach (var ch in s)
        {
            var c = char.ToLowerInvariant(ch);
            var mapped = Map(c);
            if (mapped is null) sb.Append(c);
            else sb.Append(mapped);
        }
        return sb.ToString();
    }

    private static string? Map(char c) => c switch
    {
        'à' or 'á' or 'â' or 'ã' or 'ä' or 'å' or 'ā' or 'ă' or 'ą' => "a",
        'æ' => "ae",
        'ç' or 'ć' or 'ĉ' or 'ċ' or 'č' => "c",
        'ď' or 'đ' or 'ð' => "d",
        'è' or 'é' or 'ê' or 'ë' or 'ē' or 'ĕ' or 'ė' or 'ę' or 'ě' => "e",
        'ĝ' or 'ğ' or 'ġ' or 'ģ' => "g",
        'ĥ' or 'ħ' => "h",
        'ì' or 'í' or 'î' or 'ï' or 'ĩ' or 'ī' or 'ĭ' or 'į' or 'ı' => "i",
        'ĵ' => "j",
        'ķ' => "k",
        'ĺ' or 'ļ' or 'ľ' or 'ŀ' or 'ł' => "l",
        'ñ' or 'ń' or 'ņ' or 'ň' => "n",
        'ò' or 'ó' or 'ô' or 'õ' or 'ö' or 'ø' or 'ō' or 'ŏ' or 'ő' => "o",
        'œ' => "oe",
        'ŕ' or 'ŗ' or 'ř' => "r",
        'ś' or 'ŝ' or 'ş' or 'š' => "s",
        'ß' => "ss",
        'ţ' or 'ť' or 'ŧ' => "t",
        'þ' => "th",
        'ù' or 'ú' or 'û' or 'ü' or 'ũ' or 'ū' or 'ŭ' or 'ů' or 'ű' or 'ų' => "u",
        'ŵ' => "w",
        'ý' or 'ÿ' or 'ŷ' => "y",
        'ź' or 'ż' or 'ž' => "z",
        _ => null,
    };
}
