# Skill-Log: codebase-mapper

## 2026-11-08 — Run

**Aufgabe:** Blueprint komplett neu erzeugen („aktualisiere den Blueprint", Nutzerwahl: komplett neu statt inkrementell).

**Entscheidungen:**
- Re-Run-Modus: komplett neu. Alle 18 vorhandenen Feature-Dateien vor dem Überschreiben gelesen; die einzige manuelle Ergänzung im Bestand — `## Muster-Schwärzung (Regex/Preset)` in `redaktion.md` — wortgetreu übernommen.
- Feature-Schnitt auf 24 erweitert (vorher 18 Dateien, 16 im ersten Lauf). Neu: App-Shell & Start, Datei-Eintritt (PWA), Seiten-Organizer, Interop-Hilfen (UI), Statische Seiten & Store-Auftritt, Auslieferung Build & CI, Core-Verträge.
- Auf Nachfrage entschied der Nutzer, „Text bearbeiten" und „Schwärzung" als **eigene** Features zu führen, obwohl sie keine eigenen Dateien haben. Beide erscheinen deshalb nicht im maschinell geprüften Kantengraph; ihre Abhängigkeiten sind in den Feature-Dateien ausdrücklich als von Hand ermittelt gekennzeichnet.
- Vier Kanten der Tabelle sind geprüfte Namensgleichheiten (`catalog`, `save`/`load`/`register`, `speak`). Sie bleiben in der Tabelle, weil sie maschinell erzeugt ist, werden aber in `INDEX.md` und in den betroffenen Feature-Dateien als widerlegt benannt statt stillschweigend stehen zu lassen.
- Sechs Dateien bleiben bewusst ohne Feature (unversionierte Hilfsskripte unter `mcp/`, die PDF.js-Attrappe, zwei minifizierte Tesseract-Bündel) — begründet unter „Bewusste Reste" in `INDEX.md`, weil ihre Zuordnung Scheinkanten erzeugt.

**Korrigierte Abweichungen (Doku gegen Code):**
- `signatur-integritaet.md` behauptete „keine kryptografische PDF-Signatur nach PAdES". Falsch: `sign-bridge.ts` baut einen CMS-SignedData-Container (`buildCms:233`), `tools/cms-verify` ist die Gegenprobe.
- `konvertierung.md` kannte das SVG-Zielformat nicht (`ConversionFormat.Svg`, `ConversionTypes.cs:17`).
- `mcp-server.md` nannte 27 Werkzeuge; es sind 30 (`pdf_ocr`, `design_merge_data`, `design_render_pdf` fehlten).
- `split-view-vergleich.md` führte das gekoppelte Scrollen als offene Frage; es existiert (`split-bridge.ts:91`).

**Artefakte:**
- `docs/blueprints/INDEX.md` (Feature-Tabelle, Zuordnung mit Globs und Rollen, 56 geprüfte Kanten, Stand-Commit)
- 24 Feature-Dateien unter `docs/blueprints/`

**Nachweis:**
- `node .../mapper/scripts/edges.mjs X:/CodingAdventures2/PDF-Tool --lang de --check` → „Prüfung der Blueprint-Dateien: keine Befunde"; „Zuordnung unvollständig" nennt nur die sechs bewussten Reste.
- Kantenzahl frisch erzeugt (56) stimmt mit `INDEX.md` überein (80 Tabellenzeilen = 56 Kanten + 24 Zuordnungszeilen).
- Alle 24 internen Verweise auflösbar, kein toter Link.

**Status:** abgeschlossen. Kein Quellcode geändert.

---

## 2026-07-03 17:35 — Run

**Aufgabe:** Kompletten Codebase-Blueprint erstellen (Teil des Auftrags: Feature Datum/Text-Werkzeug + Mapper + Code-Review + Findings-Doku).

**Entscheidungen:**
- Re-Run-Modus: Komplett neu generieren (keine bestehenden Blueprints vorhanden)
- Scope: Komplettes Repo
- Feature-Liste: 16 Features, ohne User-Rückfrage bestätigt (autonome Session, User abwesend)

**Artefakte:**
- docs/blueprints/INDEX.md
- docs/blueprints/pdf-reader.md, annotationen.md, signatur-integritaet.md, redaktion.md, split-view-vergleich.md
- docs/blueprints/pdf-werkzeuge.md, formulare.md, batch.md, konvertierung.md, ocr.md
- docs/blueprints/library-workspace.md, markdown-export.md, designer.md, storage-persistenz.md, lokalisierung-theme.md, mcp-server.md

**Status:** abgeschlossen

---
