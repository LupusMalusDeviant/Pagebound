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
- [ ] F-06 · Eingebrannter Text verschwindet an Seiten-Unterkante

## Runde 2 — Robustheit + Export
- [ ] F-08 · Doppelklick platziert doppelt (Reentrancy-Guard)
- [ ] F-09 · Markdown-Export lässt Freitexte weg
- [ ] F-14 · Datum-Format aus i18n ungeprüft als Formatstring

## Runde 3 — UX/Effizienz (F-10 NACH F-02/F-04)
- [ ] F-10 · Leere Annotation vor dem Tippen persistiert
- [ ] F-11 · Stil-Änderung schreibt bei jedem Swatch-Klick
- [ ] F-13 · Drag-Bridge: Listener-Attach-Race bei schnellem Klick
- [ ] F-21 · Seitennavigation als Sticky-Bottom-Bar

## Runde 4 — Kompatibilität, Performance, Privacy
- [ ] F-07 · Sidecar: unbekannter Annotationstyp still verschluckt
- [ ] F-12 · Signatur-Recompute O(Signaturen × Annotationen)
- [ ] F-20 · Automatischer Wächter gegen externe Requests

## Runde 5 — Refactorings/Doku
- [ ] F-15 · Payload-Helper 6-fach dupliziert
- [ ] F-16 · Freitext-Editor-Duplikate zusammenführen
- [ ] F-17 · Freitext-Editor als Komponente extrahieren
- [ ] F-18 · `npm run typecheck` ist rot
- [ ] F-19 · ADR-Verweise ohne ADR-Dateien

## Abweichungen / Notizen
- F-03: IST sagt „Fallback-drawText steht außerhalb des try". Im Code steht er
  im `catch`, ist aber selbst nicht geschützt — ein zweiter Wurf entkommt dem
  catch und reißt `flattenAnnotations` ab. Gleiche Wirkung wie beschrieben; Fix
  folgt dem Code (eigenes try/catch um den Fallback + korrigierter Filter).
- Bundled `wwwroot/js/*.js` sind gitignored (Build-Artefakte) → nur `.ts`
  committen, `npm run build:js` erzeugt die Bundles lokal.
