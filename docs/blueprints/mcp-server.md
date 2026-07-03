# MCP-Server

## Zweck

Eigenständiges Node.js-Paket (`pagebound-pdf-mcp-server`) unter `mcp/`, das die PDF-Operationen von Pagebound als MCP-Tools für LLM-Agents bereitstellt — lokal über stdio oder gehostet über Streamable HTTP (stateless, pro Request frischer Server + Transport). 25 registrierte Tools, u. a. Info/Textextraktion/Tabellen, Seiten-Manipulation (merge, split, extract, delete, rotate, reorder), Stempel/Wasserzeichen, AES-256-Verschlüsselung, AcroForm lesen/füllen/Felder anlegen, Text-Diff, Metadaten, PDF/A-Konvertierung, PDF/UA-Vorbereitung, P12-Signatur sowie Designer-Tools (Katalog, Erstellen, Validieren, HTML-Render inkl. interaktivem Render). Nutzt dieselben Engines wie die Web-App (pdf-lib + pdfjs-dist + WebCrypto), tokenless.

## Dateien

| Pfad | Rolle |
|------|-------|
| `mcp/src/index.ts` | Server-Bootstrap, Tool-Registrierung, stdio- + Streamable-HTTP-Transport (Express, `POST /mcp`) |
| `mcp/src/pdf.ts` | PDF-Kernoperationen (Info, Text, Merge, Split, Seiten, Stempel, Formulare, Diff, Metadaten) |
| `mcp/src/encrypt.ts` | AES-256-Verschlüsselung |
| `mcp/src/sign.ts` | Digitale Signatur mit P12-Zertifikat (node-forge) |
| `mcp/src/pdfa.ts` | PDF/A-Konvertierung |
| `mcp/src/pdfua.ts` | PDF/UA-Vorbereitung (Barrierefreiheit) |
| `mcp/src/design.ts` | Designer-Tools: Katalog, Create, Validate, HTML-Render |
| `mcp/src/mind.ts` | Mindmap-Unterstützung für Designer-Renderings |
| `mcp/src/smoke.ts` | Smoke-Test (`npm run smoke`) |
| `mcp/package.json` | Paket-Manifest (`bin: pagebound-pdf-mcp-server`, Node >= 22) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **WYSIWYG-Designer** — die `design_*`-Tools spiegeln das Designer-Dokumentmodell (Templates, Themes, Mindmaps) für Agents. Siehe [`./designer.md`](./designer.md).
- **PDF-Werkzeuge** — funktionale Entsprechung der Web-App-Werkzeuge (merge/split/rotate/…), gleiche Engine-Basis. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Formulare** — AcroForm-Tools (`pdf_form_fields`, `pdf_fill_form`, `pdf_create_field`). Siehe [`./formulare.md`](./formulare.md).
- **Signatur & Integrität** — `pdf_sign` als serverseitiges Pendant zur Signatur-Funktion. Siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).

*(Kein Code-Sharing mit den C#-Projekten — der MCP-Server ist ein separates TypeScript-Paket, das dieselben JS-Engines nutzt.)*

### Extern (Packages)

- `@modelcontextprotocol/sdk` — MCP-Server, stdio- + Streamable-HTTP-Transport
- `express` v5 — HTTP-Hosting (`POST /mcp`)
- `zod` — Tool-Input-Schemas
- `pdf-lib` + `@pdf-lib/fontkit` — PDF-Erzeugung/-Manipulation, Font-Einbettung
- `pdfjs-dist` — Text-/Struktur-Extraktion
- `node-forge` — P12/PKCS#12-Signatur

## Öffentliche API / Interface

Registrierte Tools (aus `mcp/src/index.ts`):

| Kategorie | Tools |
|-----------|-------|
| Analyse | `pdf_info`, `pdf_extract_text`, `pdf_extract_tables`, `pdf_diff` |
| Seiten | `pdf_merge`, `pdf_split`, `pdf_extract_pages`, `pdf_delete_pages`, `pdf_rotate_pages`, `pdf_reorder_pages`, `images_to_pdf` |
| Gestaltung | `pdf_stamp` (Wasserzeichen/Seitenzahlen) |
| Sicherheit | `pdf_encrypt` (AES-256), `pdf_sign` (P12) |
| Formulare | `pdf_form_fields`, `pdf_fill_form`, `pdf_create_field` |
| Metadaten/Standards | `pdf_set_metadata`, `pdf_to_pdfa`, `pdf_ua_prepare` |
| Designer | `design_catalog`, `design_create`, `design_validate`, `design_render_html`, `design_render_interactive_html` |

Start: `node dist/index.js` (stdio) bzw. HTTP-Modus mit `app.listen(port)` auf `POST /mcp` (stateless, JSON-Response aktiviert, Body-Limit konfiguriert).

## Datenfluss / Call-Flow

1. **stdio (lokal):** MCP-Client (z. B. Claude Code) startet das Binary → `server.connect(new StdioServerTransport())` → Tool-Calls über stdin/stdout.
2. **Streamable HTTP (gehostet):** Express nimmt `POST /mcp` entgegen; pro Request werden frischer Server + `StreamableHTTPServerTransport` erzeugt (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) — keine Sessions, horizontal skalierbar.
3. **Tool-Ausführung:** Zod validiert die Inputs (PDF-Bytes i. d. R. Base64) → Modul (`pdf.ts`, `sign.ts`, `design.ts`, …) führt die Operation mit pdf-lib/pdfjs-dist/node-forge aus → Ergebnis (Bytes/JSON/HTML) zurück an den Agent.
4. **Designer-Flow:** `design_create`/`design_validate` arbeiten auf dem Design-JSON-Schema; `design_render_html` bzw. `design_render_interactive_html` erzeugen (interaktives) HTML inkl. Mindmap-Rendering aus `mind.ts`.
