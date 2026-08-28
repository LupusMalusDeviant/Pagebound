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
- HTTP-Body-Limit: **aus dem Größenlimit abgeleitet** (base64 bläht um 4/3 auf,
  plus Rahmen) — bei 25 MB sind das 42 MB. Nicht separat gepflegt, damit die
  beiden Zahlen nicht wieder auseinanderlaufen.

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
| `pdf_extract_text` | Text-Layer extrahieren, optional pro Seitenauswahl; meldet mit `charsPerPage`/`pagesWithoutText`, wie ergiebig die Ebene war (read-only) |
| `pdf_ocr` | **Gescannte** Seiten per OCR lesen (Tesseract, kopflos — kein Browser, kein Canvas, kein Netz). Liefert Text **plus Konfidenz** je Seite, optional Wort-Koordinaten. Mitgeliefert sind `deu` und `eng`. **Kein** automatischer Rückfall aus `pdf_extract_text` — OCR ist um Größenordnungen teurer (read-only) |
| `pdf_to_docx` | PDF → **Word (DOCX)**: Best-Effort-Textfluss (Absätze rekonstruiert, Schriftgröße abgeleitet, Seitenumbruch je Seite), **keine** 1:1-Layout-Treue, kein OCR |
| `pdf_diff` | Text zweier PDFs seitenweise vergleichen — Versionsänderungen finden (read-only) |
| `pdf_merge` | mehrere PDFs zusammenführen (`paths` / `dataBase64List`) |
| `pdf_extract_pages` | Seiten (in Reihenfolge) in eine neue PDF kopieren |
| `pdf_split` | PDF an Schnittpunkten (`afterPages`) in **mehrere** Teil-PDFs aufteilen |
| `pdf_delete_pages` | Seiten entfernen |
| `pdf_rotate_pages` | Seiten um ±90/180/270° drehen |
| `pdf_reorder_pages` | Seiten neu anordnen |
| `pdf_stamp` | Wasserzeichen (diagonal) und/oder Seitenzahlen/Bates aufstempeln |
| `pdf_edit_text` | Text **suchen & ersetzen** (Cover + Redraw, Helvetica, kein Reflow); Alt-Text bleibt technisch extrahierbar → für garantierte Entfernung schwärzen |
| `pdf_encrypt` | PDF mit **Passwort** schützen (AES-256, ISO 32000-2 R6) |
| `pdf_form_fields` | AcroForm-Felder auflisten (Werte, Optionen, Seitenzahl; read-only) |
| `pdf_fill_form` | Formularfelder ausfüllen, optional **flatten** (einbrennen) |
| `pdf_create_field` | AcroForm-Felder (Text/Checkbox) **anlegen** — Einstieg Formular-Erstellung |
| `pdf_set_metadata` | Metadaten setzen (Titel/Autor/Betreff/Schlagwörter/Ersteller/Producer) |
| `pdf_to_pdfa` | PDF Richtung **PDF/A-2b oder -3b** (Best Effort: XMP, sRGB-OutputIntent, Aufräumen; mit `part: 3` lassen sich Dateien **einbetten** — E-Rechnung: `attachments` + `facturX` schreiben ZUGFeRD/Factur-X-Kennzeichnung samt Extension-Schema; `embedFonts` (Default an) ersetzt nicht eingebettete Standard-14-Fonts (Helvetica/Times/Courier) durch eingebettete **Liberation**-Fonts (metrisch kompatibel, SIL OFL 1.1, `mcp/fonts/`); übrige nicht eingebettete Fonts nur als `warnings` — **keine Konformitätsgarantie**) |
| `pdf_ua_prepare` | PDF Richtung **PDF/UA-1** vorbereiten: Kennzeichnung (`/MarkInfo`, `/Lang`, `/DisplayDocTitle`, XMP `pdfuaid:part=1`) + ehrlicher Prüfbericht (fehlendes Tagging/StructTreeRoot, Titel, Bilder ohne `/Alt`, Fonts ohne ToUnicode) — echtes Tagging wird **nicht** synthetisiert, **keine Konformitätsgarantie** |
| `pdf_sign` | PDF mit **P12/PFX-Zertifikat** signieren: **PAdES-B-B** (`ETSI.CAdES.detached`, SHA-256, DER-sortierte Attribute inkl. `signingCertificateV2`, Kette eingebettet). Erneutes Signieren hängt ein **inkrementelles Update** an, die bestehende Signatur bleibt gültig. **Kein** Zeitstempel (also nicht B-T), **kein** LTV |
| `images_to_pdf` | PNG/JPG-Bilder zu einer PDF (`imagePaths` / `imagesBase64`) |
| `design_catalog` | Designer-Bausteine auflisten: Themes, Schriften, Layouts, Vorlagen (inkl. `mindmap`) (read-only) |
| `design_create` | Pagebound-Design (`*.pbdesign.json`) aus Vorlage erzeugen — Titel/Theme/Layout überschreibbar; inkl. Mindmap-Blöcke (Knoten-Baum) |
| `design_validate` | Design-JSON validieren/normalisieren (Farben, data-URLs, HTML, Mindmap-Baum); meldet `issues` (read-only) |
| `design_merge_data` | Vorlage mit einem JSON-Objekt füllen: {{platzhalter}}, bedingte Blöcke (`when`/`unless`), Wiederholungen (`repeat`); fehlende Werte werden gemeldet statt still übergangen (read-only) |
| `design_render_html` | Design als eigenständiges HTML rendern (Druck-CSS → „Als PDF speichern“); Mindmaps als Vektor-SVG (read-only) |
| `design_render_pdf` | Design direkt als **PDF** rendern — serverseitig, **ohne Browser**; Schriften eingebettet, byte-gleich reproduzierbar, Tabellen brechen mit wiederholter Kopfzeile um |
| `design_render_interactive_html` | Dynamische HTML-Präsentation: Folien-Deck mit Navigation (Pfeiltasten); Mindmaps als Vektor-SVG (read-only) |

Damit deckt der Server die PDF-Operationen der Web-App ab, die ohne Browser-
Canvas auskommen — Seiten-Werkzeuge (Merge/Split/Extract/Delete/Rotate/Reorder),
Stempeln, Verschlüsseln, Bilder→PDF, Formulare und Text-Extraktion — sowie die
Dokument-Seite des WYSIWYG-Designers: Die `design_*`-Tools sprechen dasselbe
JSON-Format wie der Design-Ordner/JSON-Import der PWA, Agenten können Designs
also erzeugen, prüfen, mit Daten füllen und als HTML **oder direkt als PDF**
ausgeben — Letzteres ohne Browser, für Hintergrundprozesse.

`pdf_split` schreibt mit `outputDir` die Teile als `<baseName>-partN.pdf` (stdio)
oder liefert sie als `parts[].dataBase64` (remote).

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

## Vorlagen mit Daten füllen

Für Dokumente, die ein Programm im Hintergrund erzeugt — Rechnungen,
Bestätigungen, Serienbriefe. Drei Bausteine, alle im Designmodell statt in
einer eigenen Sprache:

| Baustein | Wo | Wirkung |
|---|---|---|
| `{{pfad.zum.wert}}` | in Texten, Tabellenzellen, Spalten, `src` | Wert einsetzen; verschachtelt, Listenindex als Zahl |
| `when` / `unless` | Block-Feld | Block nur ausgeben, wenn ein Datenpfad einen Wert hat bzw. keinen |
| `repeat` | Block-Feld | Datenpfad einer Liste: Tabellenzeile bzw. Block je Eintrag |

Bei einer Tabelle mit `repeat` ist die Zeile **nach** der Kopfzeile die
Schablone; alle weiteren Zeilen sind Fußzeilen und erscheinen einmal. In der
Schablone greifen Platzhalter zuerst auf den Listeneintrag zu und erst dann auf
das Wurzelobjekt; `{{index}}` ist die laufende Nummer ab 1.

```jsonc
// Auszug aus der Vorlage (design_create --kind invoice-data)
{ "type": "Table", "repeat": "positionen", "unless": "kleinunternehmer",
  "rows": [["Pos.", "Menge", "Bezeichnung", "Einzelpreis", "USt.", "Netto"],
           ["{{index}}", "{{menge}}", "{{bezeichnung}}", "{{einzelpreis}}", "{{steuersatz}}", "{{betrag}}"]] }
```

```jsonc
// … und die Daten dazu
{ "kleinunternehmer": false,
  "kunde": { "name": "Kundenname GmbH", "ort": "Kundenstadt" },
  "positionen": [{ "menge": "3", "bezeichnung": "Beratung", "einzelpreis": "95,00 €",
                   "steuersatz": "19 %", "betrag": "285,00 €" }] }
```

`design_render_pdf` und `design_merge_data` nehmen beide ein `data`-Objekt —
für ein fertiges PDF genügt also **ein** Aufruf.

**Fehlende Werte sind ein Fehler, kein Gestaltungsmittel.** Ein Platzhalter ohne
Wert bleibt nicht still leer: `onMissing: "error"` (Default) bricht ab und nennt
jeden fehlenden Platzhalter mit Fundort, `onMissing: "report"` füllt und liefert
die Lücken als `missing` zurück. Als fehlend gilt auch ein leerer Text — ein
Feld, das entfallen darf, gehört in einen `when`-Block.

Werte werden beim Einsetzen **HTML-maskiert**: ein Kundenname mit `<` zerlegt
das Dokument nicht. Auszeichnung gehört in die Vorlage, nicht in die Daten.

`design_validate` meldet unter `placeholders`, welche Platzhalter eine Vorlage
erwartet.

### Rechnungsvorlage

`design_create` mit `kind: "invoice-data"` liefert eine Rechnung mit allen
Pflichtangaben nach **§ 14 UStG** und **beiden** Umsatzsteuer-Fällen in *einem*
Dokument, gesteuert über den Wert `kleinunternehmer`:

- **wahr** — keine Steuerspalte, keine Steuersummen, dafür der Pflichthinweis
  auf § 19 UStG.
- **falsch** — Steuersatz je Position, Summen je Steuersatz, Gesamtbetrag brutto.

Zwei Vorlagen wären zwei Dinge, die auseinanderlaufen; hier ist es eine.

## Fehlervertrag

Jeder Fehler trägt eine **stabile Kennung**, damit Aufrufer reagieren können,
ohne deutsche Fehlertexte zu parsen. Die Kennung steht im `structuredContent`
(`{ error: { code, message } }`) **und** im Text (`Fehler [CODE]: …`).

| Code | Bedeutung | Wer muss handeln |
|---|---|---|
| `INVALID_INPUT` | Parameter fehlen, widersprechen sich oder sind ungültig | Aufrufer |
| `INPUT_TOO_LARGE` | Eingabe über dem Größenlimit des Servers | Aufrufer |
| `PAGE_LIMIT` | Eingabe über dem Seitenlimit des Servers | Aufrufer |
| `PDF_CORRUPT` | Keine gültige PDF / unlesbare Struktur | Nutzer (Datei) |
| `PDF_ENCRYPTED` | Eingabe ist passwortgeschützt — erst entschlüsseln | Nutzer |
| `CERT_PASSWORD` | P12/PFX ließ sich nicht öffnen (Passwort oder Datei) | Nutzer |
| `CERT_INVALID` | P12/PFX ohne nutzbaren Schlüssel oder Zertifikat | Nutzer |
| `FILE_READ` | Lokale Datei nicht lesbar (nur stdio) | Betrieb |
| `FILE_WRITE` | Lokale Ausgabe nicht schreibbar (nur stdio) | Betrieb |
| `UNSUPPORTED` | Fall ist gültig, aber von diesem Server nicht abgedeckt | Aufrufer |
| `PROCESSING_FAILED` | Operation an diesem Dokument fehlgeschlagen | Nutzer/Betrieb |
| `INTERNAL` | Fehler in Pagebound selbst | Betrieb (bitte melden) |

Ein zu großer HTTP-Body wird ebenfalls sauber gemeldet: HTTP **413** mit
`error.data.code = "INPUT_TOO_LARGE"` statt einer Express-Standardseite.

## Version

`serverInfo.version` (und `/healthz`) melden die Version aus der `package.json`
— eine Quelle, kein zweiter Wert im Code. **Jede Verhaltensänderung bekommt
eine neue Version**, damit Aufrufer darauf pinnen können:

- **Major** — geändertes Verhalten bei gleichem Aufruf (andere Bytes, andere
  Fehlerform, strengere Prüfung).
- **Minor** — neue Werkzeuge oder neue optionale Parameter.
- **Patch** — Korrekturen ohne sichtbare Verhaltensänderung.

## Reproduzierbare Ausgabe

Derselbe Aufruf mit denselben Daten erzeugt **dasselbe PDF, Byte für Byte**.
Wer erzeugte Dokumente in eine Hash-Kette hängt, kann sich darauf verlassen.

Konkret heißt das:

- Das Info-Dict wird **nie automatisch** angefasst. pdf-lib schreibt beim Laden
  und beim Erzeugen ungefragt `/ModDate` und `/Producer` mit der aktuellen
  Uhrzeit — das ist überall abgeschaltet (`NO_METADATA_BUMP`).
- Die Trailer-`/ID` wird bei `pdf_to_pdfa` **aus dem Inhalt abgeleitet**
  (SHA-256 über Eingabe + Parameter), nicht aus dem Zufallsgenerator.
- Es wird **kein Datum erfunden**. Fehlt im Dokument ein Erstellungsdatum,
  bleibt auch das XMP datumslos (mit Hinweis in `warnings`). Wer eines braucht,
  gibt es mit: `pdf_to_pdfa` nimmt `documentDate` (ISO 8601) und schreibt es in
  Info-Dict **und** XMP.
- Der DOCX-Export nutzt eine feste ZIP-Zeit statt der Systemuhr.
- Metadaten setzt man ausdrücklich über `pdf_set_metadata`.

**Zwei bewusste Ausnahmen**, beide kryptographisch bedingt:

- `pdf_encrypt` — Dateischlüssel, IVs und Datei-`/ID` sind Zufall und müssen es
  sein.
- `pdf_sign` — Signaturzeitpunkt und CMS-Container variieren naturgemäß.

Abgesichert ist das durch Determinismus-Prüfungen im Smoke-Test
(`npm run smoke`): jedes schreibende Werkzeug wird zweimal aufgerufen und die
Bytes verglichen.

## Grenzen (bewusst)

Was die Web-App per **Browser-Canvas** macht, bleibt ausgelassen, um den Server
schlank & **nativ-frei** zu halten (keine native Canvas-/Tesseract-Abhängigkeit):

- **OCR ist jetzt dabei** (`pdf_ocr`, seit 2.1.0) — und zwar ohne dass die Regel
  fällt: eine gescannte Seite besteht fast immer aus **einem Bild**, das pdfjs in
  reinem JS dekodiert (Flate, JPEG, CCITT, JBIG2, JPX). Gerastert wird nichts,
  also braucht es kein Canvas. Die Sprachdaten liegen unter `mcp/tessdata/` und
  werden lokal geladen — der Server holt nichts aus dem Netz nach.
  `pdf_extract_text` bleibt für PDFs **mit** Text-Layer die richtige und um
  Größenordnungen billigere Wahl; einen automatischen Rückfall gibt es bewusst
  nicht.
- **Kein OCR für Handschrift**, und je Seite wird nur das **größte** Bild gelesen —
  Scans, die in mehrere Bildstreifen zerlegt sind, werden dadurch nur teilweise
  erfasst (das meldet `warnings`).
- **Kein Rendern zu PNG/JPG, kein Komprimieren, keine Redaktion** — diese
  Operationen rasterisieren Seiten (in der Web-App via Canvas); das ist hier
  nicht enthalten.
- **Verschlüsselung ist jetzt dabei** (`pdf_encrypt`, AES-256 über Node-WebCrypto).
  Passwortgeschützte **Eingabe**-PDFs werden weiterhin mit klarer Meldung
  abgelehnt (zuerst entschlüsseln).

## Sicherheit

- **stdio:** liest/schreibt **lokale Dateien**, auf die der Agent ihn zeigt — läuft
  mit dessen Rechten. Kein Netzwerk, keine Telemetrie.
- **HTTP (gehostet):** **kein Dateisystem** (nur base64-I/O), **tokenlos + Limits**
  (Größe/Seiten/Body). Container läuft als non-root mit read-only Rootfs und
  `no-new-privileges`. Stateless JSON — pro Request ein frischer Server.
- PDF-Parsing ohne Code-Ausführung (pdf-lib strukturell, pdfjs mit
  `isEvalSupported:false`).
