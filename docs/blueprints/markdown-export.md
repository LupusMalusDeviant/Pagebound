# Markdown-Export

## Zweck

Exportiert die Annotationen einer PDF (Highlights und Sticky Notes) als Markdown-Datei mit YAML-Frontmatter — kompatibel zu Obsidian/Zettelkasten-Workflows inkl. optionaler Wikilinks (FA-080, FA-081, FA-082). Damit wandern Lese-Erkenntnisse ohne Medienbruch in die persönliche Wissensbasis des Nutzers.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IMarkdownExporter.cs` | Interface + `MarkdownExportOptions` |
| `src/Pagebound.Infrastructure/Export/MarkdownExporter.cs` | Implementierung: Frontmatter, Gruppierung, Wikilink-Rendering |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Annotationen** — Quelle der zu exportierenden Highlights und Sticky Notes (`IAnnotationService`). Siehe [`./annotationen.md`](./annotationen.md).
- **Library & Workspace** — liefert Metadaten (Titel, Dateiname, Hash) für das YAML-Frontmatter. Siehe [`./library-workspace.md`](./library-workspace.md).
- **Lokalisierung, Theme & UI-Shell** — UI-Texte des Export-Dialogs via `L.T()`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).

### Extern (Packages)

- Keine — reine String-Erzeugung in C#.

## Öffentliche API / Interface

```csharp
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
```

## Datenfluss / Call-Flow

1. Nutzer stößt den Export im Reader an; die UI befüllt `MarkdownExportOptions` (Titel, Frontmatter ja/nein, Wikilinks ja/nein, Vault-Root).
2. `MarkdownExporter.ExportAsync` lädt die Annotationen der PDF über den Annotation-Service.
3. Erzeugung des Markdown-Strings: YAML-Frontmatter (Titel, Quelldatei, Seitenzahl) → Highlights und Notizen, nach Seiten gruppiert; bei `UseWikilinks` werden Verweise im `[[...]]`-Format gerendert.
4. Der fertige String wird im Browser als `.md`-Datei zum Download angeboten.

## Offene Fragen / TODOs

- **FreeText-Annotationen (neues Text/Datum-Werkzeug) werden aktuell NICHT exportiert** — der Exporter kennt nur Highlights und Sticky Notes. Entscheidung nötig: als eigener Abschnitt aufnehmen oder bewusst auslassen.
