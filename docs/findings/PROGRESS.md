# Fortschritt — Abarbeitung FINDINGS-2026-07-03

Reihenfolge gemäß Tabelle „Empfohlene Reihenfolge" (Runde 1 zuerst, innerhalb Runde aufsteigend).
Status: `[ ]` offen · `[x]` erledigt (mit Commit-Hash) · `[!]` blockiert (mit Begründung).

## Basis
- Base-Commit `ad6f966` — feat(reader): Freitext-Werkzeug + Datum-Stempel
- Base-Commit `92aa202` — docs: Codebase-Blueprints + Review-Findings
- Base-Commit `bbed341` — docs: PROGRESS.md

## Runde 1 — Sichtbare Bugs
- [x] F-01 · Signatur-Badge veraltet nach Freitext-Drag — `69793b3`
- [x] F-02 · Werkzeugwechsel hinterlässt leere Geister-Annotation — `44df46c`
- [x] F-03 · Flatten-Export bricht bei nicht-kodierbarem Zeichen ab — `0197dac`
- [x] F-04 · Editor-Wechsel zwischen Freitexten verwirft Inhalt — `4ad891b`
- [x] F-05 · Text-Layer und Cursor ignorieren neue Modi — `77d803a`
- [x] F-06 · Eingebrannter Text verschwindet an Seiten-Unterkante — `1d824a5`

## Runde 2 — Robustheit + Export
- [x] F-08 · Doppelklick platziert doppelt (Reentrancy-Guard) — `113d6a0`
- [x] F-09 · Markdown-Export lässt Freitexte weg — `32a41fa`
- [x] F-14 · Datum-Format aus i18n ungeprüft als Formatstring — `fa33e42`

## Runde 3 — UX/Effizienz (F-10 NACH F-02/F-04)
- [x] F-10 · Leere Annotation vor dem Tippen persistiert — `0162595`
- [x] F-11 · Stil-Änderung schreibt bei jedem Swatch-Klick — `6210481` (löst F-10-Zwischenstufe)
- [x] F-13 · Drag-Bridge: Listener-Attach-Race bei schnellem Klick — `ab8c6a4`
- [x] F-21 · Seitennavigation als Sticky-Bottom-Bar — `06204a7` (Browser-verifiziert)

## Runde 4 — Kompatibilität, Performance, Privacy
- [x] F-07 · Sidecar: unbekannter Annotationstyp still verschluckt — `93d055e` (nur Maßnahme 1)
- [x] F-12 · Signatur-Recompute O(Signaturen × Annotationen) — `8e324b3`
- [x] F-20 · Automatischer Wächter gegen externe Requests — `85505fb` (+CI-Gate)

## Runde 5 — Refactorings/Doku
- [x] F-15 · Payload-Helper 6-fach dupliziert — `89630c6`
- [x] F-16 · Freitext-Editor-Duplikate zusammenführen — `0938a2c`
- [x] F-17 · Freitext-Editor als Komponente extrahieren — `acda9da` (Browser-verifiziert)
- [x] F-18 · `npm run typecheck` ist rot — `29f7828` (0 statt 25 Fehler)
- [x] F-19 · ADR-Verweise ohne ADR-Dateien — `55ea789`

## Abschluss (alle 21 Aufträge erledigt)
- Erledigt: F-01 bis F-21 (kein Auftrag blockiert).
- Endstand: `dotnet build Pagebound.slnx` 0 Fehler · `dotnet test
  tests/Pagebound.Core.Tests` 184/184 grün · `npm run typecheck` Exit 0 ·
  `npm run build:js` OK · `tools/privacy-check.mjs` Exit 0.
- Neue Tests gegenüber Basis: 174 → 184 (+10: F-09 ×3, F-11 ×1, F-07 ×3, F-12 ×3).
- Browser-verifiziert: F-21 (Sticky-Nav) und F-17 (Freitext-Editor-Komponente).

## Abweichungen / Notizen
- F-03: IST sagt „Fallback-drawText steht außerhalb des try". Im Code steht er
  im `catch`, ist aber selbst nicht geschützt — ein zweiter Wurf entkommt dem
  catch und reißt `flattenAnnotations` ab. Gleiche Wirkung wie beschrieben; Fix
  folgt dem Code (eigenes try/catch um den Fallback + korrigierter Filter).
- Bundled `wwwroot/js/*.js` sind gitignored (Build-Artefakte) → nur `.ts`
  committen, `npm run build:js` erzeugt die Bundles lokal.
- F-19: Findings-IST + vorhandener README-Link nannten `docs/adrs/001-…` (Plural,
  3-stellig). Umgesetzt wie im SOLL vorgegeben als `docs/adr/0001-…` (4-stellig,
  adr-writer-Konvention); stalen Querverweis in Abstractions/README.md gefixt.
- F-17: Statt des vorgeschlagenen `Annotation`-Parameters übergibt der Parent die
  berechnete Platzierung (Left/Top/Transform/Page), weil der Pending-Fall keine
  Annotation hat. Content-Sync via plain `Action<string>` (kein EventCallback) →
  Tastenanschlag re-rendert nur die Komponente, Parent-State bleibt aktuell.
  Browser-verifiziert (Create/Edit/Style).
- F-15: Vorschlags-Signatur war `GetDouble(payload, key)`; ShapeAnnotation nutzte
  aber `GetDouble(payload, key, fallback)`. Helper daher als Superset mit
  optionalem `double fallback = 0` implementiert (deckt beide Aufrufmuster ab).
- F-07: Nur Maßnahme 1 (Erkennen + Melden) umgesetzt; Maßnahme 2 (`minAppVersion`-
  Feld) bewusst weggelassen — es hätte das Sidecar-Schema/den Record geändert
  (Risiko ohne klaren Nutzen), die Aufgabe erlaubt das explizite Weglassen.
  `ISidecarService.ParseAsync` liefert nun `SidecarParseResult` statt `Sidecar?`
  (Signaturänderung; alle 2 Aufrufer in ReaderPane angepasst).
- F-21: Neue Tailwind-Klasse `bottom-0` war nicht im vorkompilierten `app.css` →
  `npm run build:css` (Tailwind v4) nötig, sonst `bottom: auto` und die Bar klebt
  nicht. `app.css`/`*.js`-Bundles sind gitignored; `npm run build` (Deploy) baut
  beide. Per Browser-Preview mit 3-Seiten-Test-PDF vollständig verifiziert.
- F-13: IST/SOLL nennt `finish()`; im Code heißt die Abschluss-Funktion `onUp()`
  (Cleanup + C#-Callback). Fix folgt dem Code (`onUp()` in `onMove` bei
  `e.buttons === 0`).
- F-10: Verifiziert per Build + Tests + Logik-/Null-Safety-Analyse aller
  State-Pfade (Place/Save/Cancel/Delete/Moduswechsel/Background-Click/
  Editor-Wechsel). Kein Browser-Test des Storage-Write-Verhaltens (bräuchte
  IndexedDB-Inspektion). Bekannte, gewollte Zwischenstufe: Stil-Buttons wirken
  auf einen noch-nicht-gespeicherten Freitext erst nach F-11 (Pending-Style).
