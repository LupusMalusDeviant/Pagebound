using System.Globalization;
using System.Text;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Export;

/// <summary>
/// Default-Implementierung des Markdown-Exports. Liest Annotationen über
/// <see cref="IAnnotationService"/>, sortiert nach Seitenzahl und innerhalb
/// einer Seite nach Y-Position (Highlights nach ihrer ersten Rect-Y, Sticky
/// Notes nach ihrer Pin-Y), und produziert eine Obsidian-kompatible Datei
/// mit YAML-Frontmatter und Pro-Seite-Sektionen.
/// Erfüllt FA-080, FA-081, FA-082.
/// </summary>
public sealed class MarkdownExporter : IMarkdownExporter
{
    private readonly IAnnotationService _annotations;

    public MarkdownExporter(IAnnotationService annotations)
    {
        _annotations = annotations ?? throw new ArgumentNullException(nameof(annotations));
    }

    public async Task<string> ExportAsync(
        PdfId pdfId,
        MarkdownExportOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(options);

        var all = await _annotations.GetForDocumentAsync(pdfId, cancellationToken).ConfigureAwait(false);

        var filtered = all.Where(a =>
            (options.IncludeHighlights && a.Type == AnnotationType.Highlight) ||
            (options.IncludeNotes && a.Type == AnnotationType.StickyNote) ||
            (options.IncludeFreeTexts && a.Type == AnnotationType.FreeText));

        var grouped = filtered
            .GroupBy(a => a.PageNumber)
            .OrderBy(g => g.Key)
            .ToList();

        var sb = new StringBuilder(capacity: 1024);

        if (options.IncludeYamlFrontmatter)
        {
            AppendFrontmatter(sb, pdfId, options, all.Count);
        }

        var title = string.IsNullOrWhiteSpace(options.Title)
            ? options.SourceFilename ?? pdfId.Value
            : options.Title!;
        sb.AppendLine($"# {EscapeInlineMarkdown(title)}");
        sb.AppendLine();

        if (grouped.Count == 0)
        {
            sb.AppendLine("_Diese PDF enthält keine Annotationen._");
            return sb.ToString();
        }

        foreach (var pageGroup in grouped)
        {
            sb.AppendLine($"## Seite {pageGroup.Key}");
            sb.AppendLine();

            var orderedItems = pageGroup
                .Select(a => new { Annotation = a, SortKey = OrderingY(a) })
                .OrderBy(x => x.SortKey)
                .ThenBy(x => x.Annotation.CreatedAt)
                .Select(x => x.Annotation);

            foreach (var annotation in orderedItems)
            {
                if (annotation.Type == AnnotationType.Highlight)
                {
                    AppendHighlight(sb, annotation, options);
                }
                else if (annotation.Type == AnnotationType.StickyNote)
                {
                    AppendStickyNote(sb, annotation, options);
                }
                else if (annotation.Type == AnnotationType.FreeText)
                {
                    AppendFreeText(sb, annotation, options);
                }
            }
        }

        return sb.ToString();
    }

    private static void AppendFrontmatter(
        StringBuilder sb,
        PdfId pdfId,
        MarkdownExportOptions options,
        int annotationCount)
    {
        sb.AppendLine("---");
        if (!string.IsNullOrWhiteSpace(options.Title))
        {
            sb.AppendLine($"title: \"{EscapeYamlString(options.Title!)}\"");
        }
        if (!string.IsNullOrWhiteSpace(options.SourceFilename))
        {
            if (options.UseWikilinks)
            {
                sb.AppendLine($"source: \"[[{EscapeYamlString(options.SourceFilename!)}]]\"");
            }
            else
            {
                sb.AppendLine($"source: \"{EscapeYamlString(options.SourceFilename!)}\"");
            }
        }
        sb.AppendLine($"pdfHash: \"{pdfId.Value}\"");
        if (options.PageCount.HasValue)
        {
            sb.AppendLine($"pages: {options.PageCount.Value}");
        }
        sb.AppendLine($"annotations: {annotationCount}");
        sb.AppendLine($"exportedAt: \"{DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)}\"");
        sb.AppendLine("exportedBy: \"Pagebound\"");
        sb.AppendLine("tags: []");
        sb.AppendLine("---");
        sb.AppendLine();
    }

    private static void AppendHighlight(StringBuilder sb, Annotation annotation, MarkdownExportOptions options)
    {
        var text = HighlightAnnotation.GetText(annotation);
        if (string.IsNullOrWhiteSpace(text)) return;

        foreach (var line in text.ReplaceLineEndings("\n").Split('\n'))
        {
            sb.AppendLine($"> {line}");
        }
        sb.AppendLine();
    }

    private static void AppendStickyNote(StringBuilder sb, Annotation annotation, MarkdownExportOptions options)
    {
        var content = StickyNoteAnnotation.GetContent(annotation);
        sb.AppendLine("**Notiz:**");
        sb.AppendLine();
        if (string.IsNullOrWhiteSpace(content))
        {
            sb.AppendLine("_(leere Notiz)_");
        }
        else
        {
            sb.AppendLine(content.TrimEnd());
        }
        sb.AppendLine();
    }

    private static void AppendFreeText(StringBuilder sb, Annotation annotation, MarkdownExportOptions options)
    {
        var text = FreeTextAnnotation.GetText(annotation);
        sb.AppendLine("**Text:**");
        sb.AppendLine();
        if (string.IsNullOrWhiteSpace(text))
        {
            sb.AppendLine("_(leerer Text)_");
        }
        else
        {
            // Freitext (inkl. Datum-Stempel) ist Klartext, KEIN Markdown — anders
            // als die Sticky Note. Als Blockquote mit escapten Zeilen ausgeben,
            // damit Sonderzeichen (#, *, [, …) nicht als Markdown interpretiert
            // werden (siehe EscapeFreeTextLine).
            foreach (var line in text.ReplaceLineEndings("\n").Split('\n'))
            {
                sb.AppendLine($"> {EscapeFreeTextLine(line)}");
            }
        }
        sb.AppendLine();
    }

    /// <summary>
    /// Y-Position auf der Seite (0..1) für die Sortierreihenfolge.
    /// Highlights nutzen die Y des ersten Rect, Sticky Notes ihre Pin-Y,
    /// Freitexte ihre Top-Left-Y.
    /// </summary>
    private static double OrderingY(Annotation annotation)
    {
        if (annotation.Type == AnnotationType.Highlight)
        {
            var rects = HighlightAnnotation.GetRects(annotation);
            return rects.Count > 0 ? rects[0].Y : 0;
        }
        if (annotation.Type == AnnotationType.StickyNote)
        {
            return StickyNoteAnnotation.GetY(annotation);
        }
        if (annotation.Type == AnnotationType.FreeText)
        {
            return FreeTextAnnotation.GetY(annotation);
        }
        return 0;
    }

    private static string EscapeYamlString(string value) => value.Replace("\"", "\\\"");

    private static string EscapeInlineMarkdown(string value)
    {
        // Minimaler Escape für Markdown-Sonderzeichen im Titel.
        return value.Replace("\\", "\\\\").Replace("#", "\\#");
    }

    /// <summary>
    /// Escaped eine Freitext-Zeile so, dass Markdown sie NICHT interpretiert
    /// (Freitext ist Klartext). Inline-aktive Sonderzeichen werden überall
    /// escaped; Listen-/Zitat-Marker (-, +) zusätzlich am Zeilenanfang. Bewusst
    /// pragmatisch (nicht jedes ASCII-Satzzeichen), damit Datums-/URL-Text
    /// lesbar bleibt (CommonMark: \x rendert x literal).
    /// </summary>
    private static string EscapeFreeTextLine(string line)
    {
        var sb = new StringBuilder(line.Length + 8);
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            var isInlineSpecial =
                ch is '\\' or '`' or '*' or '_' or '[' or ']' or '<' or '>' or '#' or '~' or '|';
            var isLeadingListMarker =
                (ch is '-' or '+') && line.AsSpan(0, i).IsWhiteSpace();
            if (isInlineSpecial || isLeadingListMarker)
            {
                sb.Append('\\');
            }
            sb.Append(ch);
        }
        return sb.ToString();
    }
}
