# MCP-Server

## Zweck

Ein eigenständiges Node-Paket (`pagebound-pdf-mcp-server`, Fassung 2.1.0) unter `mcp/`, das die PDF-Fähigkeiten von Pagebound als MCP-Werkzeuge für LLM-Agenten anbietet — lokal über stdio oder gehostet über Streamable HTTP. **30 registrierte Werkzeuge.** Es teilt **keinen Quelltext** mit der Web-App: es spiegelt deren Funktionen mit denselben npm-Bibliotheken in Node. Das ist der Preis dafür, dass die PWA ohne Node läuft — und der Grund, warum beide Seiten auseinanderlaufen können.

## Dateien

| Pfad | Rolle |
|------|-------|
| `mcp/src/index.ts` | Start, Werkzeug-Registrierung (30 Aufrufe von `registerTool`, `:182`–`:848`), stdio- und Streamable-HTTP-Transport über Express (`POST /mcp`) |
| `mcp/src/pdf.ts` | PDF-Kernoperationen: Info, Text, Tabellen, Zusammenfügen, Teilen, Seiten, Stempel, Formulare, Unterschiede, Metadaten |
| `mcp/src/encrypt.ts` | AES-256; der Kopfkommentar (`:3`) benennt sein Gegenstück in der PWA |
| `mcp/src/sign.ts` | Signatur mit P12-Zertifikat über node-forge; Gegenstück benannt (`:34`) |
| `mcp/src/pdfa.ts` | PDF/A-Konvertierung; Gegenstück benannt (`:32`) |
| `mcp/src/pdfua.ts` | PDF/UA-Vorbereitung; Gegenstück benannt (`:19`) |
| `mcp/src/ocr.ts` | Texterkennung; Gegenstück benannt (`:4`) |
| `mcp/src/design.ts` | Designer-Werkzeuge: Katalog, Erzeugen, Prüfen, HTML-Ausgabe |
| `mcp/src/design-pdf.ts` | PDF-Ausgabe der Designs mit pdf-lib und fontkit |
| `mcp/src/mind.ts` | Mindmaps für die Designer-Ausgaben |
| `mcp/src/smoke.ts` | Selbstprüfung (`npm run smoke`), deckt jedes Werkzeug ab |
| `mcp/testdata/` | Eingaben für die Selbstprüfung |
| `mcp/Dockerfile` | Eigenes Abbild, in der CI nach GHCR veröffentlicht (`publish-image.yml:59`) |
| `mcp/package.json` | Paket-Manifest: Name (`:2`), Fassung 2.1.0 (`:3`), `bin` (`:7`) |
| `src/Pagebound.Web/tests-js/repo-meta.test.mjs` | Prüft Angaben über das Repo, darunter die Paketdaten |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Interop-Hilfen (UI)** (Querschnitt, via `save`, `load`, `register`): **Namensgleichheit, keine Abhängigkeit.** `mcp/src/design-pdf.ts:975` nutzt pdf-lib und fontkit; die Brücken der Web-App exportieren Funktionen mit denselben kurzen Namen. Siehe die Anmerkung in [`./INDEX.md`](./INDEX.md).

Das MCP-Paket hat **keine** echte ausgehende Kante in die Web-App. Die Verwandtschaft zu Designer, PDF-Werkzeugen, Formularen und Signatur ist eine **fachliche Entsprechung**, keine Abhängigkeit im Code — siehe „Offene Fragen".

### Extern (Packages)

- `@modelcontextprotocol/sdk` — MCP-Server, stdio- und Streamable-HTTP-Transport
- `express` v5 — HTTP-Betrieb (`POST /mcp`)
- `zod` — Eingabeschemata der Werkzeuge
- `pdf-lib` plus `@pdf-lib/fontkit` — Erzeugung und Manipulation, Schrifteinbettung
- `pdfjs-dist` — Text- und Strukturextraktion
- `fflate` — ZIP für den DOCX-Export (OOXML von Hand, wie in der Web-App)
- `node-forge` — P12/PKCS#12-Signatur
- Node ≥ 22

## Öffentliche API / Interface

Die 30 Werkzeuge, mit ihrer Zeile in `mcp/src/index.ts`:

| Kategorie | Werkzeuge |
|-----------|-----------|
| Analyse | `pdf_info` (`:182`), `pdf_extract_text` (`:194`), `pdf_ocr` (`:220`), `pdf_extract_tables` (`:256`), `pdf_diff` (`:472`) |
| Konvertierung | `pdf_to_docx` (`:270`), `pdf_to_pdfa` (`:561`), `pdf_ua_prepare` (`:633`) |
| Bearbeiten | `pdf_edit_text` (`:281`) |
| Seiten | `pdf_merge` (`:303`), `pdf_extract_pages` (`:319`), `pdf_delete_pages` (`:330`), `pdf_rotate_pages` (`:341`), `pdf_reorder_pages` (`:352`), `images_to_pdf` (`:363`), `pdf_split` (`:380`) |
| Gestaltung | `pdf_stamp` (`:397`) |
| Sicherheit | `pdf_encrypt` (`:423`), `pdf_sign` (`:649`) |
| Formulare | `pdf_form_fields` (`:440`), `pdf_fill_form` (`:451`), `pdf_create_field` (`:525`) |
| Metadaten | `pdf_set_metadata` (`:505`) |
| Designer | `design_catalog` (`:711`), `design_create` (`:722`), `design_validate` (`:743`), `design_merge_data` (`:779`), `design_render_html` (`:808`), `design_render_pdf` (`:823`), `design_render_interactive_html` (`:848`) |

**Zwei Zusagen gegenüber Aufrufern, seit Fassung 2.0.0 — Vertrag, nicht Kür:**

1. **Reproduzierbare Ausgabe.** Gleiche Eingabe ergibt ein byte-gleiches PDF: keine Systemuhr, keine Zufalls-Kennungen. Wer hier eine Zeitangabe oder eine zufällige Id einbaut, bricht den Vertrag.
2. **Stabile Fehlerkennungen.** Jeder Fehler trägt ein `code`, auf das Aufrufer sich verlassen können.

Start: `node dist/index.js` für stdio; im HTTP-Betrieb `POST /mcp`, zustandslos (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), damit sich der Dienst waagerecht vervielfachen lässt.

## Datenfluss / Call-Flow

1. **stdio (lokal):** der MCP-Client startet das Binary, `server.connect(new StdioServerTransport())`, Aufrufe laufen über stdin und stdout.
2. **Streamable HTTP (gehostet):** Express nimmt `POST /mcp`; **pro Anfrage** entstehen ein frischer Server und ein frischer Transport — keine Sitzungen.
3. **Ausführung:** zod prüft die Eingabe (PDF-Bytes in der Regel base64) → das passende Modul arbeitet mit pdf-lib, pdfjs-dist oder node-forge → Ergebnis als Bytes, JSON oder HTML zurück.
4. **Designer:** `design_create` und `design_validate` arbeiten auf dem Design-JSON; `design_render_html`, `design_render_pdf` und `design_render_interactive_html` erzeugen die Ausgaben, Mindmaps über `mind.ts`.
5. **Selbstprüfung:** `npm run smoke` unter `mcp/` deckt jedes Werkzeug ab und läuft gegen die Eingaben in `mcp/testdata/`.

## Offene Fragen / TODOs

- **Das Paket teilt keinen Quelltext mit der Web-App.** Dieselbe Funktion existiert zweimal: einmal in TypeScript für Node, einmal in TypeScript für den Browser mit C#-Hülle. Beide können auseinanderlaufen, und nichts prüft das maschinell. Die Kopfkommentare in `encrypt.ts:3`, `pdfa.ts:32`, `pdfua.ts:19`, `sign.ts:34` und `ocr.ts:4` benennen jeweils ihr Gegenstück in der PWA — das ist die einzige Verbindung, und sie ist Prosa.
- Zwei Kanten im geprüften Graph zeigen aus der Web-App hierher (`pdf-manipulator-bridge.ts:1032`, `sign-bridge.ts:522`, beide via `catalog`). Beide sind **geprüft falsch**: es sind Zugriffe auf `doc.catalog` von pdf-lib, nicht auf `catalog()` aus `design.ts`. Siehe die Anmerkung in [`./INDEX.md`](./INDEX.md).
- Dieser Blueprint nannte früher 27 Werkzeuge und ließ `pdf_ocr`, `design_merge_data` und `design_render_pdf` aus. Es sind 30 (`grep -c 'registerTool("' mcp/src/index.ts`).
