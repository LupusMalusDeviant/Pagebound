# Split-View & Vergleich

## Zweck

Zwei PDFs nebeneinander betrachten und inhaltlich vergleichen. Die geteilte Ansicht zeigt zwei unabhängige Reader-Instanzen, etwa zwei Vertragsfassungen, mit auf Wunsch gekoppeltem Scrollen; der „Vergleichen"-Knopf extrahiert den Text beider Dokumente und zeigt einen Text-Unterschied. Das ist der Grund, warum die Reader-Logik in `ReaderPane` und nicht in `ReaderPage` liegt: sie muss zweimal nebeneinander laufen, jede mit eigenem Zustand.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Reader/SplitViewPage.razor` | Seite `/split` (`:1`): zwei Reader-Flächen, Teiler, gekoppeltes Scrollen, Vergleich |
| `src/Pagebound.Web/Features/Reader/ComparePage.razor` | Seite `/compare` (`:1`): nur noch eine Weiterleitung auf `split?compare=1` (`:17`) |
| `src/Pagebound.Web/Features/Reader/PdfTextDiff.cs` | Die Vergleichslogik über die extrahierten Texte |
| `src/Pagebound.Web/Features/Reader/PdfDiffResultView.razor` | Darstellung: hinzugefügt, entfernt, geändert |
| `src/Pagebound.Web/wwwroot/js/split-bridge.ts` | Teiler aufsetzen (`:30`) und abbauen (`:73`), gekoppeltes Scrollen schalten (`:91`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte, `src/Pagebound.Web/Features/Reader/ComparePage.razor:3`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).

Das ist die **einzige** ausgehende Kante im geprüften Graph, und das überrascht, weil das Feature offensichtlich den Reader benutzt. Der Grund: `SplitViewPage` komponiert `ReaderPane` als Razor-Komponente und greift nicht auf dessen Typen oder Dienste zu. Die Kopplung läuft über die Komponentengrenze, die das Skript nicht als Symbolkante sieht. Für eine Änderungsverfolgung heißt das: wer `ReaderPane` ändert, muss diese Seite **mitprüfen**, obwohl keine Kante dorthin zeigt. Siehe [`./pdf-reader.md`](./pdf-reader.md).

Dasselbe gilt für das Telefon-Layout: die Regeln dafür stehen in `src/Pagebound.Web/wwwroot/css/app.src.css`, das zu [App-Shell & Start](./app-shell.md) gehört. Eine Kante gibt es auch dorthin nicht.

### Extern (Packages)

- `pdfjs-dist` (mittelbar über den Renderer), Text je Seite als Grundlage des Vergleichs

## Öffentliche API / Interface

Keine Core-Abstraktion. Das Feature lebt in der Web-Schicht und setzt vorhandene Bausteine zusammen.

```ts
// split-bridge.ts
export function initResize(...): void;      // :30  Teiler zwischen den Flächen
export function teardownResize(): void;     // :73
export function setSyncScroll(left: HTMLElement, right: HTMLElement, enabled: boolean): void; // :91
```

`setSyncScroll` baut die vorherige Verdrahtung **immer zuerst ab**, bevor es neu verdrahtet (`split-bridge.ts:96` ff.), sonst würden sich beim Ein- und Ausschalten Listener stapeln und das Scrollen würde mit jedem Umschalten ruckeliger.

`PdfTextDiff.RunAsync` (`src/Pagebound.Web/Features/Reader/PdfTextDiff.cs`) nimmt die Bytes zweier Dokumente und liefert ein Ergebnis, das `PdfDiffResultView.razor` darstellt.

## Datenfluss / Call-Flow

1. **Geteilte Ansicht:** `SplitViewPage.razor` hält zwei unabhängige `ReaderPane`-Instanzen (`_leftReader`, `_rightReader`); `initResize` (`split-bridge.ts:30`) verwaltet den Teiler, `setSyncScroll` (`:91`) koppelt das Scrollen, wenn der Nutzer es einschaltet.
2. **Vergleich:** Der Knopf „Vergleichen" ruft `CompareAsync`, das die Bytes beider Panes (`ReaderPane.LoadedPdfBytes`) an `PdfTextDiff.RunAsync` gibt; das Ergebnis zeigt `PdfDiffResultView.razor` in einem Overlay. Fehlt in einer Pane ein Dokument, setzt `CompareAsync` stattdessen die Meldung `split.compare.needBoth`.
3. **Vergleichsmodus über die Route:** `/compare` leitet auf `split?compare=1` um (`ComparePage.razor:17`). Der Parameter blendet eine Anleitung ein und startet `AutoCompareWhenBothLoadedAsync`, das im Halbsekundentakt bis zu etwa fünf Minuten prüft, ob beide Panes geladen haben, und dann einmalig den Vergleich auslöst.

## Verhalten auf schmalen Schirmen

Unter 860 px steht nur **eine** Pane im Bild; der Umschalter „PDF A | PDF B" im Kopf wählt sie (`SplitViewPage.razor`, Zustand `_narrowPaneB`, Wurzelklasse `pb-show-b`). Beide Panes bleiben dabei im DOM, nur eine ist sichtbar, damit Dokument, Seite, Zoom und Annotationen beim Umschalten erhalten bleiben. Teiler und gekoppeltes Scrollen sind dort ausgeblendet, weil beide zwei sichtbare Panes voraussetzen. Die Regeln stehen in `app.src.css` unter `@media (max-width: 860px)`; dieselbe Grenze schaltet den Umschalter sichtbar, damit es keine Breite gibt, in der die zweite Pane weg und der Umschalter noch nicht da ist.

Die Breiten des Teilers setzt `split-bridge.ts` als Inline-Stil am linken Pane (`flex-basis`, `flex-grow`, `flex-shrink`, `:51` ff.). Dieser Stil überlebt das Verkleinern des Fensters, deshalb trägt die Schmalschirm-Regel `!important`.

## Offene Fragen / TODOs

- Der Vergleich arbeitet auf dem **extrahierbaren** Text. Zwei Scans ohne Textlayer ergeben zwei leere Texte und damit „kein Unterschied", eine Aussage, die falsch wirkt, obwohl sie stimmt. Ein Hinweis darauf in der Oberfläche ist nicht belegt.
- Zwei Reader-Flächen bedeuten zwei PDF.js-Ladevorgänge gleichzeitig. Ohne Virtualisierung ist das der Fall mit dem höchsten Speicherbedarf der ganzen App. Auf dem Telefon ändert die Schmalschirm-Ansicht daran nichts: die zweite Pane ist versteckt, aber geladen.
- `AutoCompareWhenBothLoadedAsync` pollt, weil `ReaderPane` kein Lade-Ereignis anbietet (`SplitViewPage.razor`, Kommentar über der Methode). Ein Ereignis am Pane würde den Poll ersetzen.
- Die fehlende Symbolkante zum Reader (siehe oben) ist eine Lücke der Werkzeugkette, kein Befund am Code. Sie steht hier, damit niemand aus „keine Kante" auf „unberührt" schließt.
