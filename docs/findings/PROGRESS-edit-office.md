# Fortschritt: PDF→Office (DOCX) + Inline-Edit

Plan: [`PLAN-2026-07-03-edit-office.md`](./PLAN-2026-07-03-edit-office.md)
Status je Auftrag: `[ ]` offen · `[x]` erledigt (Commit-Hash) · `[!]` blockiert (Begründung)

Reihenfolge = „Empfohlene Reihenfolge" im Plan.

## Runde 1 — PDF→DOCX (Pflicht)
- [x] **E-02** OOXML-Builder `convertToDocx` (pdfjs-bridge.ts) — `174b206`
- [x] **E-01** `ConversionFormat.Docx` + Converter-Dispatch — `45a9b6a`
- [x] **E-03** UI-Option + i18n (de/en) — end-to-end im Preview verifiziert: echte `convertToDocx` liefert gültiges .docx (ZIP+PK, 5 OOXML-Teile, alle XML wohlgeformt/DOMParser, Text+Seitenumbruch korrekt). Dropdown-Option compile-geprüft (Muster der 5 Geschwister); Tools-Panel liegt hinter Reader-Navigation, daher nicht click-getestet.
- [x] **E-04** Blueprint/Doku DOCX (konvertierung.md) + privacy-check: OOXML-Namespace-Host allowlisted (XML-Bezeichner, kein Request)

**Runde 1 (PDF→DOCX) abgeschlossen.**

## Runde 2 — Inline-Edit „Text bearbeiten" (Pflicht)
- [x] **E-10** Bridge `applyTextEdits` (Cover + Redraw) — im Preview verifiziert: gültiges PDF, neuer Text gezeichnet, opake Cover-Rect; alter Text bleibt extrahierbar (Design → Ehrlichkeits-Hinweis)
- [x] **E-11** Infra `ApplyTextEditsAsync` + `TextEditRegion`-Record (IPdfManipulator/JsPdfLibManipulator) — Build+184 Tests grün
- [x] **E-12** JS-Helper `findTextBlockAt` — im Preview verifiziert: Klick auf Textzeile liefert exakten Text+BBox+fontSize (x=72/595, size=24/842), leerer Bereich → null, Seite-2-18pt korrekt
- [x] **E-13** Reader-Werkzeug (Modus/Toolbar/State) — Enum `EditText`, Toolbar-Button, Aktionsleiste, transienter `_edits`-State, Overlay-Vorschau; Build+184 Tests+Privacy grün
- [x] **E-14** Edit-Geste end-to-end (Klick→Editor→Anwenden) — **im Browser voll verifiziert**: Werkzeug aktivieren → Klick auf Textzeile → Editor vorbefüllt mit Alt-Text → ändern+speichern → Overlay (weißes Cover + neuer Text) → „Anwenden" erzeugt gültigen `application/pdf`-Blob (1774 B), Edits geleert, kein Fehler. Screenshot belegt Ersetzung visuell.
- [x] **E-04b** Doku: neues Blueprint `text-bearbeiten.md` + INDEX (Feature-Zeile, Graph-Knoten, Konvertierung-Zeile um DOCX)

**Runde 2 (Inline-Edit „Text bearbeiten") abgeschlossen.**

## Runde 3 — Optional (nur bei Budget)
- [ ] **E-05** XLSX-Export (Tabellen-Heuristik)
- [ ] **E-06** PPTX-Export (Seite=Folie als Bild)
- [ ] **E-15** Echte Entfernung beim Bearbeiten (Raster)

## Runde 4 — MCP-Parität (neue Features als Agent-Tools)
- [x] **M-01** `pdf_to_docx` (`toDocx` in pdf.ts + fflate-Dep + index.ts + smoke + Doku) — Build + Smoke ALL PASS (ZIP+PK, OOXML-Teile, Text, Seitenumbruch)
- [x] **M-02** `pdf_edit_text` (Suchen & Ersetzen, Cover+Redraw `applyTextReplacements` + index.ts + smoke + Doku) — Build + Smoke ALL PASS (replaced=1, valides PDF, neuer Text, kein-Treffer→0)

**Runde 4 (MCP-Parität) abgeschlossen.**

## Notizen / Abweichungen
(leer — hier Code-Abweichungen von der IST-Beschreibung + blockierte Aufträge dokumentieren)
