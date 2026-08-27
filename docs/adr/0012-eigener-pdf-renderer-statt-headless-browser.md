# ADR-0012: Eigener pdf-lib-Renderer statt Headless-Browser für Design → PDF

- Status: **Akzeptiert**
- Bezug: `mcp/src/design-pdf.ts`, `mcp/src/design.ts` (`renderHtml`), `mcp/src/mind.ts` (`layoutMindmap`), MCP-Tool `design_render_pdf`

## Kontext

Bis MCP 1.x führte der einzige Weg von einem Design (`*.pbdesign.json`) zu einem
PDF über den Browser: `design_render_html` erzeugt HTML mit Druck-CSS, der Mensch
wählt „Drucken → Als PDF speichern". Für die PWA ist das genau richtig — der
Browser ist ohnehin da, und er ist der beste HTML-Renderer, den wir bekommen
können.

Ein anbindendes Kundenmanagementsystem erzeugt Rechnungen aber **im Hintergrund,
in einem Container, ohne Bildschirm und ohne Benutzer**. Es hängt außerdem jedes
erzeugte Dokument in eine Hash-Kette, braucht also **byte-gleiche Ausgabe bei
gleicher Eingabe**. `design_render_html` allein hilft dort nicht: der Aufrufer
bräuchte selbst einen HTML-nach-PDF-Weg, und damit wäre der Zugewinn wieder weg.

Zwei Wege standen zur Wahl:

**(a) Headless Chromium im Pagebound-Container.** Playwright oder Puppeteer
rendert dasselbe HTML, das die PWA druckt.

**(b) Eigener Renderer mit pdf-lib**, der das Designmodell direkt zeichnet.

## Entscheidung

**Weg (b): ein eigener Renderer** (`mcp/src/design-pdf.ts`), kein Browser im
Abbild.

Ausschlaggebend war nicht die Layout-Treue, sondern was die beiden Wege *kosten*:

- Ein Chromium im Abbild wiegt rund 400 MB, bringt eine eigene, schnelle
  Aktualisierungslast mit (Browser-CVEs) und vergrößert die Angriffsfläche eines
  Dienstes, der sonst aus Node und zwei JS-Bibliotheken besteht.
- **Byte-gleiche Ausgabe müsste man Chromium abringen.** Beim eigenen Renderer
  fällt sie fast von selbst an: keine Systemuhr, keine Zufalls-IDs, feste
  Reihenfolge (siehe `NO_METADATA_BUMP` in `mcp/src/pdf.ts`).
- Der Renderer braucht keine Layout-Engine für beliebiges HTML, sondern nur für
  **unser eigenes Blockmodell** — Überschrift, Absatz, Tabelle, Bild, Form,
  Spalten, Mindmap, Overlay. Das ist ein überschaubarer, geschlossener Umfang.

Der Renderer ist dem Druck-CSS von `design_render_html` **nachgebaut, nicht davon
abgeleitet**: gleiche Seitenmaße, Schriftgrößen, Abstände und Blockfluss, aber
eine zweite Umsetzung derselben Regeln.

## Konsequenzen

- **+** Das Abbild bleibt schlank und ohne Browser-Aktualisierungslast.
- **+** Reproduzierbare Ausgabe ohne Sonderbehandlung; Schriften (Liberation,
  SIL OFL 1.1) werden subsetted eingebettet, das Subsetting ist deterministisch
  (geprüft).
- **+** Anders als der Browser bricht der Renderer zu lange Blöcke auf
  Folgeseiten um — Tabellen mit **wiederholter Kopfzeile**. Das war die
  Voraussetzung für Positionstabellen mit variabler Zeilenzahl.
- **−** **Zwei Umsetzungen derselben Layout-Regeln.** Ändert sich `baseCss()` in
  `design.ts`, muss `design-pdf.ts` mitgeführt werden — sonst laufen PWA-Druck
  und Server-PDF auseinander. Die betroffenen Werte sind in `design-pdf.ts` oben
  gesammelt und als Spiegel gekennzeichnet.
- **−** **Kein beliebiges HTML.** Vom Inline-HTML des Editors werden
  `b/strong`, `i/em`, `u`, `br`, `p/div`, `ul/ol/li` und `span/font` mit Farbe
  umgesetzt; alles andere wird zu Klartext. Das meldet der Renderer als Warnung
  mit Nennung des Tags, statt es stillschweigend zu verschlucken.
- **−** CSS-Effekte ohne PDF-Entsprechung fehlen: abgerundete Bildecken und
  Schatten. Ebenfalls als Warnung gemeldet.
- **−** Bilder nur als `data:`-URL in PNG oder JPEG — kein SVG, kein WebP.
- Für die Mindmap wurde `mind.ts` in `layoutMindmap()` (Koordinaten) und
  `renderMindmapSvg()` (SVG) zerlegt, damit SVG- und PDF-Ausgabe **dasselbe**
  Layout benutzen statt zweier auseinanderlaufender Berechnungen.

## Falls sich das umkehren soll

Der Wechsel auf einen Headless-Browser bleibt möglich: `design_render_pdf` ist
ein Werkzeug mit einer schmalen Schnittstelle (Design-JSON hinein, PDF-Bytes
heraus). Der Anlass wäre ein Bedarf an voller HTML/CSS-Treue — etwa wenn Nutzer
beliebiges HTML in Designs einbetten sollen. Dann wäre allerdings die
Reproduzierbarkeit neu zu beantworten, und sie ist eine zugesicherte Eigenschaft
(siehe `mcp/README.md`, Abschnitt „Reproduzierbare Ausgabe").
