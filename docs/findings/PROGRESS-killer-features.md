# Fortschritt: Killerfeatures-Batch

Plan: [`PLAN-2026-07-04-killer-features.md`](./PLAN-2026-07-04-killer-features.md)
`[ ]` offen · `[x]` erledigt (Commit) · `[!]` blockiert (Grund)

## Runde 1 — Office-Export (XLSX + PPTX)
- [x] **K-01** ConversionFormat.Xlsx/Pptx + Dispatch — Build+184 Tests grün
- [x] **K-02** convertToXlsx (SpreadsheetML) — im Preview verifiziert (ZIP+PK, je Seite ein Blatt, alle XML wohlgeformt, Text in Zellen)
- [x] **K-03** convertToPptx (PresentationML, Seite=Folie) — implementiert, Typecheck grün; „öffnet in PPT" im Sandbox-Canvas-Hang blockiert (wie convertToImagesZip), Browser-Verify nach Deploy
- [x] **K-04** UI-Optionen + i18n + Blueprint

**Runde 1 (Office-Export) abgeschlossen.**

## Runde 2 — Muster-Schwärzung
- [x] **K-10** findTextMatches Bridge (Regex → BBoxes) — im Preview verifiziert (tighte Sub-Item-Box, Preset-Regex, Kein-Treffer=0)
- [x] **K-11** Reader-UI: Preset/Regex → Schwärzungen — Build grün (Reader-Klicktest im User-Browser)
- [x] **K-12** i18n + Blueprint

**Runde 2 (Muster-Schwärzung) abgeschlossen.**

## Runde 3 — Vorlesen (TTS)
- [x] **K-20** tts-bridge.ts (speak/pause/resume/cancel/voices) — im Preview verifiziert (7 Funktionen, isSupported, 3 Stimmen, speak/cancel ok)
- [x] **K-21** Reader-UI: Vorlesen (Ansicht-Menü + Steuerung) — Build grün (Reader-Klicktest im User-Browser)
- [x] **K-22** i18n + Blueprint

**Runde 3 (Vorlesen/TTS) abgeschlossen.**

## Runde 4 — Signatur zeichnen
- [ ] **K-30** SignaturePad-Komponente (Canvas → PNG)
- [ ] **K-31** In Signatur-Menü einbinden
- [ ] **K-32** i18n + Blueprint

## Runde 5 — Seiten-Organizer
- [x] **K-40** organizePages Bridge — im Preview verifiziert (reorder, delete, valides PDF)
- [x] **K-41** Infra OrganizePagesAsync + PageOp — Build+184 Tests grün
- [x] **K-42** Organizer-UI (/organize) — **im Preview voll verifiziert**: laden→Thumbnails→drehen(90°)→löschen→Anwenden→gültiges organized.pdf (Screenshot); Drag-Reorder compile-verifiziert
- [x] **K-43** i18n + Blueprint + Nav

**Runde 5 (Seiten-Organizer) abgeschlossen.**

## Notizen / Abweichungen
(leer)
