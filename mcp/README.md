# pagebound-pdf-mcp-server

Ein **MCP-Server**, der Pagebounds PDF-Operationen für **LLM-Agenten** bereitstellt
— **tokenlos**, über zwei Transporte:

- **stdio** (Default) — lokaler Unterprozess, bequem mit **Datei-Pfaden**.
- **Streamable HTTP** (`MCP_TRANSPORT=http`) — der **gehostete**, „releaste" Endpunkt
  unter `…/mcp`; **tokenlos, aber mit Größen-/Seiten-Limits**. I/O als **base64**.

Es werden dieselben Engines wie in der Web-App genutzt: **pdf-lib** (Struktur/
Manipulation) und **pdfjs-dist** (Text). Keine nativen Abhängigkeiten, kein
Netzwerkzugriff während der Verarbeitung.

## Gehosteter Endpunkt (tokenlos + Limits)

```
https://pagebound.app.lupusmalus.dev/mcp
```

Streamable HTTP, **kein Token/Login**. Schutzschranken statt Auth:

- max. **25 MB** pro PDF/Bild (`MCP_MAX_PDF_BYTES`),
- max. **1000 Seiten** pro Dokument (`MCP_MAX_PAGES`),
- HTTP-Body-Limit ~40 MB.

Im HTTP-Modus gibt es **kein Dateisystem**: Eingaben kommen als `dataBase64`
(bzw. `dataBase64List` / `imagesBase64`), Ergebnisse kommen als `dataBase64`
zurück. `path`/`outputPath` sind dem lokalen stdio-Betrieb vorbehalten.

## Tools

Jedes Tool nimmt die Eingabe **entweder** als lokalen `path` **oder** inline als
`dataBase64`. Schreibende Tools geben das Ergebnis nach `outputPath` (geschrieben,
gibt den Pfad zurück) **oder** — wenn `outputPath` fehlt — als `dataBase64` zurück.
Eingaben bleiben stets unangetastet (neue Datei/neue Bytes).

| Tool | Zweck |
|---|---|
| `pdf_info` | Seitenzahl, Titel/Autor, Seitengrößen (read-only) |
| `pdf_extract_text` | Text-Layer extrahieren, optional pro Seitenauswahl (read-only) |
| `pdf_merge` | mehrere PDFs zusammenführen (`paths` / `dataBase64List`) |
| `pdf_extract_pages` | Seiten (in Reihenfolge) in eine neue PDF kopieren — auch zum Splitten |
| `pdf_delete_pages` | Seiten entfernen |
| `pdf_rotate_pages` | Seiten um ±90/180/270° drehen |
| `pdf_reorder_pages` | Seiten neu anordnen |
| `images_to_pdf` | PNG/JPG-Bilder zu einer PDF (`imagePaths` / `imagesBase64`) |

Seitenauswahl überall als 1-basierte Angabe: `"1-3,5,8-10"` (Bereiche dürfen
rückwärts laufen, z. B. `"3-1"`).

## Bauen

```bash
cd mcp
npm install
npm run build      # → dist/index.js
npm run smoke      # optionaler Selbsttest aller Operationen
```

## Lokal einbinden (stdio, ohne Token)

Der Server spricht JSON-RPC über **stdio** — der Agent startet ihn als
Unterprozess, **kein Token, kein Login**. Er läuft mit den Dateirechten des Agenten,
daher sind hier `path`/`outputPath` praktisch.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pagebound-pdf": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/zu/Pagebound/mcp/dist/index.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add pagebound-pdf -- node /ABSOLUTER/PFAD/zu/Pagebound/mcp/dist/index.js
```

### Schnelltest (stdio)

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | node dist/index.js
```

## Remote einbinden (HTTP)

Den gehosteten Endpunkt als Streamable-HTTP-Server eintragen:

```bash
claude mcp add --transport http pagebound-pdf https://pagebound.app.lupusmalus.dev/mcp
```

Oder selbst hosten:

```bash
MCP_TRANSPORT=http PORT=3000 node dist/index.js
# → POST http://127.0.0.1:3000/mcp   (Health: GET /healthz)
```

### Schnelltest (HTTP)

```bash
curl -s https://pagebound.app.lupusmalus.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Beispiel-Workflow (Agentensicht, lokal/stdio)

> „Nimm `/docs/a.pdf` und `/docs/b.pdf`, häng sie zusammen, dreh Seite 1 um 90°
> und sag mir, was auf der ersten Seite steht."

1. `pdf_merge({ paths: ["/docs/a.pdf","/docs/b.pdf"], outputPath: "/docs/ab.pdf" })`
2. `pdf_rotate_pages({ path: "/docs/ab.pdf", pages: "1", degrees: 90, outputPath: "/docs/ab.pdf" })`
3. `pdf_extract_text({ path: "/docs/ab.pdf", pages: "1" })`

Remote dasselbe mit `dataBase64`/`dataBase64List` statt `path`/`paths` und ohne
`outputPath` (Ergebnis kommt als `dataBase64` zurück).

## Grenzen (bewusst)

- **Kein OCR** — `pdf_extract_text` liest den vorhandenen Text-Layer (gut für
  „echte" Text-PDFs, nicht für reine Scans). OCR (Tesseract) liefe nur mit
  zusätzlichem Modell-Download und ist hier nicht enthalten.
- **Keine Verschlüsselung / kein Rendern zu PNG** — beides braucht in der Web-App
  WebCrypto bzw. eine Canvas; im Server wären das größere Zusatz­abhängigkeiten.
  Mögliche Erweiterungen, aktuell ausgelassen, um den Server schlank & nativ-frei
  zu halten.
- Passwortgeschützte PDFs werden mit klarer Meldung abgelehnt (zuerst entschlüsseln).

## Sicherheit

- **stdio:** liest/schreibt **lokale Dateien**, auf die der Agent ihn zeigt — läuft
  mit dessen Rechten. Kein Netzwerk, keine Telemetrie.
- **HTTP (gehostet):** **kein Dateisystem** (nur base64-I/O), **tokenlos + Limits**
  (Größe/Seiten/Body). Container läuft als non-root mit read-only Rootfs und
  `no-new-privileges`. Stateless JSON — pro Request ein frischer Server.
- PDF-Parsing ohne Code-Ausführung (pdf-lib strukturell, pdfjs mit
  `isEvalSupported:false`).
