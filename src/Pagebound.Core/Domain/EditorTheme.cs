using System.Globalization;

namespace Pagebound.Core.Domain;

/// <summary>
/// Gestaltungs-Theme eines WYSIWYG-Dokuments (Flyer-Designs): Schriften und
/// Farben, die dokumentweit wirken. Wird als Teil des Dokuments gespeichert und
/// kann als eigenständige JSON-Datei exportiert/importiert werden (Weitergabe).
/// Schrift-Angaben sind Schlüssel (kein freies CSS) — siehe <see cref="EditorThemes.FontStack"/>.
/// </summary>
public sealed class EditorTheme
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Schrift-Schlüssel für Überschriften (georgia | newsreader | hanken | mono).</summary>
    public string HeadingFont { get; set; } = "georgia";

    /// <summary>Schrift-Schlüssel für Fließtext.</summary>
    public string BodyFont { get; set; } = "georgia";

    public string HeadingColor { get; set; } = "#111827";
    public string BodyColor { get; set; } = "#111827";

    /// <summary>Akzentfarbe (Trenner, Tabellenkopf, neue Formen).</summary>
    public string AccentColor { get; set; } = "#2563eb";

    /// <summary>Standard-Seitenfarbe für Seiten ohne eigenen Hintergrund (null = weiß).</summary>
    public string? PageBackground { get; set; }

    public EditorTheme Clone() => new()
    {
        Name = Name,
        HeadingFont = HeadingFont,
        BodyFont = BodyFont,
        HeadingColor = HeadingColor,
        BodyColor = BodyColor,
        AccentColor = AccentColor,
        PageBackground = PageBackground
    };
}

/// <summary>Eingebaute Theme-Presets und Schrift-Stacks (nur selbst gehostete Fonts).</summary>
public static class EditorThemes
{
    /// <summary>Erlaubte Schrift-Schlüssel → CSS-Font-Stacks. Unbekannte Schlüssel fallen auf Georgia zurück.</summary>
    public static readonly IReadOnlyDictionary<string, string> FontStacks = new Dictionary<string, string>
    {
        ["georgia"] = "Georgia, 'Times New Roman', serif",
        ["newsreader"] = "'Newsreader', Georgia, 'Times New Roman', serif",
        ["hanken"] = "'Hanken Grotesk', system-ui, Arial, sans-serif",
        ["mono"] = "'JetBrains Mono', Consolas, monospace"
    };

    public static string FontStack(string? key)
        => key is not null && FontStacks.TryGetValue(key, out var stack) ? stack : FontStacks["georgia"];

    public static IReadOnlyList<EditorTheme> Presets { get; } = new[]
    {
        new EditorTheme { Name = "Klassik", HeadingFont = "georgia", BodyFont = "georgia",
            HeadingColor = "#111827", BodyColor = "#111827", AccentColor = "#6b7280" },
        new EditorTheme { Name = "Modern", HeadingFont = "hanken", BodyFont = "hanken",
            HeadingColor = "#111827", BodyColor = "#374151", AccentColor = "#2563eb" },
        new EditorTheme { Name = "Editorial", HeadingFont = "newsreader", BodyFont = "georgia",
            HeadingColor = "#1f2937", BodyColor = "#1f2937", AccentColor = "#b45309", PageBackground = "#fffdf8" },
        new EditorTheme { Name = "Dunkel", HeadingFont = "hanken", BodyFont = "hanken",
            HeadingColor = "#f9fafb", BodyColor = "#e5e7eb", AccentColor = "#f59e0b", PageBackground = "#111827" },
        new EditorTheme { Name = "Frisch", HeadingFont = "hanken", BodyFont = "georgia",
            HeadingColor = "#047857", BodyColor = "#1f2937", AccentColor = "#10b981", PageBackground = "#f0fdf4" },
        new EditorTheme { Name = "Elegant", HeadingFont = "newsreader", BodyFont = "newsreader",
            HeadingColor = "#9d174d", BodyColor = "#27272a", AccentColor = "#9d174d", PageBackground = "#fffbf5" }
    };

    /// <summary>
    /// Validiert eine Farbangabe aus Fremddaten (Theme-/Dokument-Import). Nur
    /// <c>#rgb</c>/<c>#rrggbb</c> werden akzeptiert — verhindert CSS-Injection
    /// über manipulierte Theme-Dateien. Liefert sonst <paramref name="fallback"/>.
    /// </summary>
    public static string SanitizeColor(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var v = value.Trim();
        if (v.Length is not (4 or 7) || v[0] != '#') return fallback;
        for (var i = 1; i < v.Length; i++)
            if (!Uri.IsHexDigit(v[i])) return fallback;
        return v.ToLowerInvariant();
    }

    /// <summary>Wie <see cref="SanitizeColor(string?,string)"/>, erlaubt aber auch null (= keine Farbe).</summary>
    public static string? SanitizeColorOrNull(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : SanitizeColor(value, "#ffffff");

    /// <summary>
    /// Bringt ein importiertes Theme in einen sicheren Zustand: Schrift-Schlüssel
    /// auf bekannte Werte begrenzt, Farben validiert, Name gekürzt.
    /// </summary>
    public static EditorTheme Sanitize(EditorTheme theme)
    {
        theme.Name = (theme.Name ?? string.Empty).Trim();
        if (theme.Name.Length > 60) theme.Name = theme.Name[..60];
        if (!FontStacks.ContainsKey(theme.HeadingFont ?? "")) theme.HeadingFont = "georgia";
        if (!FontStacks.ContainsKey(theme.BodyFont ?? "")) theme.BodyFont = "georgia";
        theme.HeadingColor = SanitizeColor(theme.HeadingColor, "#111827");
        theme.BodyColor = SanitizeColor(theme.BodyColor, "#111827");
        theme.AccentColor = SanitizeColor(theme.AccentColor, "#2563eb");
        theme.PageBackground = SanitizeColorOrNull(theme.PageBackground);
        return theme;
    }

    /// <summary>
    /// Mischt eine Hex-Farbe mit Weiß (für sanfte Akzentflächen wie Tabellenköpfe),
    /// z. B. <c>MixWithWhite("#2563eb", 12)</c> = 12 % Farbe, 88 % Weiß.
    /// </summary>
    public static string MixWithWhite(string hex, int percent)
    {
        var c = SanitizeColor(hex, "#000000");
        if (c.Length == 4) c = $"#{c[1]}{c[1]}{c[2]}{c[2]}{c[3]}{c[3]}";
        var p = Math.Clamp(percent, 0, 100) / 100.0;
        var r = (int)Math.Round(int.Parse(c.Substring(1, 2), NumberStyles.HexNumber) * p + 255 * (1 - p));
        var g = (int)Math.Round(int.Parse(c.Substring(3, 2), NumberStyles.HexNumber) * p + 255 * (1 - p));
        var b = (int)Math.Round(int.Parse(c.Substring(5, 2), NumberStyles.HexNumber) * p + 255 * (1 - p));
        return $"#{r:x2}{g:x2}{b:x2}";
    }
}
