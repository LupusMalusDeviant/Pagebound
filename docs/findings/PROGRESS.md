# Fortschritt — Abarbeitung FINDINGS-2026-07-03

Reihenfolge gemäß Tabelle „Empfohlene Reihenfolge" (Runde 1 zuerst, innerhalb Runde aufsteigend).
Status: `[ ]` offen · `[x]` erledigt (mit Commit-Hash) · `[!]` blockiert (mit Begründung).

## Basis
- Base-Commit `ad6f966` — feat(reader): Freitext-Werkzeug + Datum-Stempel
- Base-Commit `<docs>` — docs: Codebase-Blueprints + Review-Findings

## Runde 1 — Sichtbare Bugs
- [ ] F-01 · Signatur-Badge veraltet nach Freitext-Drag
- [ ] F-02 · Werkzeugwechsel hinterlässt leere Geister-Annotation
- [ ] F-03 · Flatten-Export bricht bei nicht-kodierbarem Zeichen ab
- [ ] F-04 · Editor-Wechsel zwischen Freitexten verwirft Inhalt
- [ ] F-05 · Text-Layer und Cursor ignorieren neue Modi
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
(keine)
