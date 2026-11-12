# Vertrag: Anmerkungen als echte PDF-Annotationen (`/Annots`)

Status: **abgenommen 2026-11-12** · Bean `PDF-Tool-5kvq` ·
betrifft `IPdfManipulator`, `JsPdfLibManipulator`, `pdf-manipulator-bridge.ts`,
`pdfjs-bridge.ts`, `IPdfRenderer`, `ReaderPane.razor`, `mcp/src/index.ts`

Anlass: `docs/findings/WETTBEWERB-2026-11-12-vergleich.md`, Befund 1.

> **Nachtrag 1 (bei der Umsetzung, 2026-11-12).** Der Ursprungsstand sagt an
> einer Stelle „`AnnotItem` ist derselbe Typ wie `FlattenItem`" und an einer
> anderen „`/NM` wird aus der `AnnotationId` abgeleitet, `/M` aus `UpdatedAt`".
> Beides zugleich geht nicht, solange der Typ weder Id noch Zeitpunkt trägt.
> Aufgelöst wurde es zugunsten **beider** Absichten: `FlattenItem` bekommt die
> zwei optionalen Felder `id` und `modified`; es bleibt **ein** Typ und **eine**
> Projektion, das Einbrennen ignoriert die neuen Felder. Fehlt `modified`, wird
> **kein** `/M` geschrieben — ersatzweise die Systemuhr zu nehmen würde die
> Reproduzierbarkeit brechen.
>
> **Nachtrag 2 (MCP).** Das Paket unter `mcp/` ist ein eigenständiger Port und
> kann über die Paketgrenze nicht importieren (wie `encrypt.ts`, `pdfa.ts`,
> `pdfua.ts`). Es hatte bis dahin **gar keine** Anzeigeraum-Geometrie — ein
> Port allein der Annotationen hätte auf gedrehten Seiten bekannt falsch
> gelegen. Deshalb sind **zwei** Dateien portiert: `mcp/src/geometry.ts` und
> `mcp/src/annots.ts`, beide mit einem Kopf, der die Quelle nennt.
>
> **Nachtrag 3 (nach dem Codex-Review, 2026-11-12).** Fünfzehn Befunde, davon
> acht am Annotations-Motor. Vertragsrelevant sind drei:
>
> 1. **Das Ersetzen wird gezählt und gemeldet.** Der Vertrag sagte schon
>    „importierte Annotationen ersetzen die vorgefundenen (gleiche `/NM`)",
>    die erste Umsetzung hängte aber immer nur an. `WriteAnnotationsResult`
>    bekommt dafür ein drittes Feld **`replaced`**, und `pdf_annotations_write`
>    gibt es mit aus. Ohne diese Zahl bliebe für den Aufrufer ununterscheidbar,
>    ob zwölf Anmerkungen zwölf neue Objekte wurden oder zwölf alte ersetzt
>    haben.
> 2. **Text wird als `PDFHexString` geschrieben** (UTF-16BE mit BOM), gelesen
>    über `decodeText()`. `PDFString.of` maskiert weder Klammern noch
>    Backslashes und kann kein Unicode: `Grüße 😀 中` kam als `Grüße =\0 -`
>    zurück, und eine unbalancierte Klammer im Text zerlegte das
>    Annotationsobjekt.
> 3. **`/FreeText` bekommt `/Rotate`**, und sein Rechteck wird mit den echten
>    Helvetica-Maßen aus pdf-lib ausgemessen statt geschätzt (zehn `W` bei
>    16 pt brauchen 151 pt, die Schätzung gab 96 pt). Ohne das brach ein
>    Betrachter Text um, der im Reader waagerecht hineinpasste.
>
> Dazu eine Festlegung am Rand des Vertrags: **der Export lädt als Strom
> herunter, nicht als base64.** `pageboundShortcuts.downloadStream` nimmt eine
> `DotNetStreamReference`; `Convert.ToBase64String` hätte das ganze Dokument
> ein weiteres Mal als .NET-string im WASM-Heap liegen (ein Drittel Aufschlag
> durch base64, als UTF-16 nochmal doppelt — bei 100 MB Ausgabe rund 267 MB
> obendrauf). Das ist genau der base64-Round-Trip, den die Leitplanken dieses
> Projekts für grosse PDFs verbieten.
>
> Die übrigen fünf Motor-Befunde (Systemuhr im `/ModDate`, Zeitzone im `/M`,
> Notizmarke auf gedrehten Seiten, Ink-Teilverlust, `null` im MCP-Schema) sind
> Umsetzungsfehler gegen diesen Vertrag, keine Änderungen an ihm.
> `mcp/src/annots.ts` ist seither eine **buchstäbliche Kopie** von
> `pdf-annots.ts` — abweichend nur in Kopfzeile und Importpfad.

## Der Ist-Stand, belegt

**Pagebound schreibt keine Standard-Annotationen.** Eine Suche nach
`PDFName.of("Annot"|"Annots"|"Highlight"|"Ink"|"Square"|"FreeText"|"Text")` in
`pdf-manipulator-bridge.ts` findet keinen Treffer. `flattenAnnotations`
(`:1398` ff.) *zeichnet* die Sidecar-Annotationen mit `drawRectangle`,
`drawLine`, `drawText` in den Seiteninhalt.

**Pagebound liest auch keine.** `pdfjs-bridge.ts` ruft nirgends
`getAnnotations()` oder `annotationStorage` auf. Was in einer fremden PDF
steckt, kommt trotzdem aufs Bild: `page.render` läuft mit dem PDF.js-Default
`annotationMode = ENABLE` (im ausgelieferten Bündel nachgesehen), der
Erscheinungsbilder in die Leinwand malt. Die Markierung eines Dritten ist also
**sichtbar, aber nicht greifbar** — Pagebound kennt sie nicht, kann sie nicht
anwählen, nicht ändern, nicht löschen und nicht exportieren.

**Was daraus folgt.** Wer in Pagebound markiert, hat heute zwei Wege: Sidecar
(sieht sonst niemand) oder Einbrennen (sieht jeder, keiner kann es rückgängig
machen, Pagebound selbst eingeschlossen).

## Was dieser Vertrag festlegt — und was nicht

Festgelegt wird **die Abbildung** zwischen dem Domänenmodell und den
PDF-Annotationstypen, sowie **drei Wege** statt der heutigen zwei. Nicht
festgelegt wird die Oberfläche: wie der Nutzer zwischen den Wegen wählt, ist
Sache der Umsetzung.

Das Sidecar bleibt der führende Speicher. `/Annots` ist ein **Ausgabeformat**
und eine **Einleseoption**, kein Ersatz.

## Die drei Wege aus dem Sidecar in eine Datei

| Weg | Was in der Datei landet | Rückweg |
|---|---|---|
| **Sidecar** (heute, Default) | nichts — die PDF bleibt byte-gleich | vollständig |
| **`/Annots`** (neu) | echte Annotationsobjekte | vollständig, auch in fremden Programmen |
| **Einbrennen** (heute) | Seiteninhalt, flache Grafik | keiner |

Einbrennen bleibt, unverändert, als ausdrückliche Wahl. Es ist der richtige Weg,
wenn eine Markierung *nicht* mehr entfernbar sein soll (Schwärzung grenzt daran).
Es ist nur nicht länger der einzige Weg, der die Datei verlässt.

## Abbildung: Domänentyp → PDF-Annotationstyp

Grundlage ist das vorhandene Modell in `src/Pagebound.Core/Domain/`. Alle
Domänenkoordinaten sind 0..1 mit Ursprung **oben links im Anzeigeraum**.

| `AnnotationType` | PDF-Subtyp | `/Rect` aus | Besonderheiten |
|---|---|---|---|
| `Highlight` | `/Highlight` | je Eintrag in `rects` ein eigenes `/Annots`-Objekt, oder ein Objekt mit `/QuadPoints` über alle | `/QuadPoints` ist Pflicht; `/C` aus `color`; `extractedText` nach `/Contents` |
| `Ink` | `/Ink` | umschließende Box aller `strokes` | `/InkList` = Array je Strich; `/BS /W` aus `strokeWidth × Seitenbreite` |
| `Shape` (`rectangle`) | `/Square` | Box aus Start/End | `/IC` fehlt (hohl), `/C` = Rahmenfarbe |
| `Shape` (`line`, `arrow`) | `/Line` | Box aus Start/End | `/L` = \[x1 y1 x2 y2\]; `arrow` zusätzlich `/LE [/None /ClosedArrow]` |
| `StickyNote` | `/Text` | Punkt `x,y`, feste Markergröße | `/Contents` = `contentMarkdown` **als Klartext** (siehe unten); `/Name /Comment` |
| `FreeText` | `/FreeText` | Box aus `x,y` + gemessenem Textmaß | `/DA` mit Helvetica, `fontSize × Seitenhöhe`; `/Contents` = Text |
| `Signature` | **bleibt beim Einbrennen** | — | siehe unten |

### Drei Festlegungen, die Entscheidungen sind

**1. `StickyNote` verliert sein Markdown.** `/Contents` ist Klartext; kein
Betrachter rendert dort Markdown. Beim Weg `/Annots` wird `stripMarkdown()`
angewandt — die Funktion gibt es bereits (`pdf-manipulator-bridge.ts:1372`).
Das Sidecar behält die Markdown-Fassung. Wer über `/Annots` exportiert und
wieder einliest, bekommt den Klartext zurück, nicht das Markdown. Das ist ein
Verlust und steht hier, damit es niemanden überrascht.

**2. `Signature` wandert nicht nach `/Annots`.** Eine Signatur ist in Pagebound
ein PNG plus ein Integritäts-Hash über PDF + Annotationsstand (ADR-006,
`SignatureAnnotation`). Als `/Stamp` abgelegt wäre sie ein Bild ohne
Beweiskraft, das wie eine Signatur aussieht. Das ist schlechter als heute.
Signaturen bleiben beim Einbrennen; die kryptografische Variante ist
`pdf_sign` (PAdES-B-B) und bleibt getrennt.

**3. Kein `/AP` von Hand.** Für jeden geschriebenen Typ wird das Erscheinungsbild
**nicht** selbst erzeugt; gesetzt werden nur die semantischen Einträge und
`/F 4` (Print). Betrachter erzeugen das Erscheinungsbild aus `/QuadPoints`,
`/InkList`, `/L` usw. selbst. Begründung: ein selbstgebautes `/AP` ist genau der
Fehler, den `sign-bridge.ts` schon einmal gekostet hat — eigener Kodierer, eigene
Prüfung, niemand sonst sieht den Fehler. Sollte sich in der Gegenprobe zeigen,
dass ein wichtiger Betrachter ohne `/AP` nichts zeichnet, wird **dieser Vertrag
geändert**, nicht die Implementierung still erweitert.

## Geometrie: die Falle und ihre Lösung

`/Annots` liegt im **ungedrehten Userspace** der Seite, nicht im Anzeigeraum.
Wer `ph - y × ph` rechnet, trifft nur bei `/Rotate 0` und einer CropBox ab
`(0,0)`.

Die Umrechnung existiert bereits und ist für Formular-Widgets im Einsatz:
`normRectToUser(page, rect)` in `page-geometry.ts:138`. Sie liefert das
Userspace-Rechteck **und** die Drehung. Dieser Vertrag legt fest: **`/Annots`
wird ausschließlich über `normRectToUser` platziert.** Kein zweiter
Umrechnungspfad, keine eigene Matrix, kein `beginDisplaySpace` (das ist der
Zeichenpfad und gilt nur fürs Einbrennen).

Für `/QuadPoints`, `/InkList` und `/L` werden **Punkte** gebraucht, nicht
Rechtecke. Dafür kommt eine Schwesterfunktion dazu:

```ts
/** Punkt im Anzeigeraum (0..1, Ursprung oben links) → Userspace-Punkt. */
export function normPointToUser(
  page: PDFPage,
  p: { x: number; y: number }
): { x: number; y: number };
```

Sie geht denselben Weg wie `normRectToUser` (Matrix aus `displayGeometry`), nur
ohne die umschließende Box. `normRectToUser` wird darauf zurückgeführt, damit es
**eine** Quelle der Geometrie gibt.

## Schnittstellen

### TypeScript (`pdf-manipulator-bridge.ts`)

```ts
/** Wie FlattenItem, aber geschrieben statt gezeichnet. Gleiche Felder, gleiche Einheiten. */
export type AnnotItem = FlattenItem;

/**
 * Schreibt Sidecar-Annotationen als echte /Annots in die PDF.
 * Signaturen (kind "signature") werden ÜBERSPRUNGEN und in `skipped` gemeldet.
 */
export async function writeAnnotations(
  pdfBytes: Uint8Array,
  items: AnnotItem[]
): Promise<{ bytes: Uint8Array; written: number; skipped: number }>;

/** Liest vorhandene /Annots einer PDF in das Sidecar-Format. */
export async function readAnnotations(
  pdfBytes: Uint8Array
): Promise<{ items: AnnotItem[]; unsupported: number }>;
```

`AnnotItem` ist bewusst **derselbe** Typ wie `FlattenItem`: dieselben Felder,
dieselben Einheiten, dieselbe Projektion aus den Domänentypen. Zwei parallele
Projektionen wären zwei Stellen, an denen die Koordinaten auseinanderlaufen.

`readAnnotations` liest über pdf-lib, nicht über PDF.js — die Schreibseite
braucht pdf-lib ohnehin, und `readAnnotations` muss `/QuadPoints` roh sehen, nicht
das von PDF.js aufbereitete Objekt.

### C# (`IPdfManipulator`)

```csharp
/// <summary>
/// Schreibt die Annotationen als echte PDF-Annotationen (/Annots) in die Datei.
/// Im Gegensatz zu <see cref="FlattenAnnotationsAsync"/> bleiben sie damit in
/// jedem Betrachter anwählbar, änderbar und löschbar.
/// Signaturen werden übersprungen (siehe docs/contracts/annotationen-als-pdf-annots.md).
/// </summary>
Task<AnnotationWriteResult> WriteAnnotationsAsync(
    Stream pdf,
    IReadOnlyList<Annotation> annotations,
    CancellationToken cancellationToken);

/// <summary>Liest vorhandene /Annots einer PDF als Domänen-Annotationen.</summary>
Task<AnnotationReadResult> ReadAnnotationsAsync(
    Stream pdf,
    PdfId pdfId,
    CancellationToken cancellationToken);
```

```csharp
public sealed record AnnotationWriteResult(byte[] Bytes, int Written, int Skipped);
public sealed record AnnotationReadResult(IReadOnlyList<NewAnnotation> Annotations, int Unsupported);
```

`Skipped` und `Unsupported` sind **nicht** kosmetisch: die Oberfläche muss sagen
können „3 von 12 Anmerkungen wurden nicht geschrieben", statt still zu schlucken.

### MCP

Zwei neue Werkzeuge, nach dem Muster der bestehenden 30:

| Werkzeug | Zweck |
|---|---|
| `pdf_annotations_read` | `/Annots` einer PDF als JSON |
| `pdf_annotations_write` | JSON-Annotationen als `/Annots` in eine PDF |

Beide erben die Zusagen des Pakets seit 2.0.0: **gleiche Eingabe → byte-gleiche
Ausgabe**, keine Systemuhr, keine Zufalls-IDs, stabile `code`-Fehlerkennungen.
Das hat eine harte Folge für die Umsetzung: `/M` (Änderungsdatum) und `/NM`
(Name) dürfen **nicht** aus der Uhr oder einem Zufallsgenerator kommen. `/NM`
wird aus der `AnnotationId` abgeleitet, `/M` aus `UpdatedAt` der Annotation.

## Beim Öffnen einer fremden PDF

Vorgefundene `/Annots` werden **nicht automatisch** ins Sidecar übernommen.
Grund: das Sidecar ist der führende Speicher, und ein stiller Import würde beim
nächsten Speichern Annotationen verdoppeln (einmal vorgefunden, einmal neu
geschrieben). Stattdessen: Pagebound meldet, dass die Datei *n* Annotationen
enthält, und der Import ist eine ausdrückliche Handlung.

Was dabei mit den vorgefundenen Objekten geschieht, wenn später über `/Annots`
gespeichert wird, legt dieser Vertrag so fest: **importierte Annotationen
ersetzen die vorgefundenen** (gleiche `/NM`), nicht importierte bleiben
unangetastet stehen.

## Gegenprobe — ohne sie gilt der Vertrag als nicht erfüllt

Die gelernte Regel des Projekts lautet: prüfe mit einem Signal, das den Fehler
auch finden könnte. Der eigene Kodierer ist kein Nachweis für Formatkonformität.

1. **Fremder Betrachter, nicht der eigene.** Eine mit `writeAnnotations`
   erzeugte Datei wird in mindestens einem Programm geöffnet, das nicht
   Pagebound ist. Dort muss jede Markierung **anwählbar und löschbar** sein —
   nicht nur sichtbar. Sichtbar ist sie auch, wenn sie eingebrannt wurde; genau
   darum taugt „sieht richtig aus" hier nicht als Prüfung.
2. **Gedrehte und beschnittene Seite.** Der Test läuft auf einer Seite mit
   `/Rotate 90` **und** einer CropBox, die nicht bei `(0,0)` beginnt. Auf einer
   geraden A4-Seite ab `(0,0)` würde auch eine falsche Geometrie bestehen.
3. **Ein bekannt schlechter Eingang zuerst.** Der neue Leser
   (`readAnnotations`) wird erst an einer Datei mit kaputten `/QuadPoints`
   scheitern gelassen, bevor sein Erfolg auf einer guten Datei zählt.
4. **Round-Trip.** Sidecar → `/Annots` → `readAnnotations` → Sidecar muss
   dieselben Koordinaten zurückgeben (Toleranz: 0,5 pt), bei `StickyNote` mit
   dem unter Festlegung 1 benannten Markdown-Verlust.
5. **Reproduzierbarkeit.** Zweimal schreiben, `cmp` auf die Ausgaben: byte-gleich.

## Was dieser Vertrag nicht berührt

Die Datenschutzzusage: alles davon ist lokale Dateiarbeit, kein Netzaufruf,
`privacy-check.mjs` bleibt unberührt. Der Krypto-Layer und die
Interface-First-DI-Struktur ebenso — die neuen Methoden hängen an den
bestehenden `IXxx`-Schnittstellen.
