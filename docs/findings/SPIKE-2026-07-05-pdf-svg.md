# Spike: PDF → Vektor-SVG-Export (Bean PDF-Tool-caes)

**Datum:** 2026-07-05 · **Branch:** `feat/PDF-Tool-caes-pdf-vektor-svg-export`
**Frage:** Lässt sich mit `pdfjs-dist 6.0.227` (ohne den entfernten `SVGGraphics`,
ohne neue/AGPL-Dependency, offline) ein echtes, skalierbares Vektor-SVG aus den
niedrigstufigen Zeichen-Operationen einer PDF-Seite erzeugen — insbesondere Text?

## Verdikt: **GO** (mit einer klaren offenen Frage bei Schrift-Treue)

Ein Wegwerf-Emitter (`convertToSvgSpike` in `pdfjs-bridge.ts`) übersetzt
`page.getOperatorList()` verlässlich in Vektor-SVG. Am Test-PDF (Rechteck-Füllung,
Linie, Bézier-Kurve, Text) verifiziert:

- **Vektor-Pfade: tragfähig.** Rechteck (`fill=#0000ff`), Linie (`stroke=#ff0000`),
  Bézier-Kurve (`stroke=#00ff00`) — exakte Koordinaten, korrekte Farben,
  Füllung/Kontur/Strichbreite. Das erzeugte SVG parst fehlerfrei im DOM.
- **Text: skalierbar & auswählbar** als echtes `<text>`-Element (nicht gerastert,
  keine Kästchen), korrekt positioniert und in Größe.
- **Kontrollierte Degradation** greift: nur `dependency` (Font-Referenz) und `endText`
  wurden übersprungen, kein Absturz, kein Hänger, `firstErr: null`.

Beispiel-Output (Test-PDF, scale 1.5 → 450×300):

```svg
<g transform="matrix(1.5 0 0 -1.5 0 300)">
  <path d="M 20 20 L 120 20 L 120 80 L 20 80 Z" fill="#0000ff"/>
  <path d="M 20 150 L 280 150" fill="none" stroke="#ff0000" stroke-width="2"/>
  <path d="M 150 30 C 200 90 250 30 290 60" fill="none" stroke="#00ff00" stroke-width="3"/>
  <text transform="matrix(1 0 0 -1 20 100)" font-size="24" font-family="sans-serif">Hello Vektor</text>
</g>
```

## Die Schrift-Frage — beantwortet

Text landet als `<text>` mit **substituierter Schriftfamilie** (`sans-serif`). Das
heißt: **auswählbar/skalierbar/editierbar ja** — aber die **Glyph-Formen der
eingebetteten/Subset-Fonts werden (noch) nicht originalgetreu wiedergegeben**. Für das
Ziel „in Illustrator editierbar" ist `<text>` sogar besser als Glyph-Umrisse (echte
Textobjekte statt Pfade). Für pixelgetreue Reproduktion fehlt die Original-Schrift.
Drei Wege, das zu schließen (Entscheidung im Folge-Bean):

1. **`<text>` + Font-Substitution belassen** — billigster Weg, gut für „editierbarer Text".
2. **Fonts einbetten** (`@font-face` mit den via pdf.js zugänglichen Font-Programmen als
   data-URI) → korrekte Formen UND editierbarer Text. Der Sweet-Spot; die eigentliche
   Font-Arbeit, aber bounded.
3. **Glyphen zu Pfaden** (wie es der alte `SVGGraphics` tat) → formtreu, aber Text nicht
   mehr als Text editierbar. Widerspricht dem „editierbar"-Ziel.

## Technische Erkenntnisse zu pdfjs-dist 6.0.227 (für die Umsetzung wertvoll)

Empirisch aus `getOperatorList()` ermittelt (nicht dokumentiert):

- **`constructPath`-Args = `[paintOp, [subpathSegmente], minMax]`** — der Paint (fill/
  stroke) ist **in die Path-Op fusioniert**; es gibt keine separaten `fill`/`stroke`-Ops
  mehr. `paintOp` ist ein OPS-Wert → über die Reverse-Map (`OPS`-Namen) robust als
  „fill"/„stroke" erkennbar.
- **Subpfade** sind flache Arrays `[segOp, coords…]` mit kompakten Codes:
  `0`=moveTo(2), `1`=lineTo(2), `2`/`3`=cubic curveTo(6), `4`=closePath(0). Rechtecke
  werden zu moveTo+3×lineTo+close expandiert (kein eigener rect-Segment-Code).
- **Fill-/Stroke-Farben** kommen bereits als **CSS-String** (`a[0] = "#rrggbb"`), nicht
  als Zahlen-Array.
- **Viewport-Transform** (`page.getViewport({scale}).transform`) als Root-`<g>`-Matrix
  anwenden; Pfad-/Text-Koordinaten bleiben in PDF-User-Space. Text braucht einen lokalen
  Y-Flip (`matrix(1 0 0 -1 …)`), damit Glyphen aufrecht stehen.

## Empfehlung für den Folge-Bean

Die Erkenntnisse verschieben die ursprüngliche A/B-Wahl:

- **Nicht** den alten `SVGGraphics` portieren (Ansatz A) — er würde Text zu Pfaden
  machen (gegen „editierbar") und bringt Legacy-Ballast.
- **Eigener schlanker Emitter (diesen Spike produktiv ausbauen)** ist der klare Weg:
  Pfade nativ (bewiesen), Text als `<text>` + **Font-Embedding (Weg 2)** für Formtreue.
  **Raster-Fallback** nur für echt un-vektorisierbares Material (Shadings, Blend-Modes,
  Soft-Masks, Muster) — so sieht die Ausgabe nie kaputt aus.

### Offene Punkte für die Produktions-Umsetzung
- Font-Einbettung (Weg 2) als eigentliche Kernarbeit — Machbarkeit der Font-Extraktion
  aus `page.commonObjs` prüfen.
- Bild-XObjects (`paintImageXObject`) als eingebettete `<image>` (data-URI).
- Clipping-Pfade (aktuell übersprungen), Transparenz/`setGState`.
- Verpackung: seitenweise erzeugen → ZIP (Muster `convertToImagesZip`, OOM-sicher),
  Enum `ConversionFormat.Svg` (anhängen), Dispatch in `JsPdfConverter`, UI-Option + i18n.
- Der Spike-Code (`convertToSvgSpike`) ist die tragfähige **Saat** dafür — nicht löschen
  und neu schreiben, sondern zu `convertToSvgZip` ausbauen.

## Reproduktion
`pageboundPdf.convertToSvgSpike(pdfBytes, pageNumber, scale)` im Browser aufrufen; das
erzeugte SVG enthält einen `<!-- spike-coverage … -->`-Kommentar mit Op-Zählung und
übersprungenen Ops. Test-PDF wurde im Browser als ASCII zusammengebaut (Rechteck-`re f`,
Linie-`m l S`, Bézier-`c S`, Text-`BT…Tj ET`).
