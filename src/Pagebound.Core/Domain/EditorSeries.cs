using System.Text;
using System.Text.RegularExpressions;

namespace Pagebound.Core.Domain;

/// <summary>
/// Serien-Designs: ein Dokument mit <c>{{platzhalter}}</c>-Tokens wird je
/// CSV-Zeile zu einem Seitensatz expandiert (Serienbrief/Serienflyer). Die erste
/// CSV-Zeile liefert die Spaltennamen; Platzhalter sind case-insensitiv.
/// Reine Daten-Operation — gut testbar, vom Editor und Export gemeinsam genutzt.
/// </summary>
public static partial class EditorSeries
{
    [GeneratedRegex(@"\{\{\s*([\p{L}\p{N}_\-\.]+)\s*\}\}")]
    private static partial Regex TokenRegex();

    /// <summary>
    /// Minimaler RFC-4180-naher CSV-Parser: Komma oder Semikolon als Trenner
    /// (automatisch erkannt), doppelte Anführungszeichen mit "" -Escape, CRLF/LF.
    /// Erste Zeile = Spaltennamen. Leere Zeilen werden übersprungen.
    /// </summary>
    public static List<Dictionary<string, string>> ParseCsv(string csv)
    {
        var rows = new List<List<string>>();
        var field = new StringBuilder();
        var current = new List<string>();
        var inQuotes = false;
        // Trenner-Heuristik anhand der Kopfzeile (außerhalb von Quotes).
        var headerLine = csv.Split('\n', 2)[0];
        var delimiter = headerLine.Count(c => c == ';') > headerLine.Count(c => c == ',') ? ';' : ',';

        void EndField() { current.Add(field.ToString()); field.Clear(); }
        void EndRow()
        {
            EndField();
            if (current.Count > 1 || current[0].Trim().Length > 0) rows.Add(current);
            current = new List<string>();
        }

        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; }
                    else inQuotes = false;
                }
                else field.Append(c);
            }
            else if (c == '"') inQuotes = true;
            else if (c == delimiter) EndField();
            else if (c == '\n') EndRow();
            else if (c != '\r') field.Append(c);
        }
        if (field.Length > 0 || current.Count > 0) EndRow();

        if (rows.Count < 2) return new List<Dictionary<string, string>>();
        var headers = rows[0].Select(h => h.Trim()).ToList();
        var result = new List<Dictionary<string, string>>();
        foreach (var row in rows.Skip(1))
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < headers.Count; i++)
            {
                if (headers[i].Length == 0) continue;
                dict[headers[i]] = i < row.Count ? row[i] : string.Empty;
            }
            if (dict.Values.Any(v => v.Trim().Length > 0)) result.Add(dict);
        }
        return result;
    }

    /// <summary>Alle eindeutigen <c>{{token}}</c>-Namen eines Dokuments (für UI-Hinweise).</summary>
    public static IReadOnlyList<string> FindTokens(EditorDocument doc)
    {
        var tokens = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        void Scan(string? s)
        {
            if (string.IsNullOrEmpty(s)) return;
            foreach (Match m in TokenRegex().Matches(s)) tokens.Add(m.Groups[1].Value);
        }
        Scan(doc.Title);
        foreach (var page in doc.Pages)
        {
            foreach (var b in page.Blocks)
            {
                Scan(b.Text);
                if (b.ColumnsHtml is not null) foreach (var col in b.ColumnsHtml) Scan(col);
                if (b.Rows is not null) foreach (var row in b.Rows) foreach (var cell in row) Scan(cell);
            }
            foreach (var ov in page.Overlays) Scan(ov.Text);
        }
        return tokens.ToList();
    }

    /// <summary>
    /// Expandiert das Vorlagen-Dokument: je CSV-Zeile einmal alle Seiten, Tokens
    /// ersetzt (HTML-encodiert — CSV-Werte werden nie als Markup interpretiert).
    /// Das Vorlagen-Dokument bleibt unverändert (Schablonen-Semantik).
    /// </summary>
    public static EditorDocument Expand(EditorDocument template, List<Dictionary<string, string>> rows)
    {
        var result = new EditorDocument
        {
            Title = template.Title + " — Serie",
            Layout = template.Layout,
            Theme = template.Theme?.Clone()
        };
        foreach (var row in rows)
        {
            foreach (var page in template.Pages)
            {
                var copy = page.Clone();
                foreach (var b in copy.Blocks)
                {
                    b.Text = Replace(b.Text, row);
                    if (b.ColumnsHtml is not null)
                        for (var i = 0; i < b.ColumnsHtml.Count; i++) b.ColumnsHtml[i] = Replace(b.ColumnsHtml[i], row)!;
                    if (b.Rows is not null)
                        foreach (var r in b.Rows)
                            for (var i = 0; i < r.Count; i++) r[i] = Replace(r[i], row)!;
                }
                foreach (var ov in copy.Overlays) ov.Text = Replace(ov.Text, row);
                result.Pages.Add(copy);
            }
        }
        return result;
    }

    private static string? Replace(string? s, Dictionary<string, string> row)
    {
        if (string.IsNullOrEmpty(s)) return s;
        return TokenRegex().Replace(s, m =>
            row.TryGetValue(m.Groups[1].Value, out var v) ? System.Net.WebUtility.HtmlEncode(v) : m.Value);
    }
}
