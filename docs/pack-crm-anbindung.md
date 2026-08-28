# Pagebound als Dokumentendienst anbinden

Für Pack-CRM (und jedes andere Programm, das Pagebound über MCP aufruft).
Stand: MCP-Server **2.1.0**, App **0.13.0-beta**.

---

## Kurzfassung

Pagebounds PDF-Operationen laufen als eigener Dienst mit einer MCP-Schnittstelle.
Ein Aufrufer kann damit Rechnungen **erzeugen**, als **E-Rechnung** verpacken,
**signieren** und aus **Scans** Text holen — alles ohne Browser, ohne
Netzzugriff des Dienstes und ohne native Abhängigkeiten.

```
https://pagebound.app.lupusmalus.dev/mcp     Streamable HTTP, kein Token
```

Oder lokal als Unterprozess:

```bash
node /pfad/zu/Pagebound/mcp/dist/index.js    # stdio, JSON-RPC
```

Der Unterschied: **stdio** kann Dateipfade (`path`, `outputPath`), **HTTP** nicht
— dort läuft alles über `dataBase64`.

## Worauf ihr pinnen solltet

`serverInfo.version` meldet die Version aus der `package.json`. **Jede
Verhaltensänderung bekommt eine neue Version** — Major, wenn sich bei gleichem
Aufruf das Ergebnis ändert; Minor für neue Werkzeuge oder neue optionale
Parameter; Patch für Korrekturen ohne sichtbare Wirkung.

```
2.0.0  DER-sortierte Signaturattribute, reproduzierbare Ausgabe, Fehlercodes
2.1.0  pdf_ocr, charsPerPage/pagesWithoutText in pdf_extract_text
```

`GET /healthz` liefert dieselbe Version, wenn ihr sie im Betrieb prüfen wollt.

---

## Der Rechnungsweg, von vorne bis hinten

Vier Aufrufe. Jeder davon ist einzeln benutzbar; ihr müsst die Kette nicht am
Stück fahren.

### 1 · Vorlage holen (einmalig, dann bei euch ablegen)

```json
{ "name": "design_create", "arguments": { "kind": "invoice-data" } }
```

Liefert ein `*.pbdesign.json` mit allen Pflichtangaben nach § 14 UStG als
Platzhalter und **beiden** Umsatzsteuer-Fällen in *einem* Dokument. Legt das
Ergebnis bei euch ab und versioniert es — ihr wollt nicht bei jeder Rechnung
eine frische Vorlage ziehen.

Welche Platzhalter die Vorlage erwartet, sagt euch:

```json
{ "name": "design_validate", "arguments": { "json": "<vorlage>" } }
```

→ `placeholders: ["kunde.name", "positionen", "rechnung.nummer", …]`

### 2 · Vorlage füllen und als PDF rendern (ein Aufruf)

```json
{
  "name": "design_render_pdf",
  "arguments": {
    "json": "<vorlage>",
    "onMissing": "error",
    "data": {
      "kleinunternehmer": false,
      "verkaeufer": { "name": "…", "strasse": "…", "plz": "…", "ort": "…",
                      "ustid": "DE123456789", "bank": "…", "iban": "…", "bic": "…" },
      "kunde":      { "name": "…", "strasse": "…", "plz": "…", "ort": "…" },
      "rechnung":   { "nummer": "LMD-2026-0042", "datum": "27.08.2026",
                      "leistungszeitpunkt": "August 2026", "zahlungsziel": "10.09.2026" },
      "positionen": [
        { "menge": "3", "einheit": "Std.", "bezeichnung": "Beratung",
          "einzelpreis": "95,00 €", "steuersatz": "19 %", "betrag": "285,00 €" }
      ],
      "summen": { "netto": "285,00 €", "steuer": "54,15 €", "brutto": "339,15 €",
                  "steuersaetze": [{ "satz": "19 %", "netto": "285,00 €", "steuer": "54,15 €" }] }
    }
  }
}
```

Rückgabe: `{ pageCount, dataBase64, missing, notes, warnings, issues }`.

**Drei Dinge, die ihr wissen müsst:**

- **Beträge kommen fertig formatiert von euch.** Der Dienst rechnet nicht und
  formatiert nicht — er setzt ein. Ihr seid das Buchhaltungssystem.
- **`kleinunternehmer` steuert den Steuerfall.** `true` → keine Steuerspalte,
  keine Steuersummen, dafür der Pflichthinweis auf § 19 UStG. `false` →
  Steuersatz je Position, Summen je Steuersatz, Bruttosumme. Eine Vorlage, zwei
  Fälle; die bedingten Blöcke stecken im Design (`when` / `unless`).
- **Fehlende Werte brechen ab.** `onMissing: "error"` (Default) nennt jeden
  fehlenden Platzhalter mit Fundort. Wollt ihr stattdessen die Liste, setzt
  `"report"` — dann steht sie in `missing`. Als fehlend gilt auch ein leerer
  Text; ein Feld, das entfallen darf, gehört in einen `when`-Block.

Positionen wachsen mit: die Tabelle bricht über Seiten um und **wiederholt die
Kopfzeile**.

### 3 · E-Rechnung daraus machen

```json
{
  "name": "pdf_to_pdfa",
  "arguments": {
    "dataBase64": "<pdf aus Schritt 2>",
    "part": 3,
    "documentDate": "2026-08-27T00:00:00Z",
    "attachments": [
      { "name": "factur-x.xml", "dataBase64": "<euer ZUGFeRD-XML>",
        "mimeType": "text/xml", "relationship": "Alternative",
        "description": "Rechnungsdaten" }
    ],
    "facturX": { "documentFileName": "factur-x.xml", "conformanceLevel": "EN 16931" }
  }
}
```

Das erzeugt PDF/A-**3b**: EmbeddedFile-Stream, Filespec mit
`/AFRelationship /Alternative`, Eintrag im Namensbaum `/Names /EmbeddedFiles`
**und** im `/AF`-Array des Katalogs, dazu die ZUGFeRD/Factur-X-Kennzeichnung im
XMP samt des von PDF/A geforderten Erweiterungsschemas.

**`documentDate` mitgeben.** Sonst übernimmt der Dienst die Daten des
Eingabedokuments — und hat es keine, bleibt das Ergebnis datumslos (mit
Warnung). Er erfindet bewusst keines, weil das die Byte-Gleichheit bräche.

### 4 · Signieren

```json
{
  "name": "pdf_sign",
  "arguments": {
    "dataBase64": "<pdf aus Schritt 3>",
    "p12Base64": "<zertifikat>",
    "password": "…",
    "reason": "Rechnung"
  }
}
```

**PAdES-B-B**, SubFilter `ETSI.CAdES.detached`. Die signierten Attribute sind
DER-sortiert (RFC 5652 §5.4) und enthalten `signingCertificateV2` (RFC 5035) mit
`certHash` und `issuerSerial`.

**Erneutes Signieren hängt an, statt abzulehnen.** Wird aus einem signierten
Angebot später eine Rechnung, bleibt die erste Signatur gültig: die
Originalbytes bleiben unangetastet, die neue Signatur kommt als inkrementelles
Update dazu. Voraussetzung ist eine klassische xref-Tabelle — Dokumente mit
Cross-Reference-Streams werden mit `UNSUPPORTED` abgelehnt statt still kaputt
gemacht. Jedes von Pagebound erzeugte PDF erfüllt die Voraussetzung.

---

## Scans lesen

```json
{ "name": "pdf_ocr",
  "arguments": { "dataBase64": "…", "languages": "deu+eng", "words": true } }
```

Rückgabe je Seite: `text`, **`confidence`** (0–100), `imageWidth`/`imageHeight`,
optional `words` mit Bounding-Boxen in Bildpixeln. Dazu `meanConfidence` über
alle Seiten und `warnings`.

**Nutzt die Konfidenz.** Unter 70 % meldet `warnings` es zusätzlich — aber die
Entscheidung, ob ihr dem Text traut, gehört euch. 89 % und 41 % sind ein
Unterschied, den kein Werkzeug für euch treffen kann.

**Wann OCR statt Textebene?** `pdf_extract_text` sagt es euch:

```
{ totalChars, charsPerPage: [{ page, chars }], pagesWithoutText: [2, 3] }
```

`pagesWithoutText` listet Seiten mit unter 20 Zeichen — typisch für einen Scan.
**Einen automatischen Rückfall gibt es bewusst nicht:** OCR ist um
Größenordnungen teurer, und die Entscheidung ist eine fachliche.

---

## Der Fehlervertrag

Jeder Fehler trägt eine stabile Kennung — im `structuredContent` als
`{ error: { code, message } }` und im Text als `Fehler [CODE]: …`. Parst keine
deutschen Meldungen.

| Code | Wer muss handeln |
|---|---|
| `INVALID_INPUT` | Aufrufer — Parameter fehlen, widersprechen sich oder sind ungültig |
| `INPUT_TOO_LARGE` · `PAGE_LIMIT` | Aufrufer — über dem Limit des Servers |
| `PDF_CORRUPT` · `PDF_ENCRYPTED` | Nutzer — Datei kaputt oder passwortgeschützt |
| `CERT_PASSWORD` · `CERT_INVALID` | Nutzer — Zertifikat oder Passwort |
| `FILE_READ` · `FILE_WRITE` | Betrieb — nur im stdio-Modus |
| `UNSUPPORTED` | Aufrufer — gültiger Fall, den dieser Server nicht abdeckt |
| `PROCESSING_FAILED` | Nutzer/Betrieb — Operation an diesem Dokument gescheitert |
| `INTERNAL` | Betrieb — Fehler in Pagebound, bitte melden |

Ein zu großer HTTP-Body ergibt **413** mit `error.data.code = "INPUT_TOO_LARGE"`.

## Grenzen des Endpunkts

- **25 MB** je Datei (`MCP_MAX_PDF_BYTES`), **1000 Seiten** je Dokument.
- Das HTTP-Body-Limit leitet sich daraus ab (base64 bläht um 4/3 auf): bei 25 MB
  sind das 42 MB.
- Braucht ihr mehr, setzt der Betreiber `MCP_MAX_PDF_BYTES` — das Body-Limit
  zieht automatisch nach.

---

## Was zugesichert ist

**Gleiche Eingabe, gleiche Bytes.** Derselbe Aufruf mit denselben Daten erzeugt
dasselbe PDF, Byte für Byte. Kein Erzeugungsdatum, keine Zufalls-IDs, feste
Reihenfolge. Wer Dokumente in eine Hash-Kette hängt, kann sich darauf verlassen.

**Zwei Ausnahmen, beide kryptographisch bedingt:** `pdf_encrypt` (Dateischlüssel
und IVs sind Zufall und müssen es sein) und `pdf_sign` (Signaturzeitpunkt und
CMS-Container variieren naturgemäß).

**Kein Netzzugriff.** Der Dienst lädt zur Laufzeit nichts nach — Schriften und
OCR-Sprachdaten liegen im Abbild.

---

## Was NICHT drin ist — bewusst

- **Kein Zeitstempel (RFC 3161).** Die Signatur ist B-B, nicht B-T. Ein
  Zeitstempel wäre der erste ausgehende Netzverkehr des Projekts überhaupt und
  berührt die Datenschutzzusage; die Entscheidung wurde vertagt. **Pack-CRM
  bringt den Zeitstempel selbst an** — der Klient liegt dort ohnehin.
- **PDF/A-3 ist nicht validiert.** Die Struktur ist gegen die Spezifikation
  gebaut und geprüft (XMP, `/AFRelationship`, Namensbaum, `/AF`,
  Erweiterungsschema), aber **kein Validator hat sie bestätigt** — veraPDF wurde
  bewusst nicht eingebunden. Wenn ihr den Nachweis braucht, führt ihn auf eurer
  Seite.
- **Kein LTV**, keine eingebetteten Sperrinformationen.
- **OCR liest je Seite nur das größte Bild.** Scans, die in mehrere Bildstreifen
  zerlegt sind, werden dadurch nur teilweise erfasst — das meldet `warnings`.
  Handschrift wird nicht erkannt.
- **Der PDF-Renderer ist kein Browser.** Vom Inline-HTML werden `b/strong`,
  `i/em`, `u`, `br`, `p/div`, `ul/ol/li` und `span/font` mit Farbe umgesetzt;
  alles andere wird zu Klartext (mit Warnung, welches Tag). Abgerundete
  Bildecken und Schatten fehlen. Bilder nur als `data:`-URL in PNG oder JPEG.

## Was ihr beisteuert

- Den **Prüfer** als Gegenprobe — er hat die DER-Sortierung gefunden.
- Den **Zeitstempel-Klienten**.
- Das **ZUGFeRD-XML**.

Auf unserer Seite liegt `tools/cms-verify`: prüft eine signierte PDF mit .NET
statt node-forge, und zwar zweimal — über die empfangenen Bytes *und* über die
neu nach DER kodierten Attribute. Nur wenn beides besteht, ist die Signatur für
strenge Prüfer brauchbar.

```bash
dotnet run --project tools/cms-verify -- pfad/zur/signierten.pdf
```
