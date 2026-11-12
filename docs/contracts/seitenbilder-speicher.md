# Vertrag: Wie Seitenbilder in den Speicher kommen und wieder hinaus

Status: **Entwurf, wartet auf Abnahme** · Bean `PDF-Tool-s4fl` ·
betrifft `IPdfRenderer`, `PdfJsRenderer`, `pdfjs-bridge.ts`, `ReaderPane.razor`

Anlass: `docs/findings/WETTBEWERB-2026-11-12-vergleich.md`, Befund 2.
Qualitätspriorität Nummer eins des Projekts (`CLAUDE.md`: WASM-OOM zuerst).

## Der Ist-Stand, belegt — und er ist schärfer als die Warnung

`CLAUDE.md` nennt „base64-Round-Trips, keine Virtualisierung". Der Code zeigt
mehr. Für **eine** Seite in der fortlaufenden Ansicht:

| Schritt | Wo | Was entsteht |
|---|---|---|
| 1 | `pdfjs-bridge.ts:126` | `canvas.toDataURL("image/png")` → base64-String im JS-Heap |
| 2 | Interop | derselbe String als .NET-`string` im WASM-Heap — **UTF-16, zwei Byte je Zeichen** |
| 3 | `PdfJsRenderer.cs:71` | `Convert.FromBase64String` → `byte[]` |
| 4 | `ReaderPane.razor:2910` | `Convert.ToBase64String(...)` → **wieder** ein base64-String |
| 5 | `_continuousPages` (`:1747`) | der String bleibt liegen |
| 6 | DOM | `<img src="data:…">`, der Browser dekodiert zu Pixeln |

Rechnung je Seite, bezogen auf die PNG-Rohgröße *n*: Schritt 1 ≈ 1,33 n,
Schritt 2 ≈ 2,67 n, Schritt 3 = n, Schritt 4/5 ≈ 2,67 n dauerhaft, dazu die
dekodierte Bitmap (bei A4 mit Scale 1.5 rund 1190 × 1684 × 4 B ≈ 8 MB,
unabhängig von *n*). Die Schritte 1–3 sind kurzlebig, Schritt 4/5 nicht.

**Und es läuft über alle Seiten.** `ReaderPane.razor:2898`–`2914`:
`for (var p = 1; p <= _handle.PageCount; p++)` — kein Fenster, keine
Obergrenze, keine Verdrängung. Geleert wird erst beim Dateiwechsel (`:1912`,
`:2159`).

**Dasselbe Muster bei den Vorschaubildern.** `_thumbnails` (`:1484`,
befüllt `:2421`) ist ebenfalls ein unbegrenztes `Dictionary<int, string>` mit
base64-Daten-URLs, geleert erst beim Dateiwechsel (`:2185`).

## Was dieser Vertrag festlegt

Zwei Dinge, getrennt, weil sie unabhängig wirken:

- **A — der Transportweg:** wie ein Seitenbild von PDF.js zur Anzeige kommt.
- **B — die Haltedauer:** wie viele Seitenbilder gleichzeitig existieren dürfen.

A allein senkt die Spitze, B allein senkt den Dauerbedarf. Beide sind nötig.

## A — Der Transportweg: das Raster bleibt in JS

Heute reist das Raster durch den WASM-Heap, obwohl es dort niemand braucht: das
Ziel ist ein `<img src>` im DOM, also wieder JS. Der Umweg kostet die Schritte
2 bis 4 oben.

**Festlegung: für die Anzeige verlässt das Raster JavaScript nicht.** Die Brücke
erzeugt eine Blob-URL und gibt nur die URL zurück.

```ts
/**
 * Rendert eine Seite in eine Blob-URL. Das Raster verlässt JS nicht; C#
 * bekommt nur die URL. Die URL MUSS über releasePageImage widerrufen werden,
 * sonst bleibt der Blob am Dokument hängen.
 */
export async function renderPageToUrl(
  handleId: string,
  pageNumber: number,
  scale: number
): Promise<PageImageResult>;   // { url, pageNumber, widthPx, heightPx, pageWidthPt, pageHeightPt }

/** Widerruft eine Blob-URL (URL.revokeObjectURL) und vergisst sie. */
export function releasePageImage(url: string): void;

/** Widerruft alle noch offenen URLs eines Handles (Dateiwechsel, Entladen). */
export function releaseAllPageImages(handleId: string): void;
```

Auf der C#-Seite kommt dazu:

```csharp
/// <summary>
/// Rendert eine Seite als Bild-URL für die Anzeige. Das Raster bleibt in
/// JavaScript — es landet NICHT im WASM-Heap. Die URL muss über
/// <see cref="ReleasePageImageAsync"/> freigegeben werden.
/// Für Aufrufer, die die Bytes wirklich brauchen (Export, Schwärzung,
/// Weitergabe an pdf-lib), bleibt RenderPageAsync der richtige Weg.
/// </summary>
Task<PageImage> RenderPageToUrlAsync(
    PdfDocumentHandle handle,
    int pageNumber,
    RenderOptions options,
    CancellationToken cancellationToken);

Task ReleasePageImageAsync(PageImage image);
```

```csharp
public sealed record PageImage(
    int PageNumber, string Url, int WidthPx, int HeightPx,
    double PageWidthPt, double PageHeightPt);
```

**`RenderPageAsync` bleibt unverändert.** Es hat echte Aufrufer, die die Bytes
brauchen — Schwärzung (`:2945`), Audit (`:2990`), Export. Die neue Methode tritt
daneben, sie ersetzt nichts. Wer Bytes will, holt Bytes; wer ein Bild zeigen
will, holt eine URL.

**Die Falle, die das hier erzeugt.** Eine Blob-URL ist eine Ressource, kein
String. Wird sie nicht widerrufen, bleibt der Blob liegen — das ist dieselbe
Leitplanke wie `loadingTask.destroy()` und das Beenden der Tesseract-Worker.
Deshalb: jede Stelle, die eine `PageImage` vergisst, ruft vorher
`ReleasePageImageAsync`. Beim Dateiwechsel und beim Entladen räumt
`releaseAllPageImages(handleId)` hinterher, damit ein vergessener Pfad die
Sitzung nicht leckt.

## B — Die Haltedauer: ein Fenster, keine Sammlung

**Festlegung: in der fortlaufenden Ansicht existieren höchstens so viele
Seitenbilder, wie das Fenster breit ist.** Das Fenster ist die sichtbare Seite
plus ein Puffer in beide Richtungen.

| Größe | Wert | Warum |
|---|---|---|
| Puffer fortlaufende Ansicht | **2 Seiten** je Richtung (Fenster also ≤ 5) | genug, um Scrollen ohne Lücke zu überbrücken |
| Puffer Vorschaubilder | **10 Einträge** je Richtung | Vorschaubilder sind klein, der Streifen zeigt mehr auf einmal |

Die Zahlen stehen hier, damit sie abgenommen und nicht beiläufig geändert
werden. Sie sind Startwerte; eine Änderung ist eine Vertragsänderung.

**Was außerhalb des Fensters liegt, wird freigegeben** — URL widerrufen, Eintrag
aus dem Verzeichnis entfernen. Das Platzhalterelement der Seite bleibt mit
seiner bekannten Größe stehen (aus `pageWidthPt`/`pageHeightPt`), damit die
Bildlaufposition beim Verdrängen nicht springt. Das ist die eigentliche
Schwierigkeit: ein Fenster, das die Höhe nicht reserviert, lässt die Seite unter
dem Finger wegrutschen.

**Welche Seite sichtbar ist, entscheidet der Browser, nicht eine Schätzung.**
Ein `IntersectionObserver` auf den Platzhaltern meldet nach C#, welche Seiten im
Blick sind; daraus ergibt sich das Fenster. Keine Scroll-Rechnerei in C#, keine
Annahme über Seitenhöhen.

**Das Rendern bleibt abbrechbar.** Das Vorhandene (`_thumbnailsCts`) ist das
Vorbild: scrollt der Nutzer weiter, während ein Rendern läuft, wird der Auftrag
abgebrochen, statt ein Bild fertigzustellen, das niemand mehr sieht.

## Was ausdrücklich nicht Teil dieses Vertrags ist

- **Die Einzelseitenansicht.** `_rasterDataUrl` (`:2453`) hält genau ein Bild;
  es profitiert von A, braucht B nicht.
- **Die Hi-Res-Ansicht** (`:2319`) und alle Bytes-Pfade (Schwärzung, Audit,
  Export, Signatur) bleiben, wie sie sind.
- **Eine Obergrenze für die Dateigröße.** Die liegt bei 100 MB im
  `offer()`-Pfad (`docs/contracts/datei-eintritt.md`) und wird hier nicht
  angefasst.

## Gegenprobe — ohne Zahlen gilt es als nicht erledigt

Die Regel des Projekts: prüfe mit einem Signal, das den Fehler auch finden
könnte. Ein Bildschirmfoto der fortlaufenden Ansicht findet einen Speicherfehler
strukturell nicht.

1. **Vorher messen, nachher messen, beides nennen.** `performance.memory`
   bzw. `measureUserAgentSpecificMemory()` vor dem Einschalten der
   fortlaufenden Ansicht und nach dem Durchscrollen, an **demselben** PDF.
2. **Das Dokument muss groß genug sein, den Fehler zu zeigen.** Mindestens 200
   Seiten. Bei 10 Seiten besteht auch die heutige Fassung.
3. **Die Zahl, die zählt, ist die nach dem Scrollen** — nicht die direkt nach
   dem Einschalten. Der heutige Fehler ist, dass nichts wieder freigegeben wird;
   ein zu kurzes Messfenster sieht ihn nicht.
4. **Nachweis, dass tatsächlich verdrängt wird:** die Zahl der Einträge im
   Seitenverzeichnis nach dem Durchscrollen eines 200-Seiten-PDFs muss ≤ 5
   sein, nicht 200.
5. **Kein Sprung beim Verdrängen.** Nach dem Zurückscrollen über eine
   freigegebene Seite muss die Bildlaufposition dieselbe Seite zeigen wie vorher.
6. **Keine lecken Blobs:** nach dem Dateiwechsel darf keine widerrufene URL mehr
   offen sein (Zähler in der Brücke, in einer `tests-js`-Prüfung abgefragt).

## Was dieser Vertrag nicht berührt

Die Datenschutzzusage: Blob-URLs sind lokal, kein Netzaufruf, `connect-src
'self'` bleibt gültig und `privacy-check.mjs` unberührt. Die
Interface-First-DI-Struktur bleibt: die neuen Methoden hängen an `IPdfRenderer`,
die Umsetzung bleibt in `PdfJsRenderer`.
