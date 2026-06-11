using System.Globalization;

namespace Pagebound.Core.Domain;

/// <summary>Physische Maße eines Seitenformats in Millimetern (LF-02).</summary>
public sealed record PageDimensions(double WidthMm, double HeightMm, double MarginMm)
{
    private static string Mm(double v) => v.ToString("0.###", CultureInfo.InvariantCulture) + "mm";

    /// <summary>CSS-Breite (Inline-Style des Seiten-Elements).</summary>
    public string CssWidth => Mm(WidthMm);

    /// <summary>CSS-Höhe.</summary>
    public string CssHeight => Mm(HeightMm);

    /// <summary>CSS-Innenrand (Dokumentränder = Satzspiegel).</summary>
    public string CssMargin => Mm(MarginMm);

    /// <summary>Wert für <c>@page { size: … }</c> beim Drucken.</summary>
    public string CssPageSize => $"{Mm(WidthMm)} {Mm(HeightMm)}";
}

/// <summary>Maße je <see cref="PageLayout"/>. Zentrale Quelle für Editor + Druck.</summary>
public static class EditorLayouts
{
    public static PageDimensions For(PageLayout layout) => layout switch
    {
        PageLayout.A4Portrait => new PageDimensions(210, 297, 20),
        PageLayout.A4Landscape => new PageDimensions(297, 210, 20),
        PageLayout.A5Portrait => new PageDimensions(148, 210, 15),
        PageLayout.Letter => new PageDimensions(215.9, 279.4, 20),
        PageLayout.Slide16x9 => new PageDimensions(254, 142.875, 12),
        PageLayout.DinLong => new PageDimensions(105, 210, 10),
        PageLayout.A6Landscape => new PageDimensions(148, 105, 10),
        _ => new PageDimensions(210, 297, 20)
    };
}
