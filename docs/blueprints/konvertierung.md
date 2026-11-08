# Konvertierung & Standards

## Zweck

PDF in andere Formate umwandeln — PNG, JPG, Text, HTML, CSV, DOCX, XLSX, PPTX und SVG — und Bilder zurück in PDF. Dazu die Aufbereitung für zwei Standards: PDF/A-2b (Archivierung) und PDF/UA-1 (Barrierefreiheit), beides als **Best Effort ohne Konformitätsgarantie** und mit einem Prüfbericht, der benennt, was nicht erreicht ist. Alles im Browser; nichts wird hochgeladen.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IPdfConverter.cs` | Vertrag `ConvertAsync(byte[] pdf, ConversionFormat, ct)` → `ConversionResult` (`:9`) |
| `src/Pagebound.Core/Abstractions/IImageToPdfConverter.cs` | Vertrag Bilder → PDF, je Bild eine Seite in Reihenfolge (`:13`) |
| `src/Pagebound.Core/Abstractions/IPdfArchiveService.cs` | Vertrag PDF/A-2b und PDF/UA-1 samt Warnungen (`:20`) |
| `src/Pagebound.Core/Domain/ConversionTypes.cs` | `ConversionFormat` mit neun Werten: Png, Jpg, Text, Html, Csv, Docx, Xlsx, Pptx, Svg (`:4`–`:18`) plus `ConversionResult(Bytes, FileExtension, MimeType)` |
| `src/Pagebound.Core/Domain/ImageToPdfTypes.cs` | `PdfImageInput`, `ImageToPdfOptions` |
| `src/Pagebound.Infrastructure/Pdf/JsPdfConverter.cs` | PDF → X über die PDF.js-Brücke |
| `src/Pagebound.Infrastructure/Pdf/JsImageToPdfConverter.cs` | Bilder → PDF über die pdf-lib-Brücke (`imagesToPdf`) |
| `src/Pagebound.Infrastructure/Pdf/JsPdfArchiveService.cs` | PDF/A und PDF/UA über die pdf-lib-Brücke |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Interop-Hilfen (UI)** (Querschnitt, via `init`): Feineinstellungen beim Start des Bild-Konverters — `src/Pagebound.Infrastructure/Pdf/JsImageToPdfConverter.cs:62`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

Das ist die einzige ausgehende Kante im geprüften Graph. Die Brücken, die dieses Feature nutzt (`pdfjs-bridge.ts`, `pdf-manipulator-bridge.ts`), gehören zu „PDF-Reader & Rendering" bzw. „PDF-Werkzeuge & Manipulation"; die Kanten dorthin laufen umgekehrt — beide Features binden `IPdfConverter` bzw. `IPdfArchiveService` ein (`PdfToolsPanel.razor:6`, `BatchPage.razor:4`).

### Extern (Packages)

- `pdfjs-dist` — Seiten rastern (PNG, JPG, PPTX-Folien), Text mit Geometrie extrahieren (Text, HTML, CSV, DOCX, XLSX), Operatorliste für SVG
- `pdf-lib` — Bilder einbetten, XMP, OutputIntent und Trailer für PDF/A und PDF/UA umbauen
- `fflate` — ZIP für Mehrdatei-Ergebnisse und die OOXML-Pakete
- **Liberation Fonts** (SIL OFL 1.1, mitgeliefert) — metrisch kompatible Ersatzschriften für nicht eingebettete Standard-14-Schriften im PDF/A-Pfad

## Öffentliche API / Interface

```csharp
public interface IPdfConverter
{
    // PNG/JPG/SVG liefern ein ZIP (eine Datei je Seite), Text/HTML/CSV eine Datei.
    Task<ConversionResult> ConvertAsync(byte[] pdf, ConversionFormat format, CancellationToken ct);
}

public interface IImageToPdfConverter
{
    // Wirft bei leerer Liste oder nicht unterstütztem Bildformat.
    Task<byte[]> ConvertAsync(IReadOnlyList<PdfImageInput> images, ImageToPdfOptions options, CancellationToken ct);
}

public interface IPdfArchiveService
{
    Task<PdfArchiveResult> ConvertToPdfAAsync(Stream pdf, bool flattenForm, bool embedFonts, CancellationToken ct);
    Task<PdfArchiveResult> PreparePdfUaAsync(Stream pdf, string language, CancellationToken ct);
}
// PdfArchiveResult(byte[] Bytes, IReadOnlyList<string> Warnings)
```

**Was PDF/A konkret tut:** XMP-Metadaten (`pdfaid:part=2`, `conformance=B`), sRGB-OutputIntent, Entfernen aktiver Inhalte (`/OpenAction`, Dokument-JavaScript, Additional Actions), auf Wunsch AcroForm flatten, Trailer-Id. Nicht eingebettete Standard-14-Schriften werden optional durch eingebettete Liberation-Fonts ersetzt; andere fehlende Schriften gibt es nur als Warnung. Externes Prüfen (etwa veraPDF) ist empfohlen, weil die eigene Umsetzung ihre eigene Konformität nicht beweisen kann. PDF/A verlangt unverschlüsselte Eingaben.

**Was PDF/UA konkret tut:** nur die Kennzeichnung — `/MarkInfo`, `/Lang` als BCP-47, `/DisplayDocTitle`, XMP `pdfuaid:part=1` — plus einen ehrlichen Bericht (fehlendes Tagging, fehlender Titel, Bilder ohne Alternativtext, Schriften ohne ToUnicode). **Echtes Tagging wird nicht erfunden.**

## Datenfluss / Call-Flow

1. **PDF → PNG/JPG:** `JsPdfConverter.ConvertAsync` → PDF.js rendert je Seite auf Canvas → `convertToImagesZip` (`pdfjs-bridge.ts:823`) → ZIP.
2. **PDF → Text/HTML/CSV:** Text je Seite extrahieren (`convertToText`, `pdfjs-bridge.ts:600`) → ins Zielformat aufbereiten → eine Datei.
3. **PDF → DOCX:** Text-Items je Seite zu Zeilen gruppieren (y-Cluster), daraus Absätze über die vertikale Lücke, Schriftgröße aus der Median-Item-Höhe, Seitenumbruch je PDF-Seite. Das `.docx` wird **von Hand als OOXML-ZIP** gebaut (fflate) — keine DOCX-Bibliothek, keine neue Laufzeit-Abhängigkeit. Best-Effort-Textfluss, **keine Layout-Treue**; für Pixeltreue sind HTML oder PNG da.
4. **PDF → XLSX:** dieselbe Tabellen-Heuristik wie CSV, je Seite ein Blatt (SpreadsheetML, Inline-Strings, Zahlen als Zahl), ebenfalls von Hand als OOXML-ZIP.
5. **PDF → PPTX:** je Seite ein PNG, eine Folie mit dem Bild vollflächig. Reine Bildfolien, kein Textlayer.
6. **PDF → SVG:** die Operatorliste von PDF.js wird in SVG übersetzt, Schriften eingebettet; ein SVG je Seite, als ZIP (Hilfsfunktionen ab `pdfjs-bridge.ts:853`).
7. **Bilder → PDF:** `imagesToPdf` (`pdf-manipulator-bridge.ts:500`) bettet PNG und JPG nativ ein.
8. **PDF/A und PDF/UA:** `JsPdfArchiveService` → Brücke → pdf-lib-Umbau → `PdfArchiveResult` mit Bytes und Warnungen, die die Oberfläche anzeigt.

## Offene Fragen / TODOs

- Drei OOXML-Formate werden von Hand erzeugt. Ob das Ergebnis in jeder Office-Version öffnet, ist nicht gegen echte Zielprogramme geprüft — eine Prüfung mit dem eigenen Leser würde den eigenen Fehler wiederholen.
- Der frühere Stand dieser Datei kannte `Svg` nicht. Der Enum-Kommentar verlangt, neue Formate **nur anzuhängen** (`ConversionTypes.cs:11`), weil die Werte serialisiert in Stapel-Regeln landen.
