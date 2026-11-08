# Markdown-Export

## Zweck

Die Annotationen einer PDF als Markdown-Datei mit YAML-Frontmatter ausgeben — passend für Obsidian und ähnliche Wissensablagen, auf Wunsch mit Wikilinks. Damit wandern Leseergebnisse ohne Medienbruch in die persönliche Ablage des Nutzers, statt in der App zu bleiben.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IMarkdownExporter.cs` | Vertrag plus `MarkdownExportOptions` (`:10`) |
| `src/Pagebound.Infrastructure/Export/MarkdownExporter.cs` | Umsetzung: Frontmatter, Gruppierung nach Seiten, Wikilinks; nimmt `IAnnotationService` (`:20`), Einstieg `ExportAsync` (`:25`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Annotationen** (Typ, Laufzeit, via `IAnnotationService`, `AnnotationType`, `Annotation`, `HighlightAnnotation`, `StickyNoteAnnotation`): die Quelle der Ausgabe — `src/Pagebound.Infrastructure/Export/MarkdownExporter.cs:18`. Siehe [`./annotationen.md`](./annotationen.md).

Das ist die einzige ausgehende Kante. Titel, Dateiname und Seitenzahl kommen **nicht** über einen Dienst, sondern als `MarkdownExportOptions` vom Aufrufer — der Reader füllt sie aus den Metadaten, die er ohnehin hat. Deshalb hat dieses Feature keine Kante zu „Library & Workspace", obwohl die Werte von dort stammen.

### Extern (Packages)

- Keine. Reine Zeichenketten-Erzeugung in C#.

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IMarkdownExporter.cs:10
public interface IMarkdownExporter
{
    Task<string> ExportAsync(PdfId pdfId, MarkdownExportOptions options, CancellationToken ct);
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

Der Rückgabewert ist der fertige Markdown-Text, keine Datei. Das Schreiben bzw. der Download liegt beim Aufrufer — damit ist der Exporter rein und ohne Browser-Abhängigkeit prüfbar.

## Datenfluss / Call-Flow

1. Der Nutzer stößt den Export im Reader an; die Oberfläche füllt `MarkdownExportOptions` (Titel, Frontmatter ja/nein, Wikilinks ja/nein, Vault-Wurzel).
2. `MarkdownExporter.ExportAsync` (`:25`) holt die Annotationen des Dokuments über `IAnnotationService` (`:18`, `:20`).
3. Der Text entsteht: YAML-Frontmatter (Titel, Quelldatei, Seitenzahl), dann Markierungen und Notizen nach Seiten gruppiert; bei `UseWikilinks` als `[[…]]`.
4. Der Reader bietet die Zeichenkette als `.md` zum Download an.

## Offene Fragen / TODOs

- **Freitext-Annotationen werden nicht exportiert.** Der Exporter kennt nur Markierungen und Notizen (`MarkdownExporter.cs:18` nennt genau `HighlightAnnotation` und `StickyNoteAnnotation`). Ink und Formen haben keinen sinnvollen Textkörper, Freitext hätte einen — hier fehlt eine Entscheidung: eigener Abschnitt oder bewusst ausgelassen.
