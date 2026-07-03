# Split-View & Vergleich

## Zweck

Zwei PDFs nebeneinander betrachten und inhaltlich vergleichen. Die Split-View zeigt zwei unabhängige Reader-Instanzen (z. B. Vertragsversionen) im geteilten Layout; der Vergleichsmodus extrahiert den Text beider Dokumente und berechnet einen Text-Diff, dessen Ergebnis als strukturierte Diff-Ansicht dargestellt wird.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Reader/SplitViewPage.razor` | Seite mit zwei Reader-Panes nebeneinander (Split-Layout) |
| `src/Pagebound.Web/Features/Reader/ComparePage.razor` | Vergleichs-Seite: zwei PDFs wählen, Diff anstoßen, Ergebnis anzeigen |
| `src/Pagebound.Web/Features/Reader/PdfTextDiff.cs` | Diff-Logik: Vergleich der extrahierten Texte beider Dokumente |
| `src/Pagebound.Web/Features/Reader/PdfDiffResultView.razor` | Darstellung des Diff-Ergebnisses (Hinzugefügt/Entfernt/Geändert) |
| `src/Pagebound.Web/wwwroot/js/split-bridge.ts` | JS-Brücke für das Split-Layout (z. B. Splitter/Synchronisation) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader & Viewer** — beide Panes nutzen `ReaderPane.razor` bzw. den `IPdfRenderer` für Rendering und die Text-Extraktion (`ExtractTextAsync`) als Diff-Grundlage. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Storage & Persistenz** — Öffnen der beiden Dokumente aus Bibliothek/Dateisystem. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).

### Extern (Packages)
- `pdfjs-dist` — indirekt über den Renderer (Text-Extraktion je Seite)

## Öffentliche API / Interface

- `PdfTextDiff` (C#, `src/Pagebound.Web/Features/Reader/PdfTextDiff.cs`) — nimmt die Seitentexte zweier Dokumente und liefert ein Diff-Resultat, das `PdfDiffResultView.razor` rendert.
- `split-bridge.ts` — Layout-Funktionen für die geteilte Ansicht (Splitter-Handling).

Keine eigene Core-Abstraktion: Das Feature lebt in der Web-Schicht und komponiert bestehende Reader-Bausteine.

## Datenfluss / Call-Flow

1. **Split-View:** `SplitViewPage.razor` lädt zwei Dokumente in zwei unabhängige Reader-Panes; `split-bridge.ts` verwaltet das geteilte Layout.
2. **Vergleich:** `ComparePage.razor` → für beide PDFs Text je Seite via `IPdfRenderer.ExtractTextAsync` extrahieren → `PdfTextDiff` berechnet den Text-Diff → `PdfDiffResultView.razor` zeigt die Unterschiede an.

## Offene Fragen / TODOs

- Ob/wie Scroll-Synchronisation zwischen den beiden Panes umgesetzt ist, im Code verifizieren.
