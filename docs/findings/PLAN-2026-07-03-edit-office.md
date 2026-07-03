# Umsetzungsplan: PDF→Office-Export (DOCX) + Inline-PDF-Bearbeitung

**Datum:** 2026-07-03
**Scope:** Feature 1 (PDF→Office, Start DOCX) + Feature 2 (Inline-Text-Bearbeitung „Text bearbeiten").
**NICHT im Scope:** Feature 3 (PAdES/Zertifikatssignaturen) — bewusst ausgelassen (TSA-Zeitstempel/OCSP sind prinzipiell online).

Dieser Plan ist die Arbeitsgrundlage für den `/loop`: pro Iteration genau EIN Auftrag (E-xx),
in der Reihenfolge der Tabelle am Ende. Der Fortschritt wird in
`docs/findings/PROGRESS-edit-office.md` getrackt.

---

## Abschnitt 0 — Globale Regeln (hart, gelten für JEDEN Auftrag)

Identisch zum FINDINGS-Loop, plus zwei feature-spezifische Regeln:

1. **KEINE Telemetrie.** `ITelemetryService` bleibt `NoOpTelemetryService`. Keine Zähler/Events/Pings.
2. **KEIN Server / KEINE externen Requests.** Alles läuft 100 % lokal im Browser-WASM. Kein `fetch`
   zu fremden Origins, kein CDN, keine Analytics. Nur eigener Origin (Fonts/Assets aus `wwwroot`).
3. **KEINE neuen Laufzeit-Dependencies** (npm `dependencies` / NuGet), außer ein Auftrag nennt sie
   EXPLIZIT. DOCX/XLSX/PPTX werden **von Hand als OOXML (ZIP+XML) gebaut** — `fflate` (`zipSync`)
   ist bereits vorhanden. Kommt doch eine Dependency dazu, MUSS sie in
   `tools/privacy-check.mjs` → `ALLOWED_DEPENDENCIES` ergänzt werden (sonst schlägt CI fehl).
4. **i18n immer in BEIDEN Dateien:** `wwwroot/resources/de.json` UND `en.json`. Kein Text hart im
   Markup — alles über `L.T("…")`.
5. **`AnnotationType`-Enum niemals umsortieren** (Ordinalwerte sind im Sidecar persistiert).
   Neue Werte NUR anhängen — in diesem Plan aber vermeiden wir das komplett (siehe unten).
6. **Feature-Regel A — Ehrlichkeit statt Hype.** Beide Features haben prinzipielle Grenzen (kein
   Reflow, keine 1:1-Layout-Treue). Diese Grenzen werden dem Nutzer in Hinweistexten (i18n) UND im
   Blueprint klar benannt. Keine „perfekt"-Versprechen.
7. **Feature-Regel B — Kein destruktiver Zugriff auf Original/Sidecar** aus den neuen Features
   heraus. Konvertierung und Inline-Edit erzeugen IMMER eine **neue Ausgabedatei** (Download) bzw.
   eine neue Annotation; Originaldatei + Sidecar bleiben unangetastet (wie der Redaction-Flow).

**Verifikation je Auftrag (Mindest-Gate):**
- `dotnet build Pagebound.slnx` grün (0 Errors).
- `dotnet test tests/Pagebound.Core.Tests` grün.
- Bei `wwwroot/js/*.ts`-Änderungen zusätzlich `npm run build:js` (im Ordner `src/Pagebound.Web`) — 0 Typecheck-Fehler.
- Bei neuen Tailwind-Klassen zusätzlich `npm run build:css`.
- `node tools/privacy-check.mjs` grün (keine externen Requests, keine unerlaubte Dependency).
- UI-Aufträge: Browser-Preview (`preview_start "pagebound-web"`; Test-PDF via IndexedDB
  `pdf:bytes:<sha256>` + `/reader?pdf=<sha256>` bzw. `/tools`).

**Commit-Stil:** deutsch, Conventional Commit mit Auftrags-ID, z. B.
`feat(convert): E-02 PDF→DOCX-OOXML-Builder (Textfluss, seitenweise)`. Ein Commit pro Auftrag, KEIN Push.

---

## Feature 1 — PDF → Office (DOCX zuerst)

### Architektur-Entscheidungen (begründet)

- **Anknüpfpunkt = bestehende Konvertierungs-Pipeline** (`IPdfConverter` → `JsPdfConverter` →
  `pageboundPdf.*`-Bridge → `ConversionResult`-Download). DOCX fügt sich als weiteres Zielformat
  exakt in dieses Muster ein — kein neues Plumbing, gleicher Download-Pfad wie der PNG/JPG-ZIP
  (`byte[]`-Ergebnis).
- **OOXML von Hand** (keine `docx`-npm-Lib): `fflate.zipSync` ist da; ein minimal-gültiges .docx
  braucht nur 5 XML-Teile. Erfüllt „keine neue Dependency".
- **Qualitätsanspruch = Textfluss, nicht Layout-Treue.** PDF hat kein Absatz-/Struktur-Modell;
  aus `getTextContent`-Items werden Zeilen (Y-Cluster) → Absätze (vertikale Lücken) rekonstruiert.
  Ehrlicher Hinweis in UI + Blueprint. (Wer Pixel-Treue will, nutzt HTML/PNG-Export.)

---

### E-01 — `ConversionFormat.Docx` + Converter-Dispatch

- **Ziel:** DOCX als wählbares Zielformat im Domänen-Enum und im C#-Dispatch verankern.
- **IST:** `ConversionTypes.cs` Enum `{Png,Jpg,Text,Html,Csv}`; `JsPdfConverter.ConvertAsync`
  (`JsPdfConverter.cs:35`) `switch` ohne DOCX; PNG/JPG liefern `byte[]` (ZIP) via
  `InvokeAsync<byte[]>`, Text/HTML/CSV `string`.
- **SOLL:**
  1. `ConversionFormat.Docx` **am Ende** des Enums anhängen (nicht einsortieren).
  2. Neuer `case ConversionFormat.Docx:` in `JsPdfConverter`:
     `var bytes = await _js.InvokeAsync<byte[]>($"{Module}.convertToDocx", cancellationToken, pdf);`
     `return new ConversionResult(bytes, "docx",
     "application/vnd.openxmlformats-officedocument.wordprocessingml.document");`
- **NICHT:** keine XLSX/PPTX hier (eigene, optionale Aufträge). Kein Aufruf einer noch nicht
  existierenden Bridge-Funktion ohne E-02 (E-02 zuerst bauen ODER Bridge-Stub, der leeres gültiges
  .docx liefert — sauberer: E-02 vor E-01 in der Reihenfolge, siehe Tabelle).
- **Dateien:** `src/Pagebound.Core/Domain/ConversionTypes.cs`,
  `src/Pagebound.Infrastructure/Pdf/JsPdfConverter.cs`.
- **Akzeptanz:** Build grün; `case` vorhanden; MIME/Extension korrekt.

### E-02 — OOXML-Builder `convertToDocx` (pdfjs-bridge.ts)

- **Ziel:** Aus PDF-Text ein gültiges, in Word/LibreOffice öffenbares .docx bauen — 100 % lokal.
- **IST:** `pdfjs-bridge.ts` hat `readPageText(doc,page) → {items, pageText, viewportHeight}`
  (Z. 285), `buildPageText` (Wort-Spacing, Z. 238), Zeilen-/Zellen-Clustering in `pageItemsToCsv`
  (Y-Row-, X-Gap-Heuristik, Z. ~490–528), `zipSync` (Z. 13, 597/637), `withTransientDoc` (Z. 322).
- **SOLL:** Neue exportierte Funktion
  `export async function convertToDocx(data: Uint8Array): Promise<Uint8Array>`:
  1. `withTransientDoc` über alle Seiten; je Seite `page.getTextContent()`-Items in **Zeilen**
     clustern (Y-Toleranz wie `pageItemsToCsv`), Items je Zeile per X sortieren und mit der
     Spacing-Logik aus `buildPageText` zu Zeilentext fügen.
  2. Zeilen zu **Absätzen** gruppieren: vertikale Lücke > ~1.6× Zeilenhöhe ⇒ neuer Absatz.
  3. **Schriftgröße** je Absatz aus Median der Item-Höhen ableiten (PDF-pt → Word-Half-Points,
     `Math.round(pt*2)`, geklemmt 8…48 hp). Default 22 hp (11 pt), wenn nicht ermittelbar.
  4. **Seitenumbruch** zwischen PDF-Seiten (`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`).
  5. XML **escapen** (`& < > " '`). Nicht-XML-1.0-Steuerzeichen filtern.
  6. Minimal-.docx als `zipSync(files,{level:6})` mit:
     `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`,
     `word/_rels/document.xml.rels`. `document.xml` mit `<w:body>…<w:sectPr/></w:body>`.
- **NICHT:** kein Bild-/Tabellen-/Spalten-Reflow, keine Fonts einbetten, keine Farb-/Bold-Pflicht
  (Bold-Heuristik aus `fontName.includes("Bold")` optional als Stretch, nur wenn billig).
- **Dateien:** `src/Pagebound.Web/wwwroot/js/pdfjs-bridge.ts` (+ `npm run build:js`).
- **Akzeptanz:** In Word UND LibreOffice ohne Reparatur-Dialog öffenbar; Text lesbar, Absätze/
  Seitenumbrüche erkennbar; Umlaute korrekt (UTF-8). Manuell im Preview: Test-PDF → DOCX exportieren,
  Bytes prüfen (ZIP-Signatur `PK`, enthält `word/document.xml`).

### E-03 — UI-Option + i18n für DOCX

- **Ziel:** DOCX im Konvertieren-Dropdown auswählbar, mit ehrlichem Hinweis.
- **IST:** `PdfToolsPanel.razor:304–308` `<select @bind="_convertFormat">` mit 5 Optionen;
  Download-Pfad `HandleConvert` (Z. ~1228) nutzt `ConversionResult` generisch (funktioniert für
  `byte[]` bereits, wie ZIP).
- **SOLL:**
  1. `<option value="@ConversionFormat.Docx">@L.T("tools.convert.docx")</option>` ergänzen.
  2. i18n-Keys `tools.convert.docx` (Label „Word (DOCX)") in de + en.
  3. Hinweistext (`tools.convert.note` erweitern ODER neuen Key) klarstellen: DOCX = **Textfluss,
     keine 1:1-Layout-Treue**; für pixeltreu HTML/PNG nutzen.
- **NICHT:** kein neuer Button/Flow — nur eine Dropdown-Option; Download läuft über bestehende Logik.
- **Dateien:** `PdfToolsPanel.razor`, `de.json`, `en.json`.
- **Akzeptanz:** Option sichtbar; Klick „Konvertieren" lädt `<name>.docx` herunter; Hinweis sichtbar;
  beide Sprachen gepflegt.

### E-04 — Blueprint/Doku aktualisieren (DOCX)

- **Ziel:** `docs/blueprints/konvertierung.md` beschreibt DOCX ehrlich (Fähigkeit + Grenze).
- **SOLL:** `ConversionFormat`-Tabelle + Datenfluss um DOCX ergänzen; Satz zu „Textfluss statt
  Layout-Treue"; Hinweis „OOXML von Hand, keine neue Dependency".
- **Dateien:** `docs/blueprints/konvertierung.md` (+ ggf. `docs/blueprints/INDEX.md`).
- **Akzeptanz:** Doku stimmt mit Code überein.

### E-05 (OPTIONAL/Stretch) — XLSX-Export aus Tabellen-Heuristik

- **Ziel:** PDF→XLSX auf Basis der bestehenden CSV-Tabellen-Heuristik (`extractTablesCsv`/
  `pageItemsToCsv`).
- **SOLL:** `ConversionFormat.Xlsx` (anhängen) + `convertToXlsx` (OOXML SpreadsheetML: `xl/workbook.xml`,
  `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`, rels, Content-Types) aus den geclusterten
  Zellen. Eine Tabelle je Seite als Sheet ODER aneinandergehängt.
- **NICHT starten**, bevor E-01…E-04 grün sind. Nur wenn Zeit/Budget bleibt.
- **Akzeptanz:** In Excel/LibreOffice Calc öffenbar; Zellen entsprechen der CSV-Heuristik.

### E-06 (OPTIONAL/Stretch) — PPTX-Export (eine Folie je Seite als Bild)

- **Ziel:** PDF→PPTX, jede Seite als Vollbild-Grafik (nutzt `renderPageToCanvas`).
- **SOLL:** `ConversionFormat.Pptx` + `convertToPptx` (PresentationML: `ppt/presentation.xml`,
  je Folie `ppt/slides/slideN.xml` + `ppt/media/imageN.png`, rels, Content-Types).
- **NICHT starten**, bevor DOCX (E-01…E-04) steht. Reine Bild-Folien, kein Text-Layer.
- **Akzeptanz:** In PowerPoint/LibreOffice Impress öffenbar; je Seite eine Folie.

---

## Feature 2 — Inline-PDF-Bearbeitung („Text bearbeiten")

### Architektur-Entscheidungen (begründet)

- **Muster = Redaction-Flow spiegeln** (bewusst, minimal-invasiv). Redaction ist KEINE Annotation,
  sondern: transiente `_redactions`-Liste (`RedactionBox`) + Overlay-Preview (`RedactionsOnCurrentPage`)
  + „Anwenden"-Button → `Manipulator.RedactAsync` → **neue** `.redacted.pdf`, Original/Sidecar
  unberührt. Inline-Edit übernimmt genau diese Struktur ⇒ **kein neuer `AnnotationType`, keine
  Sidecar-Migration, keine MCP-Parität** nötig.
- **MVP = „Textblock übermalen & ersetzen"** (Cover + Redraw), KEIN Reflow, KEINE Content-Stream-
  Chirurgie. Grund: pdf-lib kann bestehende Content-Streams nicht editieren (nur append-Zeichnen);
  echtes In-Place-Editieren des Text-Operators ist mit dem Stack offline nicht leistbar.
- **Ehrlichkeits-Caveat (hart):** Beim reinen Übermalen bleiben die alten Zeichen im Content-Stream
  (weiterhin extrahierbar). Das wird im Hinweistext klar gesagt; für garantierte Entfernung
  verweisen wir auf das bestehende **Schwärzen**-Werkzeug (rastert die Zone → echte Entfernung).
  Optionaler Stretch E-15: „echte Entfernung" via Raster wie Redaction.

### E-10 — Bridge `applyTextEdits` (Cover + Redraw) in pdf-manipulator-bridge.ts

- **Ziel:** Kern-Operation: nimmt PDF-Bytes + Edit-Liste, übermalt alte Regionen mit Hintergrund-
  farbe und zeichnet neuen Text darüber, gibt neue Bytes.
- **IST:** `flattenAnnotations` (Z. 1397) zeichnet u. a. `kind:"text"` (Helvetica, WinAnsi-Fallback,
  Z. 1479–1521) und Rechtecke; `FlattenItem` (Z. 1337). Fonts via `embedFont(StandardFonts.Helvetica)`.
  `RedactAsync`/`redactPdf` existiert als Vorbild für „Region → neue Datei".
- **SOLL:** Neue exportierte Funktion
  `export async function applyTextEdits(pdfBytes: Uint8Array, edits: TextEditDto[]): Promise<Uint8Array>`
  mit `interface TextEditDto { pageNumber:number; x:number; y:number; w:number; h:number;
  text:string; fontSize:number; color?:string; bgColor?:string; }` (x/y/w/h als 0..1 oben-links,
  `fontSize` als Anteil Seitenhöhe wie Freitext).
  Pro Edit: (1) opakes Rechteck in `bgColor` (Default `#ffffff`), Blend `Normal`, kein Rahmen, über
  die alte BBox; (2) neuen Text (WinAnsi-Fallback wie im text-Zweig) an BBox-Top-Left zeichnen.
  `doc.setProducer("Pagebound Edit")`, `save({updateMetadata:false})`.
- **NICHT:** kein Raster, keine echte Entfernung (das ist E-15/Redaction), kein Reflow, keine
  Zeilenumbruch-Magie über die BBox hinaus (Text wird ab Top-Left gezeichnet, ggf. an `\n`).
- **Dateien:** `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` (+ `npm run build:js`).
- **Akzeptanz:** Unit-manuell: PDF + 1 Edit → neue Bytes öffnen; alte Stelle verdeckt, neuer Text
  sichtbar; PDF valide.

### E-11 — Infra-Methode `ApplyTextEditsAsync` (JsPdfLibManipulator)

- **Ziel:** C#-Brücke zur neuen Bridge-Funktion, analog `RedactAsync`.
- **IST:** `JsPdfLibManipulator.cs` hat `RedactAsync(Stream, IReadOnlyList<RedactionRegion>, ct)`.
- **SOLL:** DTO `TextEditRegion(int Page, double X, double Y, double Width, double Height,
  string Text, double FontSize, string? Color, string? BgColor)` (Core/Domain oder Abstractions,
  wo `RedactionRegion` liegt). Interface-Methode + Impl
  `Task<byte[]> ApplyTextEditsAsync(Stream pdf, IReadOnlyList<TextEditRegion> edits, ct)` →
  `InvokeAsync<byte[]>("pageboundPdfManipulator.applyTextEdits", …)`.
- **NICHT:** kein Zugriff auf Sidecar/Original-Persistenz.
- **Dateien:** passendes Interface (z. B. `IPdfManipulator`/wo `RedactAsync` deklariert ist),
  `JsPdfLibManipulator.cs`, DTO-Datei neben `RedactionRegion`.
- **Akzeptanz:** Build grün; Signatur spiegelt `RedactAsync`.

### E-12 — JS-Helper `findTextBlockAt` (pdfjs-bridge.ts)

- **Ziel:** Klick-Position (0..1) → nächstliegende Textzeile mit BBox + Text + Schriftgröße.
- **IST:** `extractText(handleId,page)` liefert Items mit x/y/w/h (Viewport-px, oben-links, Z. 297);
  Reader hat `handleId` des geladenen Docs; `pageboundShortcuts.clientPositionToFraction` liefert
  0..1-Position aus Client-Koordinaten.
- **SOLL:** `export async function findTextBlockAt(handleId:string, pageNumber:number, xFrac:number,
  yFrac:number): Promise<TextBlockDto|null>` mit
  `interface TextBlockDto { text:string; x:number; y:number; w:number; h:number; fontSize:number; }`
  (alles 0..1 bzw. fontSize als Anteil Seitenhöhe). Vorgehen: Items der Seite in Zeilen clustern
  (Y-Toleranz), die Zeile wählen, deren Y-Band den Klick enthält (sonst nächstliegende), BBox =
  Umschließende der Zeilen-Items, Text = zusammengefügte Zeile, fontSize = Median-Item-Höhe/Seiten-
  höhe. `null`, wenn keine Zeile nah genug (> ~2 Zeilenhöhen entfernt).
- **NICHT:** keine Mehrzeilen-/Absatz-Auswahl im MVP (genau EINE Zeile/ein Block).
- **Dateien:** `pdfjs-bridge.ts` (+ `npm run build:js`).
- **Akzeptanz:** Klick auf eine Textzeile liefert plausible BBox + korrekten Text im Preview
  (Konsolen-Log-Check).

### E-13 — Reader-Werkzeug „Text bearbeiten" (Modus + Toolbar + State)

- **Ziel:** Neuer Modus `AnnotationMode.EditText` mit Toolbar-Button und transientem Edit-State,
  strukturell wie Redaction.
- **IST:** `AnnotationMode`-Enum (`ReaderPane.razor:1507`); Redaction-Button (Z. 293), Redaction-
  State `_redactions`/`RedactionsOnCurrentPage` (Z. 1539–1545), Apply/Clear (Z. 2553/2590),
  `pb-toolbtn`-Styling.
- **SOLL:**
  1. `AnnotationMode.EditText` **anhängen**; `IsPlacementMode`/Cursor-Mapping ergänzen.
  2. Toolbar-Button „Text bearbeiten" (`pb-toolbtn`, aktiv=`is-on`), i18n `reader.edit.tool`/`.title`.
  3. Transienter State analog Redaction: `record TextEditBox(int Page, double X, double Y,
     double Width, double Height, string OldText, string NewText, double FontSize, string Color,
     string BgColor)` + `List<TextEditBox> _edits`; `EditsOnCurrentPage`; `bool _isApplyingEdits`.
  4. Aktions-Leiste (wenn Modus aktiv oder `_edits.Count>0`): „Anwenden" + „Verwerfen" + Zähler,
     i18n `reader.edit.apply/clear/count/running/hint`.
- **NICHT:** keine Sidecar-Persistenz der Edits (transient wie Redaction), kein neuer `AnnotationType`.
- **Dateien:** `ReaderPane.razor`, `de.json`, `en.json` (+ ggf. `build:css` für neue Klassen).
- **Akzeptanz:** Button sichtbar/umschaltbar; Aktionsleiste erscheint; Build + Preview grün.

### E-14 — Edit-Geste: Klick → Block finden → Editor → in Liste übernehmen (Overlay-Preview)

- **Ziel:** Der eigentliche Bearbeiten-Ablauf im Reader.
- **IST:** `HandlePdfClickAsync` (Z. 2825, Reentrancy-Guard) dispatcht je Modus;
  `FreeTextEditorPopover` existiert als wiederverwendbarer Text-Editor (Content/FontSize/Color,
  Save/Delete/Cancel); Overlay-Rendering pro Seite (wie `RedactionsOnCurrentPage`,
  Freitext-Overlay).
- **SOLL:**
  1. In `HandlePdfClickAsync` Zweig `EditText`: Klick→Fraction (`clientPositionToFraction`) →
     `findTextBlockAt(handleId, page, xFrac, yFrac)`. `null` ⇒ leerer Block an Klickposition
     (freies Einfügen). Sonst BBox/Text/FontSize übernehmen.
  2. `FreeTextEditorPopover` an der BBox öffnen, **vorbefüllt mit dem alten Text**, FontSize aus
     dem Block; Farbe/Hintergrund wählbar (Default Text `#111`, BG `#fff`).
  3. Bei Speichern: `TextEditBox` in `_edits` aufnehmen (bzw. bestehenden am selben BBox ersetzen).
  4. Overlay-Preview je Seite: BBox als `bgColor`-Rechteck + `NewText` darüber (zeigt das Ergebnis
     vor „Anwenden").
  5. „Anwenden" → `Manipulator.ApplyTextEditsAsync(_originalPdfBytes, edits)` → Download
     `<name>.edited.pdf` (wie `.redacted.pdf`), danach `_edits` leeren. Original/Sidecar unberührt.
  6. Hinweistext (`reader.edit.hint`): „Übermalt & ersetzt Text visuell. Der ursprüngliche Text
     bleibt in der Datei extrahierbar — für garantierte Entfernung das Schwärzen-Werkzeug nutzen."
- **NICHT:** kein Auto-Reflow, keine Mehrblock-Selektion, keine Persistenz über Reload hinaus.
- **Dateien:** `ReaderPane.razor` (+ evtl. kleine Ergänzung an `FreeTextEditorPopover.razor` für
  BG-Farbe, nur falls nötig), `de.json`, `en.json`.
- **Akzeptanz (Preview, End-to-End):** Modus wählen → auf Textzeile klicken → Editor mit altem Text
  → ändern → Overlay zeigt neuen Text auf weißem Grund → „Anwenden" → `<name>.edited.pdf` lädt; im
  Ergebnis ist die alte Zeile verdeckt und der neue Text sichtbar. Original bleibt im Reader
  unverändert.

### E-15 (OPTIONAL/Stretch) — „Echte Entfernung" beim Bearbeiten

- **Ziel:** Option „alten Text wirklich entfernen" (nicht nur übermalen) durch Raster der BBox
  vor dem Neuzeichnen — wiederverwendet die Redaction-Raster-Logik.
- **NICHT starten**, bevor E-10…E-14 grün sind. Klar als Option kennzeichnen (Kosten: BBox wird
  zum Bild). Ehrlichkeits-Caveat aus E-14 entfällt dann für diese Edits.
- **Akzeptanz:** Mit aktivierter Option ist der alte Text im Ergebnis nicht mehr extrahierbar
  (Text-Extraktion der Zone leer).

---

## Empfohlene Reihenfolge (Loop-Abarbeitung)

| # | Auftrag | Runde | Warum hier |
|---|---------|-------|-----------|
| 1 | **E-02** OOXML-Builder `convertToDocx` | 1 | Kern zuerst; E-01 ruft ihn auf |
| 2 | **E-01** Enum + Dispatch | 1 | Verdrahtet den Builder in die Pipeline |
| 3 | **E-03** UI-Option + i18n | 1 | DOCX-Export end-to-end nutzbar/testbar |
| 4 | **E-04** Blueprint/Doku DOCX | 1 | Doku synchron, Feature 1 abgeschlossen |
| 5 | **E-10** Bridge `applyTextEdits` | 2 | Kern von Feature 2 zuerst |
| 6 | **E-11** Infra `ApplyTextEditsAsync` | 2 | C#-Brücke |
| 7 | **E-12** JS `findTextBlockAt` | 2 | Block-Erkennung für die Geste |
| 8 | **E-13** Reader-Werkzeug (Modus/Toolbar/State) | 2 | Gerüst im Reader |
| 9 | **E-14** Edit-Geste end-to-end | 2 | Feature 2 nutzbar |
| 10 | **E-04→Doku** Blueprint pdf-reader/pdf-werkzeuge um Edit ergänzen | 2 | Doku synchron |
| 11 | **E-05** XLSX (optional) | 3 | nur wenn Budget bleibt |
| 12 | **E-06** PPTX (optional) | 3 | nur wenn Budget bleibt |
| 13 | **E-15** Echte Entfernung (optional) | 3 | nur wenn Budget bleibt |

**Abschluss:** Wenn keine Pflicht-Aufträge (Runde 1+2) mehr offen sind, Loop beenden (optionale
Runde-3-Aufträge nur bei ausreichend Budget/Zeit), Abschluss-Zusammenfassung schreiben:
erledigt / blockiert (mit Grund) / Build+Test-Gesamtergebnis.
