# Fortschritt: PDF→Office (DOCX) + Inline-Edit

Plan: [`PLAN-2026-07-03-edit-office.md`](./PLAN-2026-07-03-edit-office.md)
Status je Auftrag: `[ ]` offen · `[x]` erledigt (Commit-Hash) · `[!]` blockiert (Begründung)

Reihenfolge = „Empfohlene Reihenfolge" im Plan.

## Runde 1 — PDF→DOCX (Pflicht)
- [x] **E-02** OOXML-Builder `convertToDocx` (pdfjs-bridge.ts) — `174b206`
- [x] **E-01** `ConversionFormat.Docx` + Converter-Dispatch — `45a9b6a`
- [x] **E-03** UI-Option + i18n (de/en) — end-to-end im Preview verifiziert: echte `convertToDocx` liefert gültiges .docx (ZIP+PK, 5 OOXML-Teile, alle XML wohlgeformt/DOMParser, Text+Seitenumbruch korrekt). Dropdown-Option compile-geprüft (Muster der 5 Geschwister); Tools-Panel liegt hinter Reader-Navigation, daher nicht click-getestet.
- [ ] **E-04** Blueprint/Doku DOCX (konvertierung.md)

## Runde 2 — Inline-Edit „Text bearbeiten" (Pflicht)
- [ ] **E-10** Bridge `applyTextEdits` (Cover + Redraw)
- [ ] **E-11** Infra `ApplyTextEditsAsync` (JsPdfLibManipulator)
- [ ] **E-12** JS-Helper `findTextBlockAt`
- [ ] **E-13** Reader-Werkzeug (Modus/Toolbar/State)
- [ ] **E-14** Edit-Geste end-to-end (Klick→Editor→Anwenden)
- [ ] **E-04b** Doku: pdf-reader/pdf-werkzeuge um „Text bearbeiten" ergänzen

## Runde 3 — Optional (nur bei Budget)
- [ ] **E-05** XLSX-Export (Tabellen-Heuristik)
- [ ] **E-06** PPTX-Export (Seite=Folie als Bild)
- [ ] **E-15** Echte Entfernung beim Bearbeiten (Raster)

## Notizen / Abweichungen
(leer — hier Code-Abweichungen von der IST-Beschreibung + blockierte Aufträge dokumentieren)
