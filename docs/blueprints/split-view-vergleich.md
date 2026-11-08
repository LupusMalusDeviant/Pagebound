# Split-View & Vergleich

## Zweck

Zwei PDFs nebeneinander betrachten und inhaltlich vergleichen. Die geteilte Ansicht zeigt zwei unabhängige Reader-Instanzen — etwa zwei Vertragsfassungen — mit auf Wunsch gekoppeltem Scrollen; der Vergleichsmodus extrahiert den Text beider Dokumente und zeigt einen Text-Unterschied. Das ist der Grund, warum die Reader-Logik in `ReaderPane` und nicht in `ReaderPage` liegt: sie muss zweimal nebeneinander laufen, jede mit eigenem Zustand.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Reader/SplitViewPage.razor` | Seite `/split` (`:1`): zwei Reader-Flächen nebeneinander |
| `src/Pagebound.Web/Features/Reader/ComparePage.razor` | Seite `/compare` (`:1`): zwei PDFs wählen, Vergleich anstoßen, Ergebnis zeigen |
| `src/Pagebound.Web/Features/Reader/PdfTextDiff.cs` | Die Vergleichslogik über die extrahierten Texte |
| `src/Pagebound.Web/Features/Reader/PdfDiffResultView.razor` | Darstellung: hinzugefügt, entfernt, geändert |
| `src/Pagebound.Web/wwwroot/js/split-bridge.ts` | Teiler aufsetzen (`:30`) und abbauen (`:73`), gekoppeltes Scrollen schalten (`:91`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `src/Pagebound.Web/Features/Reader/ComparePage.razor:3`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).

Das ist die **einzige** ausgehende Kante im geprüften Graph — und das überrascht, weil das Feature offensichtlich den Reader benutzt. Der Grund: `SplitViewPage` und `ComparePage` komponieren `ReaderPane` als Razor-Komponente und greifen nicht auf dessen Typen oder Dienste zu. Die Kopplung läuft über die Komponentengrenze, die das Skript nicht als Symbolkante sieht. Für eine Änderungsverfolgung heißt das: wer `ReaderPane` ändert, muss diese beiden Seiten **mitprüfen**, obwohl keine Kante dorthin zeigt. Siehe [`./pdf-reader.md`](./pdf-reader.md).

### Extern (Packages)

- `pdfjs-dist` (mittelbar über den Renderer) — Text je Seite als Grundlage des Vergleichs

## Öffentliche API / Interface

Keine Core-Abstraktion. Das Feature lebt in der Web-Schicht und setzt vorhandene Bausteine zusammen.

```ts
// split-bridge.ts
export function initResize(...): void;      // :30  Teiler zwischen den Flächen
export function teardownResize(): void;     // :73
export function setSyncScroll(left: HTMLElement, right: HTMLElement, enabled: boolean): void; // :91
```

`setSyncScroll` baut die vorherige Verdrahtung **immer zuerst ab**, bevor es neu verdrahtet (`split-bridge.ts:96` ff.) — sonst würden sich beim Ein- und Ausschalten Listener stapeln und das Scrollen würde mit jedem Umschalten ruckeliger.

`PdfTextDiff` (`src/Pagebound.Web/Features/Reader/PdfTextDiff.cs`) nimmt die Seitentexte zweier Dokumente und liefert ein Ergebnis, das `PdfDiffResultView.razor` darstellt.

## Datenfluss / Call-Flow

1. **Geteilte Ansicht:** `SplitViewPage.razor` lädt zwei Dokumente in zwei unabhängige `ReaderPane`-Instanzen; `initResize` (`split-bridge.ts:30`) verwaltet den Teiler, `setSyncScroll` (`:91`) koppelt das Scrollen, wenn der Nutzer es einschaltet.
2. **Vergleich:** `ComparePage.razor` extrahiert für beide PDFs den Text je Seite über `IPdfRenderer.ExtractTextAsync` → `PdfTextDiff` rechnet den Unterschied → `PdfDiffResultView.razor` zeigt ihn.

## Offene Fragen / TODOs

- Der Vergleich arbeitet auf dem **extrahierbaren** Text. Zwei Scans ohne Textlayer ergeben zwei leere Texte und damit „kein Unterschied" — eine Aussage, die falsch wirkt, obwohl sie stimmt. Ein Hinweis darauf in der Oberfläche ist nicht belegt.
- Zwei Reader-Flächen bedeuten zwei PDF.js-Ladevorgänge gleichzeitig. Ohne Virtualisierung ist das der Fall mit dem höchsten Speicherbedarf der ganzen App.
- Die fehlende Symbolkante zum Reader (siehe oben) ist eine Lücke der Werkzeugkette, kein Befund am Code — sie steht hier, damit niemand aus „keine Kante" auf „unberührt" schließt.
