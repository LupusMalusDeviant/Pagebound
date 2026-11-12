# Wettbewerbsvergleich — was andere besser machen als Pagebound

**Stand:** 2026-11-12 · **Commit:** `5a611f5` · **Anlass:** Frage des Nutzers nach
ähnlichen Projekten und deren Vorsprung.

**Wie dieses Dokument zu lesen ist.** Jeder Befund nennt den Wettbewerber, den Beleg
(Zitat mit Quelle oder `datei:zeile` im eigenen Code) und die Frage, ob die Lücke
überhaupt schließbar ist, ohne die Datenschutzzusage zu brechen. Aussagen über
Pagebound stammen aus dem Code, nicht aus der Erinnerung; Aussagen über die
Wettbewerber aus ihren eigenen Seiten. Wo eine Quelle nur behauptet statt belegt,
steht das dabei.

---

## Das Vergleichsfeld

| Projekt | Art | Umfang | Lizenz | Nähe zu Pagebound |
|---|---|---|---|---|
| **BentoPDF** ([alam00000/bentopdf](https://github.com/alam00000/bentopdf)) | reine Browser-App, 16,4k Sterne | „Tools Reference (50+ tools)" | AGPL-3.0, dazu kommerziell 79 $ | **direkter Konkurrent** — gleiche Bauart, gleiches Versprechen |
| **Stirling PDF** ([Stirling-Tools/Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)) | Server (self-hosted) + Desktop + Browser | „50+ PDF tools" | open-core: MIT, mit proprietären Verzeichnissen | anderes Modell, aber derselbe Nutzerkreis |
| **PDF.js** (Mozilla) | Bibliothek + Viewer | Renderer, seit v4 eigener Annotations-Editor | Apache 2.0 | Pagebounds **eigener Unterbau** |
| **Acrobat / Preview / Okular / Zotero** | Desktop | Vollumfang | gemischt | der Maßstab, an dem Dateien gemessen werden |

Ein Befund vorweg, der kein Nachteil ist: **BentoPDF trägt dieselbe Zusage wie
Pagebound und hält sie schwächer.** Die Seite sagt „All processing happens in your
browser. Your files are never uploaded to a server" — und an anderer Stelle, das
Projekt „pre-configures CDN URLs so all features work out of the box" sowie „WASM
modules are loaded at runtime from jsDelivr CDN". Die *Dateien* bleiben lokal, die
*Verbindungen* nicht. Pagebound verbietet genau das per Befehl
(`tools/privacy-check.mjs`) und per CSP `connect-src 'self'`
(`infra/docker/nginx.conf:35`). Das ist der einzige Punkt, an dem Pagebound dem
direkten Konkurrenten strukturell voraus ist — und er ist prüfbar, nicht behauptet.

---

## Befund 1 — Anmerkungen sind keine PDF-Anmerkungen (die größte Lücke)

**Was andere tun.** Jeder ernsthafte Betrachter liest und schreibt Anmerkungen als
`/Annots`-Objekte in die PDF-Datei: Acrobat, Preview, Okular, Xodo, Zotero, und seit
v4 auch der Editor von PDF.js (FreeText, Ink, Stamp, Highlight). BentoPDF führt
ausdrücklich „**Remove Annotations** — Remove comments, highlights, and other
annotations" — ein Werkzeug, das nur Sinn ergibt, wenn man Standard-Annotationen
verarbeitet.

**Was Pagebound tut.** Anmerkungen leben ausschließlich im Sidecar bzw. in IndexedDB
unter `annotations:<pdfId>` (`docs/blueprints/annotationen.md:5`,
`ReaderPane.razor:3792`–`3805`). „Einbrennen" **zeichnet** sie als flache Grafik in
die Seite (`pdf-manipulator-bridge.ts:1333` ff. — Highlight, Ink, Shape, Note,
Signature, Text werden von 0..1-Koordinaten in pdf-lib-Punkte umgerechnet und
gemalt). Gegenprobe: eine Suche nach
`PDFName.of("Annot"|"Annots"|"Highlight"|"Ink"|"Square"|"FreeText"|"Text")` in
`pdf-manipulator-bridge.ts` findet **keine Treffer**. Pagebound schreibt nirgends ein
Standard-Annotationsobjekt.

**Die Folge, konkret.** Wer in Pagebound markiert, hat zwei Möglichkeiten, und beide
sind schlecht: Entweder die Markierung bleibt im Sidecar — dann sieht sie niemand,
der die PDF in Acrobat, Preview, auf dem Telefon oder in Zotero öffnet. Oder sie wird
eingebrannt — dann ist sie sichtbar, aber endgültig: nicht mehr anwählbar, nicht
löschbar, nicht editierbar, **auch nicht von Pagebound selbst**. Für Lesen und
Zurückschicken von Dokumenten — der häufigste Grund, überhaupt zu markieren — ist das
die eine Sache, die ein PDF-Werkzeug können muss.

**Bricht das die Datenschutzzusage?** Nein, kein Stück. `/Annots` zu schreiben ist
reine lokale Dateimanipulation, pdf-lib kann es. Das ist die größte Lücke und zugleich
die am leichtesten schließbare.

---

## Befund 2 — Die fortlaufende Ansicht rendert jede Seite und vergisst keine

**Was andere tun.** Der Viewer von PDF.js hält ein Fenster gerenderter Seiten und
verwirft, was aus dem Blick ist. Dass das auch dort nicht gut genug ist, ist bekannt:
träges Rendering großer Dokumente ist ein offenes Thema im Projekt, und ein Anbieter
berichtet rund 3 GB Speicher gegen 650 MB bei Acrobat auf demselben Dokument.
Kommerzielle SDKs lösen es über echte Virtualisierung.

**Was Pagebound tut.** `ReaderPane.razor:2898`–`2914`: beim Einschalten der
fortlaufenden Ansicht läuft eine Schleife `for (var p = 1; p <= _handle.PageCount;
p++)` über **alle** Seiten, rendert jede mit `Scale: 1.5` und legt sie als
base64-Daten-URL in ein `Dictionary<int, string>` (`:1747`). Kein Fenster, keine
Obergrenze, keine Verdrängung — geleert wird erst beim Dateiwechsel (`:1912`,
`:2159`). base64 schlägt auf die Rohbytes noch ein Drittel drauf, und die dekodierten
Bilder liegen zusätzlich im Browser.

Das ist kein neuer Befund — `CLAUDE.md` nennt WASM-OOM als kritischen Bereich Nummer
eins —, aber der Code ist schlimmer als die Warnung: es ist nicht „keine
Virtualisierung", es ist „alles, für immer, als base64".

**Bricht das die Datenschutzzusage?** Nein. Rein lokale Arbeit. Und es ist die
Qualitätspriorität Nummer eins des Projekts.

---

## Befund 3 — Vier Werkzeuge, die BentoPDF hat und Pagebound nicht

Geprüft gegen den tatsächlichen Bestand (30 MCP-Werkzeuge in `mcp/src/index.ts`,
Werkzeugliste in `PdfToolsPanel.razor`). Pagebound ist **nicht** generell dünner:
Bates-Nummerierung und Wasserzeichen hat es (`pdf_stamp`), dazu Schwärzung, OCR,
PDF/A, PDF/UA, Signatur, Verschlüsselung und einen Designer, den BentoPDF nicht hat.
Es fehlen aber vier Dinge namentlich:

| Fehlt | BentoPDFs Wortlaut | Warum es zählt |
|---|---|---|
| **Sanitize PDF** | „Remove metadata, annotations, scripts, and more." | Passt exakt zu Pagebounds Positionierung: eine PDF von eingebettetem JavaScript, Anhängen und Metadaten befreien, bevor man sie weitergibt. Das Werkzeug fehlt ausgerechnet dem Datenschutz-Produkt. |
| **Linearize PDF** | „Optimize PDF for fast web viewing." | „Fast Web View" — die Datei wird so umsortiert, dass die erste Seite vor dem Rest ankommt. |
| **Table of Contents / Edit Bookmarks** | „Generate a table of contents page from PDF bookmarks." | Pagebound **liest** Outlines (`doc.getOutline`, Panel in `ReaderPane.razor:668` ff.), kann sie aber nicht schreiben oder bearbeiten. |
| **XFA-Formulare** | „Fill in forms directly in the browser. Also supports XFA forms." | Betrifft Behördenformulare, vor allem im deutschsprachigen Raum. |

**Bricht das die Datenschutzzusage?** Nein, alle vier sind lokale Dateioperationen.
Sanitize ist der mit Abstand wertvollste, weil er die Produkterzählung stützt statt
nur die Liste zu verlängern.

---

## Befund 4 — Signaturen enden bei PAdES-B-B

**Was andere tun.** JSignPdf (auf EU-DSS) und ATick erzeugen alle vier Baseline-Stufen
B-B, B-T, B-LT, B-LTA. BentoPDF: „Add cryptographic digital signatures using X.509
certificates (PFX/PEM). Private key never leaves browser."

**Was Pagebound tut.** `sign-bridge.ts:4`–`16` und `:501` dokumentieren das
ausdrücklich und ehrlich: **nur B-B**, „KEIN B-T/B-LT/B-LTA".

**Bricht das die Datenschutzzusage?** **Ja — hier ist die Lücke echt und bewusst.**
B-T aufwärts verlangt einen Zeitstempeldienst, also einen Netzaufruf nach draußen.
Das verbietet `connect-src 'self'`. Die Folge ist real: eine B-B-Signatur ist nach
Ablauf des Zertifikats nicht mehr langfristig prüfbar. Für die Praxis heißt das, dass
Pagebound-Signaturen für formelle Zwecke mit Aufbewahrungspflicht nicht taugen.

Dieser Befund ist **kein Auftrag**, sondern eine Entscheidung, die der Nutzer treffen
muss: entweder so lassen und offen kommunizieren, oder einen Zeitstempeldienst als
ausdrücklich opt-in zulassen — was die Kernzusage aufweicht und
`privacy-check.mjs` berührt, also off-limits ohne Erlaubnis.

---

## Befund 5 — Stirling hat drei Wege hinein, Pagebound hat zwei

Stirling wirbt mit „Run it as a personal desktop app, in the browser, or deploy it on
your own servers with a private API" und „REST APIs available for nearly all tools to
integrate into your existing systems".

Pagebound hat die Browser-PWA und — das ist der Punkt, an dem es Stirling *voraus*
ist — einen MCP-Server mit 30 Werkzeugen, also die agentenfreundliche Schnittstelle,
die Stirling nicht hat. Was fehlt, ist eine schlichte HTTP-API für alles, was kein
MCP spricht (Skripte, CI, cURL), und ein Desktop-Client.

**Bricht das die Datenschutzzusage?** Eine HTTP-API im MCP-Paket nicht — das Paket
läuft ohnehin als Node-Dienst und hat bereits Streamable HTTP. Die PWA selbst bleibt
unberührt. Priorität ist das trotzdem keine.

---

## Was Pagebound besser macht — damit der Vergleich ehrlich bleibt

1. **Die Zusage ist erzwungen, nicht beteuert.** `privacy-check.mjs` scheitert den
   Build bei jedem fremden Host; die CI fährt zusätzlich einen umleitenden
   Gegenspieler (`ci.yml:206`), der auffliegen lässt, wenn die App doch nach draußen
   telefoniert. BentoPDF lädt WASM und OCR-Daten zur Laufzeit von jsDelivr.
2. **Reproduzierbare Ausgabe.** Gleiche Eingabe → byte-gleiches PDF, keine Systemuhr,
   keine Zufalls-IDs, stabile Fehlerkennungen — seit MCP 2.0.0 zugesichert. Keiner der
   Wettbewerber verspricht das.
3. **MCP-Server mit 30 Werkzeugen.** Stirling hat REST, Pagebound hat MCP.
4. **Offline-PWA mit Dateihandler und Teilen-Ziel**, Store-Auftritt, keine
   Server-Installation — BentoPDF ist vergleichbar, Stirling braucht einen Server.
5. **AES-256/R6 im Browser** über WebCrypto.

---

## Reihenfolge, wenn etwas davon gemacht wird

1. **Befund 1** (Standard-Annotationen) — größter Nutzen, kein Konflikt, klarer Schnitt.
2. **Befund 2** (Fenster statt Alles-im-Speicher) — Qualitätspriorität Nummer eins des
   Projekts, und der Code zeigt einen schärferen Mangel als die Warnung in `CLAUDE.md`.
3. **Befund 3, nur Sanitize** — stützt die Produkterzählung, kleiner Schnitt.
4. **Befund 4** — Entscheidung des Nutzers, keine Arbeit.
5. **Befund 5** — nachrangig.

Der Rest aus Befund 3 (Linearize, TOC, XFA) ist Listenpflege und kann warten.

---

## Belege

- BentoPDF: <https://github.com/alam00000/bentopdf>
- Stirling PDF: <https://github.com/Stirling-Tools/Stirling-PDF> · [LICENSE](https://github.com/Stirling-Tools/Stirling-PDF/blob/main/LICENSE) · [Downloads](https://stirling.com/download) · [Feature-Überblick](https://blog.elest.io/self-host-stirling-pdf-50-private-pdf-tools-on-your-server/) · [API-Beschreibung](https://codeconductor.ai/blog/what-is-stirling-pdf/)
- PDF.js-Annotationseditor (Modi FreeText/Highlight/Stamp/Ink): [Nutrient-Beschreibung der Editor-Schicht](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/) · [pdfjs-dist Editor-API](https://tessl.io/registry/tessl/npm-pdfjs-dist/files/docs/editor-api.md)
- `/Annots` als Seitenstruktur: [Mapsoft, PDF Annotations](https://mapsoft.com/posts/pdf-annotations.html)

**Was nicht belegt ist.** Dass der PDF.js-Editor seine Anmerkungen so speichert, dass
Acrobat sie verlustfrei zurückliest, ist durch die gelesenen Quellen *nicht* gezeigt —
nur, dass der Editor diese Typen kennt. Ob BentoPDF Annotationen als Standard-`/Annots`
schreibt, steht ebenfalls nicht auf seiner Seite. Für Befund 1 ist das unerheblich:
belegt ist, dass **Pagebound** keine schreibt.
