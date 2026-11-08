# Schwärzung (Redaktion)

## Zweck

Destruktive Schwärzung: markierte Bereiche werden nicht überdeckt, sondern die betroffenen Seiten werden **gerastert**, sodass der darunterliegende Text im Ergebnis-PDF tatsächlich weg ist und nicht rekonstruierbar bleibt. Das ist der Unterschied zum schwarzen Balken, der in jedem Betrachter mit Textauswahl zu umgehen ist. Schwärzungskästen sind bewusst **flüchtig** — sie landen nicht im Sidecar, sondern existieren nur bis zum Anwenden.

## Dateien

Dieses Feature hat **keine eigenen Dateien**. Es lebt als Symbole in Dateien, die anderen Features zugeordnet sind:

| Symbol | Datei | Rolle |
|--------|-------|-------|
| `ReaderPane.ApplyRedactionsAsync`, Redaktionsmodus, `RedactionBox` | `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Kästen auf der Seite aufziehen, Auslöser |
| `redactPdf` (`:212`) | `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | Rasterung der betroffenen Seiten mit eingebrannten schwarzen Kästen |
| `RedactAsync` | `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | C#-Seite über JS-Interop |
| `IPdfManipulator.RedactAsync` (`:91`), `RedactionRegion` | `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` | Vertrag |
| `findTextMatches` | `src/Pagebound.Web/wwwroot/js/pdfjs-bridge.ts` | Mustersuche für die Vorlagen-Schwärzung |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

Weil das Feature keine eigenen Dateien hat, erscheint es **nicht** im maschinell geprüften Kantengraph. Die folgenden Abhängigkeiten sind **von Hand ermittelt**:

- **PDF-Reader & Rendering** — die Kästen werden auf dem gerenderten Seiten-Canvas aufgezogen, und das Rendering liefert die Rasterbilder; `findTextMatches` kommt aus derselben Brücke. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge & Manipulation** — derselbe `JsPdfLibManipulator` und dieselbe pdf-lib-Brücke wie alle anderen Manipulationen. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Text bearbeiten** — dasselbe flüchtige Muster, aber ohne Garantie der Entfernung; die Schwärzung ist der Weg, wenn Text wirklich verschwinden soll. Siehe [`./text-bearbeiten.md`](./text-bearbeiten.md).

Änderungen an diesem Feature verfolgt man über die Kanten von „PDF-Reader & Rendering" und „PDF-Werkzeuge & Manipulation" im [INDEX](./INDEX.md).

### Extern (Packages)

- `pdf-lib` — Neuaufbau des PDFs mit gerasterten Seiten
- `pdfjs-dist` — Rasterung der Originalseiten als Bild und Text-Extraktion für die Mustersuche

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IPdfManipulator.cs:91
Task<byte[]> RedactAsync(Stream pdf, IReadOnlyList<RedactionRegion> regions, CancellationToken ct);
```

`RedactionRegion` trägt Seite und Rechteck in Seitenanteilen 0..1. JS-Seite: `redactPdf(pdfBytes, regions)` (`pdf-manipulator-bridge.ts:212`).

## Datenfluss / Call-Flow

1. Der Nutzer schaltet in `ReaderPane.razor` den Redaktionsmodus ein und zieht einen oder mehrere Kästen auf — flüchtig, kein Sidecar-Schreiben.
2. `ApplyRedactionsAsync` sammelt die Kästen (Seite plus normalisiertes Rechteck) und ruft `RedactAsync`.
3. `redactPdf` (`pdf-manipulator-bridge.ts:212`) rendert jede betroffene Seite als Rasterbild, zeichnet die schwarzen Kästen darüber und ersetzt die Vektorseite im Ergebnis durch das Bild. Damit ist der Text unter dem Kasten destruktiv weg — und zwar der ganzen Seite, nicht nur unter dem Kasten.
4. Das Ergebnis wird als neue Datei ausgegeben; optional entsteht ein Bericht, welche Seiten und Bereiche geschwärzt wurden.

## Muster-Schwärzung (Regex/Preset)

Zusätzlich zum manuellen Aufziehen: `findTextMatches(handleId, regex, flags)` (pdfjs-bridge.ts) durchsucht den **extrahierbaren Text-Layer** (kein OCR) nach einem Muster — Presets für E-Mail/Telefon/IBAN/Kreditkarte oder eigene Regex. Treffer werden als 0..1-Bounding-Boxes zurückgegeben (Teilbereich innerhalb eines Text-Items proportional zur Zeichenzahl geschätzt, da `getTextContent` nur Item- statt Glyphen-Positionen liefert; mehrzeilige Treffer → eine Box je Zeile). Der Reader (`FindPatternMatchesAsync`) fügt sie als `RedactionBox` hinzu → gleicher Apply-Pfad (Raster = echte Entfernung). Grenze ehrlich: findet nur, was im Text-Layer steht (nicht in Scan-Bildern), und die Sub-Item-Box ist eine Näherung.

## Offene Fragen / TODOs

- Die Rasterung erhöht die Dateigröße und entfernt die Textebene der betroffenen Seiten; Suche und Kopieren sind dort danach nicht mehr möglich. Bewusster Preis für eine garantierte Entfernung.
- Format und Ablageort des optionalen Berichts sind im Code zu verifizieren — die Oberfläche bietet ihn an, dieser Blueprint hat den Pfad nicht belegt.
- Eine Prüfung, die eine **unvollständige** Schwärzung findet (Text nach dem Anwenden noch extrahierbar), gibt es nicht. Die Textextraktion des eigenen Lesers auf das Ergebnis anzuwenden wäre genau die richtige Gegenprobe und fehlt.
