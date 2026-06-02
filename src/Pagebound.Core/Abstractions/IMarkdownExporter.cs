using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Exportiert Annotationen (Highlights, Sticky Notes) einer PDF in eine
/// Markdown-Datei mit YAML-Frontmatter — Obsidian-/Zettelkasten-kompatibel.
/// Erfüllt FA-080, FA-081, FA-082.
/// </summary>
public interface IMarkdownExporter
{
    Task<string> ExportAsync(
        PdfId pdfId,
        MarkdownExportOptions options,
        CancellationToken cancellationToken);
}

public sealed record MarkdownExportOptions(
    string? Title = null,
    string? SourceFilename = null,
    int? PageCount = null,
    bool IncludeHighlights = true,
    bool IncludeNotes = true,
    bool IncludeYamlFrontmatter = true,
    bool UseWikilinks = true,
    string? VaultRoot = null);
