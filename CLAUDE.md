# CLAUDE.md — Pagebound

Kontext für Claude-Code-Sessions in diesem Projekt (Repo-Ordner: `PDF-Tool`, Produkt: **Pagebound**).

## Projektkontext

- **Stack:** Blazor WebAssembly (.NET 10), datenschutzfreundlicher PDF-Reader/-Editor als statische Offline-PWA. Rendering via PDF.js (JS-Interop), Manipulation via pdf-lib (JS), Verschlüsselung AES-256/R6 via WebCrypto, OCR via Tesseract.js (self-hosted). PLUS separates TypeScript-MCP-Paket unter `mcp/` (29 Tools, stdio + Streamable HTTP). Apache 2.0.
- **Einstiegspunkte:** `src/Pagebound.Web/Program.cs` (23 Services hinter IXxx, DI); `mcp/src/index.ts` (MCP-Server, „reuses the same engines").
- **Struktur:** `src/Pagebound.Core/` (Domain/Crypto/Library/Abstractions), `src/Pagebound.Infrastructure/`, `src/Pagebound.Web/` (Blazor-UI — u.a. God-Components `ReaderPane.razor` ~4375 Z., `DesignerPage.razor` ~2635 Z.), `mcp/` (TS-Paket), `tests/`, `infra/` (Docker/nginx), `tools/` (privacy-check.mjs), `docs/` (ADRs), `SECURITY.md`.
- **Tests:** xUnit in `tests/`, run: `dotnet test Pagebound.slnx`. 168 Unit-Tests (fast nur `Pagebound.Core`), 3 self-skipping E2E-Smokes. **`Pagebound.Web.Tests` ist eine leere Hülle → die ~11k-LOC-UI-Schicht ist ungetestet.**
- **Build:** `dotnet build Pagebound.slnx` (mcp/ separat via `npm` unter `mcp/`).
- **Style-Regeln:** Interface-First-DI (Core/Abstractions→Infrastructure); self-hosted (kein CDN); managed Krypto statt WASM-inkompatibler Libs (ADR-004).
- **Deploy:** statische Offline-PWA (Docker + nginx, `infra/`), self-hosted/manuell. Push/Merge/Deploy bleibt manuell.
- **Kritische Bereiche:** (1) WASM-Speicher & Rendering (base64-Round-Trips, keine Virtualisierung → OOM bei großen PDFs); (2) Datenschutz/Client-only-Zusage (externe Requests? SECURITY.md-Drift vs. Code); (3) mcp/ Node-Package; (4) Krypto (AES-256/R6 via WebCrypto).
- **Off-Limits:** Datenschutz-Garantie & `privacy-check.mjs` (kein externer Request/CDN/Telemetrie); Krypto-Layer (managed AES-256/R6); Interface-First-DI-Struktur — nie ohne ausdrückliche Erlaubnis ändern.
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

Factory generiert von `/factory-init` — 2026-07-04.

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
