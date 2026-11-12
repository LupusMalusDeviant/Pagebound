namespace Pagebound.Core.Domain;

/// <summary>
/// Welche Seiten gleichzeitig als Bild im Speicher liegen dürfen.
/// Vertrag: <c>docs/contracts/seitenbilder-speicher.md</c>, Teil B.
/// <para>
/// Bewusst hier und nicht in der Reader-Komponente: dort wäre es eine private
/// Methode einer 4500-Zeilen-Komponente ohne Prüfung. Die Rechnung ist der
/// Kern der Sache — läuft sie falsch, bleibt entweder alles im Speicher stehen
/// (der alte Fehler) oder die sichtbare Seite wird weggeworfen.
/// </para>
/// </summary>
public static class PageWindow
{
    /// <summary>
    /// Fenster aus den sichtbaren Seiten und dem Puffer je Richtung, begrenzt
    /// auf <paramref name="pageCount"/>. Ohne sichtbare Seiten gibt es kein
    /// Fenster — dann steht <c>From &gt; To</c>, und nichts wird gerendert.
    /// </summary>
    public static (int From, int To) Compute(
        IReadOnlyCollection<int> visiblePages,
        int buffer,
        int pageCount)
    {
        ArgumentNullException.ThrowIfNull(visiblePages);
        if (pageCount < 1 || visiblePages.Count == 0) return (1, 0);

        var buf = Math.Max(0, buffer);
        var min = int.MaxValue;
        var max = int.MinValue;
        foreach (var p in visiblePages)
        {
            // Meldungen aus der Oberfläche sind nicht vertrauenswürdig: eine
            // Seitenzahl ausserhalb des Dokuments darf das Fenster nicht
            // aufreissen.
            if (p < 1 || p > pageCount) continue;
            if (p < min) min = p;
            if (p > max) max = p;
        }
        if (min == int.MaxValue) return (1, 0);

        return (Math.Max(1, min - buf), Math.Min(pageCount, max + buf));
    }

    /// <summary>
    /// Die Seiten, die aus dem Fenster gefallen sind und freigegeben werden
    /// müssen. Aufsteigend, damit die Freigabe eine feste Reihenfolge hat.
    /// </summary>
    public static IReadOnlyList<int> Outside(IEnumerable<int> held, int from, int to)
    {
        ArgumentNullException.ThrowIfNull(held);
        return held.Where(p => p < from || p > to).OrderBy(p => p).ToList();
    }

    /// <summary>
    /// Die Seiten des Fensters in Renderreihenfolge: von der Mitte nach aussen,
    /// damit die sichtbare Seite vor ihrem Puffer kommt. Bei gleichem Abstand
    /// gewinnt die kleinere Seitenzahl, damit die Reihenfolge bestimmt ist.
    /// </summary>
    public static IReadOnlyList<int> RenderOrder(int from, int to)
    {
        if (to < from) return Array.Empty<int>();
        var centre = from + (to - from) / 2;
        return Enumerable.Range(from, to - from + 1)
            .OrderBy(p => Math.Abs(p - centre))
            .ThenBy(p => p)
            .ToList();
    }
}
