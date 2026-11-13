# CLAUDE.md — Pagebound

Kontext für Claude-Code-Sessions in diesem Projekt (Repo-Ordner: `PDF-Tool`, Produkt: **Pagebound**).

## Projektkontext

- **Stack:** Blazor WebAssembly (.NET 10), datenschutzfreundlicher PDF-Reader/-Editor als statische Offline-PWA. Rendering via PDF.js (JS-Interop), Manipulation via pdf-lib (JS), Verschlüsselung AES-256/R6 via WebCrypto, OCR via Tesseract.js (self-hosted). PLUS separates TypeScript-MCP-Paket unter `mcp/` (33 Tools, gezählt am 2026-11-13 über `grep -c 'server.registerTool' mcp/src/index.ts`; stdio + Streamable HTTP). Apache 2.0.
- **Einstiegspunkte:** `src/Pagebound.Web/Program.cs` (23 Services hinter IXxx, DI); `mcp/src/index.ts` (MCP-Server, „reuses the same engines").
- **Struktur:** `src/Pagebound.Core/` (Domain/Crypto/Library/Abstractions), `src/Pagebound.Infrastructure/`, `src/Pagebound.Web/` (Blazor-UI — u.a. God-Components `ReaderPane.razor` ~4390 Z., `DesignerPage.razor` ~2635 Z.), `mcp/` (TS-Paket), `tests/`, `infra/` (Docker/nginx), `tools/` (privacy-check.mjs, cms-verify), `docs/` (ADRs), `SECURITY.md`.
- **Tests** (Zahlen gemessen am 2026-11-13, Stand `f6992c7` plus Nachtlauf): xUnit in `tests/`. `dotnet test --filter "FullyQualifiedName!~E2ETests"` → 229 in `Pagebound.Core.Tests` + 11 in `Pagebound.Web.Tests` = **240**. **33 E2E-Tests** (Playwright gegen das gebaute Abbild, eigener CI-Job, keiner skippt) — `dotnet test Pagebound.slnx` zieht sie mit und braucht dafür den laufenden Container; 15 davon (`MobileTouchTargetTests` + `MobilePageGapTests`) laufen auch gegen einen lokalen Dev-Server (`PAGEBOUND_URL=…`). Dazu `npm test` unter `src/Pagebound.Web` → **270** Prüfungen der JS-Brücken, und `npm run smoke` unter `mcp/` → **288** Prüfungen, deckt alle 33 Tools ab. **Die UI-Schicht bleibt die Lücke:** `Pagebound.Web.Tests` enthält genau eine Datei (`Reader/SignaturePadTests.cs`), für Reader, Designer und PDF-Werkzeuge gibt es keine .NET-Komponententests.
- **Build:** `dotnet build Pagebound.slnx` (mcp/ separat via `npm` unter `mcp/`).
- **Style-Regeln:** Interface-First-DI (Core/Abstractions→Infrastructure); self-hosted (kein CDN); managed Krypto statt WASM-inkompatibler Libs (ADR-004); **Telefon-Layout in `app.src.css`** — `@media`-Block plus Zustandsklasse am Wurzelelement (`pb-doc-open`, `pb-show-b`), nicht als Responsive-Präfixe im Markup (Entscheidung 2026-11-08; Begründung, Grenze und zwei CSS-Fallstricke in `docs/plans/2026-11-08-smartphone-layout.md`, Befund 4).
- **Deploy:** statische Offline-PWA (Docker + nginx, `infra/`), self-hosted/manuell. Push/Merge/Deploy bleibt manuell.
- **Kritische Bereiche:** (1) WASM-Speicher & Rendering (base64-Round-Trips, keine Virtualisierung → OOM bei großen PDFs); (2) Datenschutz/Client-only-Zusage (externe Requests? SECURITY.md-Drift vs. Code); (3) mcp/ Node-Package; (4) Krypto (AES-256/R6 via WebCrypto); (5) Signatur-Container (selbst gebautes CMS/ASN.1 in sign.ts + sign-bridge.ts, DER-Konformität — Gegenprobe: `dotnet run --project tools/cms-verify`).
- **Off-Limits:** Datenschutz-Garantie & `privacy-check.mjs` (kein externer Request/CDN/Telemetrie); Krypto-Layer (managed AES-256/R6); Interface-First-DI-Struktur — nie ohne ausdrückliche Erlaubnis ändern.
- **Zugesichert seit MCP 2.0.0:** reproduzierbare Ausgabe (gleiche Eingabe → byte-gleiches PDF; keine Systemuhr, keine Zufalls-IDs) und stabile Fehlerkennungen (`code`) — beides ist Vertrag gegenüber Aufrufern, nicht Kür.
- **Qualitätsprioritäten:** Performance/Speicher (WASM-OOM zuerst), dann Korrektheit, dann Security/Datenschutz, dann Wartbarkeit.
- **Artifact-Backend:** beans (prefix: `PDF-Tool-`)

## Leitplanken (aus dem Repo-Audit 2026-07-04)

In `.claude/lessons-learned.md` verankert, bei jedem SessionStart eingeblendet:
- **Kein externer Request/CDN** — alles self-hosted (Fonts, OCR-Modelle); CSP `connect-src 'self'`; `privacy-check.mjs` muss grün bleiben; `NoOpTelemetryService` bleibt registriert. Das ist die Kern-Produktzusage.
- **Große PDFs:** Streaming/Virtualisierung, `ArrayBuffer`/`Blob`-URL/`IJSStreamReference` statt base64-Round-Trips; In-Memory-Dictionaries (Thumbnails/ContinuousPages) bei Speicherdruck/Datei-Wechsel leeren.
- **JS-Interop-Ressourcen disponieren** (`loadingTask.destroy()`, Tesseract-Worker terminieren).
- **UI-Schicht testen** (nicht nur Pagebound.Core); E2E-Smokes dürfen nicht still weg-skippen. **SECURITY.md mit dem tatsächlichen Verhalten synchron halten.**
- Allgemein: kein Auto-Confirm von Write/Admin; keine selbstgebaute/unauth. Krypto; Uploads per MIME+Magic-Bytes; `Html.Raw` nur nach Server-Sanitization.

## Factory Skills

Factory generiert von `/factory-init` — 2026-07-04, Kontext aktualisiert via `/factory-update` — 2026-08-27.

| Skill | Aufruf | Zweck |
|-------|--------|-------|
| grill | `/grill <problem>` | Diagnose & Konsultation |
| plan | `/plan <bean-id oder idee>` | Feature-Planung |
| refine | `/refine <bean-id>` | Plan vertiefen, Dateipfade, Signaturen (+ eval-bean-Gate) |
| implement | `/implement <bean-id>` | Branch + Commits + Implementierung (eval-bean-Preflight) |
| review | `/review [branch]` | Multi-Angle: security / correctness / over-engineering, OWASP-Pflicht-Pass |
| test | `/test <modul>` | Tests generieren (UI-Schicht + Core; große-PDF-Edge-Cases) |
| doc | `/doc [adr\|arch\|changelog\|code]` | Alle Docs-Formate (SECURITY.md synchron halten) |
| learn | `/learn` | Lessons aus Transcripts extrahieren |
| evolve | `/evolve` | Wiederkehrende Lessons zu CLAUDE.md-Regeln verdichten |
| status | `/status` | Read-only Pipeline-Übersicht + nächster Schritt |

Artifact-Backend: beans (prefix `PDF-Tool-`). Pipeline: /grill → /plan → /refine → /implement · /review · /test · /doc · /learn · /evolve · /status

**Autonomie:** auto-drive (Stop-Hook) nudged `/learn`+`/refine`, stoppt vor `/implement` (Stufe 1). gate-guard (PreToolUse) blockt destruktives git. Off-Switches: `touch .claude/auto-drive.off` bzw. `.claude/gate-guard.off`.

## Gelernte Regeln (von /evolve)

Aus wiederkehrenden Fehlern verdichtet (je ≥3 Lessons gleicher Ursache). Die
Quell-Lessons stehen als Pointer in `.claude/lessons-learned.md`.

- **Prüfe mit einem Signal, das den Fehler auch finden könnte.** Bevor du etwas
  als verifiziert meldest, benenne den Fehler, den die Prüfung aufdecken würde —
  sieht sie ihn strukturell nicht (Textextraktion für Layout, der eigene Kodierer
  für Formatkonformität, synthetische statt echter Eingaben, ein zu kurzes
  Messfenster), ist sie kein Nachweis. Einen neuen Gegenprüfer erst an einem
  bekannt schlechten Input scheitern lassen.
- **Erst die Auslieferungskette, dann der Code.** Bei „nach dem Deploy immer noch
  kaputt" zuerst belegen, dass wirklich der neue Stand läuft (Service-Worker-Cache,
  nicht neu gestarteter `dotnet run`, altes Image, gepushter vs. deployter Commit).
  Den Code erst danach verdächtigen.
- **Code mit Backslashes oder Sonderzeichen nie durch Shell-Argumente reichen.**
  Skripte und Fragmente mit Regex, Umlauten oder base64 per Write in eine Datei
  schreiben und über den Pfad ausführen — `node -e`, Heredocs und Browser-eval
  verändern den Inhalt still. Vor scripted Edits die Zeilenenden der Zieldatei
  ermitteln, Pfade an native Tools mit Laufwerksbuchstaben übergeben.

<!-- codebase-map:start -->
## Codebase-Blueprint

`docs/blueprints/INDEX.md` beschreibt den Feature-Schnitt dieser Codebase. Damit nur den Code lesen, den eine Aufgabe betrifft:

- Zuerst `INDEX.md` lesen. Über die Pfade im Abschnitt „Zuordnung“ das Ziel-Feature bestimmen und nur dessen `docs/blueprints/<feature>.md` lesen, keine weiteren Feature-Dateien.
- Folgen einer Änderung über die Tabelle „Kanten (geprüft)“ bestimmen: eingehende Kanten zum Ziel-Feature verfolgen, eine zweite Stufe nur über Kanten, deren Spalte „via“ ein geändertes Symbol oder eine geänderte Route nennt. Statt fremder Feature-Dateien die Beleg-Stellen der Kanten öffnen.
- Code nur unter den Pfaden der betroffenen Features öffnen. Breit suchen nur, wenn dort nichts passt.
- „Unberührt“ nur melden, wenn keine Kante irgendeiner Art zum Ziel führt, auch keine HTTP-Kante. Wer eine API über HTTP anspricht (CLI, Web-Client, Partner), ist betroffen, sobald sich das Verhalten hinter dieser API ändert.
- Aussagen darüber, wer etwas aufruft („die UI nutzt Endpoint X“), erst nach einer Suche nach den Aufrufern im Code treffen; dass eine Methode existiert, heißt nicht, dass sie genutzt wird.
- Die Kanten sind maschinell aus dem Code ermittelt. Verhaltensaussagen im Fließtext sind Hinweise; für Verhalten ist der Code maßgeblich, Abweichungen nennen.
- Fehlen „Zuordnung“ oder „Kanten (geprüft)“ (älterer Blueprint), den Blueprint nur zur Orientierung nutzen und Abhängigkeiten im Code prüfen.
- Subagenten, die den Code erkunden, diese Hinweise mitgeben.
- Den Blueprint pflegt der Mod `codebase-map` („aktualisiere den Blueprint“ oder `/codebase-map update`). Dokumentationssprache des Blueprints: Deutsch.

_Dieser Block wird vom Mod `codebase-map` gepflegt und entfernt, sobald dessen CLAUDE.md-Pflege abgeschaltet wird._
<!-- codebase-map:end -->
