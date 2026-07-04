# Umsetzungsplan: Killerfeatures-Batch (100 % offline)

**Datum:** 2026-07-04
**Scope:** 5 Feature-Blöcke, alle rein lokal im Browser, ohne Telemetrie/Server:
1. **Office-Export komplett** — PDF→XLSX + PPTX (zusätzlich zum vorhandenen DOCX)
2. **Muster-Schwärzung** — Regex/Preset (E-Mail/Telefon/IBAN/Kreditkarte) automatisch finden + schwärzen
3. **Vorlesen (TTS)** — Seiten-Text per Browser-`SpeechSynthesis` vorlesen
4. **Signatur zeichnen** — Unterschrift auf Canvas malen statt PNG hochladen
5. **Seiten-Organizer** — Thumbnails: Reihenfolge per Drag, Seiten drehen/löschen/extrahieren, anwenden

Deploy: **gebündelt am Ende** (mit dem bereits committeten Toolbar-Umbau).

---

## Abschnitt 0 — Globale Regeln (hart)

1. **KEINE Telemetrie** (`NoOpTelemetryService` bleibt), **KEIN Server / keine externen Requests** (nur eigener Origin + Browser-APIs).
2. **KEINE neuen Laufzeit-Dependencies.** OOXML (XLSX/PPTX) von Hand via vorhandenem `fflate`. TTS = `window.speechSynthesis`. Canvas = Standard-DOM. Kommt doch eine dazu → `tools/privacy-check.mjs`-Baseline aktualisieren (nur Web-`package.json` wird überwacht).
3. **i18n immer in de.json UND en.json.** Kein Text hart im Markup.
4. **Enums nur anhängen** (`ConversionFormat`, `AnnotationType` nie umsortieren).
5. **Kein destruktiver Zugriff auf Original/Sidecar** — neue Features erzeugen neue Ausgabedateien bzw. transiente States.
6. **Ehrlichkeit** — Grenzen (Best-Effort-Layout, Heuristik, keine echte Struktur) in UI-Hinweisen + Blueprint benennen.

**Verifikation je Auftrag:** `dotnet build Pagebound.slnx` + `dotnet test tests/Pagebound.Core.Tests` grün; bei `*.ts` zusätzlich `npm run typecheck` + `build:js`; bei neuen Tailwind-Klassen `build:css`; `node tools/privacy-check.mjs` grün. Bridge-Logik wo möglich per Browser-`preview_eval` prüfen (echte Bytes rein, Ergebnis prüfen). **Reader-UI-Klicktests** gehen in der Headless-Sandbox nicht (Auto-Open-Hang, siehe Memory) → dort compile-verifizieren + im echten Browser nach Deploy prüfen.

**Commit-Stil:** deutsch, Conventional Commit mit Auftrags-ID. Ein Commit pro Auftrag. KEIN Push bis zum Schluss.

---

## Runde 1 — Office-Export komplett (XLSX + PPTX)

### K-01 — Enum + Dispatch
- **SOLL:** `ConversionFormat.Xlsx`, `.Pptx` anhängen (`ConversionTypes.cs`). In `JsPdfConverter` zwei `case`: `pageboundPdf.convertToXlsx` → `.xlsx` MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; `convertToPptx` → `.pptx` MIME `…presentationml.presentation`. Binär (`byte[]`).
- **Akzeptanz:** Build grün.

### K-02 — `convertToXlsx` (SpreadsheetML)
- **SOLL:** `convertToXlsx(data)` in pdfjs-bridge.ts — je Seite die Tabellen-Heuristik (`pageItemsToCsv`/Cluster) → Zeilen/Zellen; ein Sheet je Seite (oder aneinander). OOXML-ZIP via `zipSync`: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheetN.xml`, `xl/sharedStrings.xml`. Inline- oder SharedStrings; Zahlen als Number, Rest als String (sharedStrings). XML escapen.
- **Akzeptanz (preview_eval):** gültiges ZIP (PK), enthält `xl/workbook.xml`; in Excel/LibreOffice öffenbar; Zellen = CSV-Heuristik.

### K-03 — `convertToPptx` (PresentationML)
- **SOLL:** `convertToPptx(data, scale)` in pdfjs-bridge.ts — je Seite `renderPageToCanvas` → PNG; eine Folie je Seite mit dem Bild vollflächig. OOXML-ZIP: `[Content_Types].xml`, `_rels/.rels`, `ppt/presentation.xml`, `ppt/_rels/presentation.xml.rels`, `ppt/slides/slideN.xml`, `ppt/slides/_rels/slideN.xml.rels`, `ppt/media/imageN.png`, Folienmaß aus Seitenverhältnis.
- **Akzeptanz (preview_eval):** gültiges ZIP; in PowerPoint/Impress öffenbar; je Seite eine Folie.

### K-04 — UI-Optionen + i18n + Blueprint
- **SOLL:** zwei `<option>` (Xlsx/Pptx) im Konvertieren-Dropdown (`PdfToolsPanel.razor`); i18n `tools.convert.xlsx`/`.pptx` (de/en); `konvertierung.md` + INDEX ergänzen.
- **Akzeptanz:** Optionen vorhanden, JSON valide, Doku synchron.

---

## Runde 2 — Muster-Schwärzung (Regex/Preset)

### K-10 — `findTextMatches` Bridge
- **SOLL:** `findTextMatches(pdfBytes, pattern, flags, pages?)` in pdfjs-bridge.ts — je Seite `getTextContent`, Zeilentext (buildPageText-Logik) auf `pattern` matchen; je Treffer die BBox aus den beteiligten Items (0..1, oben-links) → `[{page, x,y,w,h, text}]`. Presets als benannte Regex-Konstanten: `email`, `phone`, `iban`, `creditcard`. Timeout/Cap gegen Regex-Katastrophen.
- **Akzeptanz (preview_eval):** Testtext mit E-Mail → korrekte BBox; Kein-Treffer → leer.

### K-11 — Reader-UI: Muster suchen → Schwärzungen
- **SOLL:** in der Schwärzen-Kontextleiste ein Preset-Dropdown (E-Mail/Telefon/IBAN/Kreditkarte/Eigenes) + Feld für eigene Regex + Button „Finden & markieren". Ruft `findTextMatches` → fügt Treffer als `RedactionBox` in `_redactions` (bestehender Apply-Pfad = echte Entfernung via Raster). Zähler „N Treffer".
- **Akzeptanz:** Build grün; im echten Browser: Preset → Boxen erscheinen → Anwenden entfernt Text (Audit leer in Zonen).

### K-12 — i18n + Blueprint (Redaktion)
- **SOLL:** i18n de/en; `redaktion.md` um Muster-Schwärzung ergänzen (Heuristik-Grenzen ehrlich: findet nur extrahierbaren Text-Layer, kein OCR).

---

## Runde 3 — Vorlesen (TTS)

### K-20 — `tts-bridge.ts`
- **SOLL:** `speak(text, {rate?, voiceUri?})`, `pause()`, `resume()`, `cancel()`, `listVoices()` über `window.speechSynthesis` + `SpeechSynthesisUtterance`. Langer Text in Sätze chunken (SpeechSynthesis-Limit). Esbuild-Global `pageboundTts`. Kein Netz, keine Dependency.
- **Akzeptanz (preview_eval):** `listVoices` liefert (falls Stimmen da) Array; `speak` wirft nicht.

### K-21 — Reader-UI: Vorlesen
- **SOLL:** im **Ansicht**-Menü Eintrag „Vorlesen" → liest den Text der aktuellen Seite (`readPageText`/`extractText`). Kleine Steuerleiste (Play/Pause/Stop, optional Tempo). Stoppt bei Seitenwechsel/Unload.
- **Akzeptanz:** Build grün; im echten Browser hörbar.

### K-22 — i18n + Blueprint
- **SOLL:** i18n de/en; kurzer Blueprint-Eintrag (oder in pdf-reader.md).

---

## Runde 4 — Signatur zeichnen

### K-30 — `SignaturePad`-Komponente
- **SOLL:** `SignaturePad.razor` — `<canvas>` mit Pointer-Events (zeichnen), „Leeren"/„Übernehmen"/„Abbrechen"; „Übernehmen" liefert PNG-Data-URL (`canvas.toDataURL`) via `EventCallback<string>`. Trim/Transparenz optional.
- **Akzeptanz:** Build grün; Zeichnen erzeugt nicht-leeres PNG.

### K-31 — In Signatur-Flow einbinden
- **SOLL:** im **Signatur**-Menü neben „Signatur laden" ein „Signatur zeichnen" → öffnet Pad → Data-URL wird wie ein hochgeladenes PNG als `_activeSignatureImage` gesetzt (gleicher Platzier-/Flatten-Pfad).
- **Akzeptanz:** Build grün; im echten Browser: zeichnen → platzieren → einbrennen.

### K-32 — i18n + Blueprint
- **SOLL:** i18n de/en; signatur-integritaet.md-Notiz.

---

## Runde 5 — Seiten-Organizer

### K-40 — `organizePages` Bridge
- **SOLL:** `organizePages(pdfBytes, ops)` in pdf-manipulator-bridge.ts, `ops = [{ sourceIndex:number, rotation:number }]` (0-basiert, rotation 0/90/180/270 absolut oder Delta). Baut neues Dokument: für jede op die Quellseite kopieren (pdf-lib `copyPages`) + Rotation setzen; ausgelassene Quellseiten = gelöscht; Reihenfolge = op-Reihenfolge. Save.
- **Akzeptanz (preview_eval):** 3-Seiten-PDF, ops=[{2,0},{0,90}] → 2 Seiten, Reihenfolge/Rotation korrekt, re-parsebar.

### K-41 — Infra-Methode
- **SOLL:** `IPdfManipulator.OrganizePagesAsync(Stream, IReadOnlyList<PageOp>, ct)` + Impl (camelCase-Payload), `PageOp(int SourceIndex, int Rotation)`.
- **Akzeptanz:** Build + Tests grün.

### K-42 — Organizer-UI
- **SOLL:** neue Seite `/organize` (oder Reader-Panel) — Thumbnails aller Seiten (renderPage), Auswahl, **Drag-Reorder** (`@ondragstart/@ondrop`), pro Seite Drehen (±90) + Löschen, Auswahl „Extrahieren", „Anwenden & speichern" → `OrganizePagesAsync` → Download. Original unberührt.
- **Akzeptanz:** Build grün; im echten Browser: umordnen/drehen/löschen → korrekte Ausgabe.

### K-43 — i18n + Blueprint
- **SOLL:** i18n de/en; neues Blueprint `seiten-organizer.md` + INDEX; Nav-Link.

---

## Empfohlene Reihenfolge

Runde 1 (Office, am ehesten per eval verifizierbar) → Runde 2 (Muster-Schwärzung) → Runde 5 (Organizer-Bridge/Infra vor UI) → Runde 3 (TTS) → Runde 4 (Signatur zeichnen). Reader-lastige UI-Teile compile-verifizieren, im User-Browser nach Deploy prüfen.

**Abschluss:** Wenn PROGRESS leer, Gesamt-Gate (Build/Tests/Typecheck/Privacy), Zusammenfassung, **dann push + deploy** (mit dem Toolbar-Umbau).
