# pagebound-pdf-mcp-server

Ein **MCP-Server**, der Pagebounds PDF-Operationen für **LLM-Agenten** bereitstellt
— über **stdio**, also **lokal und ohne Token/Auth**. Es werden dieselben Engines
wie in der Web-App genutzt: **pdf-lib** (Struktur/Manipulation) und **pdfjs-dist**
(Text). Keine nativen Abhängigkeiten, kein Netzwerk: alles läuft lokal auf dem
Dateisystem.

## Tools

Alle schreibenden Tools erzeugen eine **neue** Datei (Eingaben bleiben unangetastet).
Ein- und Ausgaben sind **Dateipfade** (am besten absolut) — so bleiben die
Tool-Ergebnisse klein, statt riesige PDFs als Base64 durch den Kontext zu schieben.

| Tool | Zweck |
|---|---|
| `pdf_info` | Seitenzahl, Titel/Autor, Seitengrößen (read-only) |
| `pdf_extract_text` | Text-Layer extrahieren, optional pro Seitenauswahl (read-only) |
| `pdf_merge` | mehrere PDFs zusammenführen |
| `pdf_extract_pages` | Seiten (in Reihenfolge) in eine neue PDF kopieren — auch zum Splitten |
| `pdf_delete_pages` | Seiten entfernen |
| `pdf_rotate_pages` | Seiten um ±90/180/270° drehen |
| `pdf_reorder_pages` | Seiten neu anordnen |
| `images_to_pdf` | PNG/JPG-Bilder zu einer PDF (eine Seite je Bild) |

Seitenauswahl überall als 1-basierte Angabe: `"1-3,5,8-10"` (Bereiche dürfen
rückwärts laufen, z. B. `"3-1"`).

## Bauen

```bash
cd mcp
npm install
npm run build      # → dist/index.js
npm run smoke      # optionaler Selbsttest aller Operationen
```

## Einbinden (ohne Token)

Der Server spricht JSON-RPC über **stdio** — der Agent startet ihn als
Unterprozess, es gibt **keinen Token und keinen Login**. Er läuft mit den
Dateirechten des Agenten.

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

**Beliebiger MCP-Client:** Befehl `node`, Argument `dist/index.js`, Transport stdio.

### Schnelltest

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | node dist/index.js
```

## Beispiel-Workflow (Agentensicht)

> „Nimm `/docs/a.pdf` und `/docs/b.pdf`, häng sie zusammen, dreh Seite 1 um 90°
> und sag mir, was auf der ersten Seite steht."

1. `pdf_merge({ inputs: ["/docs/a.pdf","/docs/b.pdf"], output: "/docs/ab.pdf" })`
2. `pdf_rotate_pages({ input: "/docs/ab.pdf", pages: "1", degrees: 90, output: "/docs/ab.pdf" })`
3. `pdf_extract_text({ input: "/docs/ab.pdf", pages: "1" })`

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

Der Server liest/schreibt **lokale Dateien**, auf die der Agent ihn zeigt — er
läuft mit dessen Rechten. Kein Netzwerkzugriff, keine Telemetrie. PDF-Parsing
ohne Code-Ausführung (pdf-lib strukturell, pdfjs mit `isEvalSupported:false`).
