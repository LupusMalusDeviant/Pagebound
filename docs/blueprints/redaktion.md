# Schwärzung (Redaktion)

## Zweck

Destruktive Schwärzung sensibler Inhalte: markierte Bereiche werden nicht nur überdeckt, sondern die betroffenen Seiten werden gerastert, sodass der darunterliegende Text/Inhalt im Ergebnis-PDF tatsächlich entfernt ist (nicht rekonstruierbar). Schwärzungsboxen sind bewusst **transient** — sie werden nicht in der Sidecar-Datei persistiert, sondern existieren nur bis zum Anwenden im Reader. Optional kann ein Audit-Report erzeugt werden, der dokumentiert, was geschwärzt wurde.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Redaktionsmodus: `RedactionBox`-Platzierung auf der Seite, `ApplyRedactionsAsync` als Auslöser |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | `redactPdf`: Rasterung der betroffenen Seiten mit eingebrannten schwarzen Boxen |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `RedactAsync`: C#-Seite des Schwärzungs-Exports via JS-Interop |
| `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` | Manipulator-Abstraktion, über die die Schwärzung angeboten wird |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader & Viewer** — Platzierung der Schwärzungsboxen erfolgt auf dem gerenderten Seiten-Canvas; das Rendering liefert zudem die Rasterbilder. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge** — nutzt denselben `JsPdfLibManipulator` / `pdf-manipulator-bridge.ts` wie die übrigen Manipulations-Werkzeuge. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).

### Extern (Packages)
- `pdf-lib` (via `pdf-manipulator-bridge.ts`) — Neuaufbau des PDFs mit gerasterten Seiten
- `pdfjs-dist` — Rasterung der Originalseiten als Bild (Render-Grundlage)

## Öffentliche API / Interface

- `JsPdfLibManipulator.RedactAsync(...)` — nimmt PDF-Bytes plus die Liste der Schwärzungsbereiche (Seite + Rechteck) entgegen und liefert das geschwärzte PDF zurück.
- JS-Seite: `redactPdf(...)` in `pdf-manipulator-bridge.ts` — rastert betroffene Seiten und brennt die schwarzen Boxen ins Bild ein.

## Datenfluss / Call-Flow

1. Nutzer aktiviert den Redaktionsmodus in `ReaderPane.razor` und zieht eine oder mehrere `RedactionBox`-Bereiche auf (transient, kein Sidecar-Write).
2. `ApplyRedactionsAsync` sammelt die Boxen (Seite + normalisierte Rechtecke) und ruft `RedactAsync` auf `JsPdfLibManipulator` auf.
3. Die Bridge (`redactPdf`) rendert jede betroffene Seite als Rasterbild, zeichnet die schwarzen Boxen darüber und ersetzt die Vektor-Seite im Ergebnis-PDF durch das Bild — der Originaltext unter der Box ist damit destruktiv entfernt.
4. Das Ergebnis wird als neue Datei exportiert; optional wird ein Audit-Report (welche Seiten/Bereiche geschwärzt wurden) miterzeugt.

## Muster-Schwärzung (Regex/Preset)

Zusätzlich zum manuellen Aufziehen: `findTextMatches(handleId, regex, flags)` (pdfjs-bridge.ts) durchsucht den **extrahierbaren Text-Layer** (kein OCR) nach einem Muster — Presets für E-Mail/Telefon/IBAN/Kreditkarte oder eigene Regex. Treffer werden als 0..1-Bounding-Boxes zurückgegeben (Teilbereich innerhalb eines Text-Items proportional zur Zeichenzahl geschätzt, da `getTextContent` nur Item- statt Glyphen-Positionen liefert; mehrzeilige Treffer → eine Box je Zeile). Der Reader (`FindPatternMatchesAsync`) fügt sie als `RedactionBox` hinzu → gleicher Apply-Pfad (Raster = echte Entfernung). Grenze ehrlich: findet nur, was im Text-Layer steht (nicht in Scan-Bildern), und die Sub-Item-Box ist eine Näherung.

## Offene Fragen / TODOs

- Rasterung erhöht die Dateigröße und entfernt die Textebene der betroffenen Seiten (Suche/Kopieren dort nicht mehr möglich) — bewusster Trade-off für garantierte Entfernung.
- Format und Ablageort des optionalen Audit-Reports im Code verifizieren.
