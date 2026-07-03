# Format-Konvertierung & Standards

## Zweck

Konvertiert PDFs in andere Formate — PNG/JPG (FA-030), Text (FA-031), HTML (FA-032), CSV, **DOCX** (Word, Best-Effort-Textfluss) — und Bilder (PNG/JPG) zurück in PDFs (FA-025). Dazu Standards-Aufbereitung als **Best Effort ohne Konformitätsgarantie**: PDF/A-2b-Nähe (Archivierung) und PDF/UA-1-Vorbereitung (Barrierefreiheit) mit ehrlichem Prüfbericht. Alles clientseitig im Browser.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IPdfConverter.cs` | Interface: `ConvertAsync(byte[] pdf, ConversionFormat, ct)` → `ConversionResult` |
| `src/Pagebound.Core/Abstractions/IImageToPdfConverter.cs` | Interface: Bilder (PNG/JPG) → PDF, je Bild eine Seite in Reihenfolge |
| `src/Pagebound.Core/Abstractions/IPdfArchiveService.cs` | Interface: `ConvertToPdfAAsync` (PDF/A-2b Best Effort) + `PreparePdfUaAsync` (PDF/UA-1-Kennzeichnung + Bericht) |
| `src/Pagebound.Core/Domain/ConversionTypes.cs` | `ConversionFormat` (Png, Jpg, Text, Html, Csv, Docx) + `ConversionResult(Bytes, FileExtension, MimeType)` |
| `src/Pagebound.Core/Domain/ImageToPdfTypes.cs` | `PdfImageInput` + `ImageToPdfOptions` |
| `src/Pagebound.Infrastructure/Pdf/JsPdfConverter.cs` | PDF→X über die PDF.js-Bridge (Seiten-Rendering bzw. Text-Extraktion) |
| `src/Pagebound.Infrastructure/Pdf/JsImageToPdfConverter.cs` | Bilder→PDF über die pdf-lib-Bridge (`pageboundPdfManipulator.imagesToPdf`) |
| `src/Pagebound.Infrastructure/Pdf/JsPdfArchiveService.cs` | PDF/A- und PDF/UA-Aufbereitung über die pdf-lib-Bridge (`convertToPdfA` / `preparePdfUa`) |
| `src/Pagebound.Web/Features/PdfTools/PdfToolsPage.razor` | UI-Einstieg (Kategorie-Tabs, u. a. Konvertierung/Standards) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader** — genutzt für die PDF.js-Bridge (Seiten-Rasterung für PNG/JPG, Text-Extraktion für Text/HTML/CSV). Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **PDF-Werkzeuge** — genutzt für die gemeinsame pdf-lib-Bridge (Bilder→PDF, PDF/A-/PDF/UA-Umbau, Form-Flatten vor PDF/A). Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Batch** — Konvertierungen sind als Export-Operation im Stapellauf nutzbar. Siehe [`./batch.md`](./batch.md).
- **MCP-Server** — Paritäts-Tools `pdf_to_pdfa` und `pdf_ua_prepare`. Siehe [`./mcp-server.md`](./mcp-server.md).

### Extern (Packages)
- **PDF.js** — Rendering + Text-Extraktion.
- **pdf-lib** — Bild-Einbettung, XMP/OutputIntent/Trailer-Umbauten für PDF/A/UA.
- **Liberation Fonts** (SIL OFL 1.1) — metrisch kompatible Ersatz-Fonts für nicht eingebettete Standard-14-Schriften im PDF/A-Pfad.

## Öffentliche API / Interface

```csharp
public interface IPdfConverter
{
    // PNG/JPG liefern ein ZIP (eine Bilddatei je Seite), Text/HTML die Textdatei.
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

Was PDF/A (Best Effort) konkret tut: XMP-Metadaten (`pdfaid:part=2`, `conformance=B`), sRGB-OutputIntent (GTS_PDFA1), Entfernen aktiver Inhalte (`/OpenAction`, Dokument-JavaScript, Additional Actions), optional AcroForm-Flatten, Trailer-ID; nicht eingebettete Standard-14-Fonts werden optional durch eingebettete Liberation-Fonts ersetzt, andere fehlende Fonts nur als Warnung gemeldet. Externes Prüfen (z. B. veraPDF) wird empfohlen. PDF/A verlangt unverschlüsselte Eingaben.

PDF/UA: setzt nur die Kennzeichnung (`/MarkInfo`, `/Lang` als BCP-47, `/DisplayDocTitle`, XMP `pdfuaid:part=1`) und liefert einen ehrlichen Prüfbericht (fehlendes Tagging, fehlender Titel, Bilder ohne Alternativtext, Fonts ohne ToUnicode) — **echtes Tagging wird nicht synthetisiert**.

## Datenfluss / Call-Flow

- **PDF→PNG/JPG:** `PdfToolsPage` → `JsPdfConverter.ConvertAsync` → PDF.js rendert jede Seite auf Canvas → Bilddateien → ZIP → `ConversionResult`.
- **PDF→Text/HTML/CSV:** PDF.js-Text-Extraktion pro Seite → Aufbereitung ins Zielformat → Textdatei als `ConversionResult`.
- **PDF→DOCX:** Bridge `convertToDocx` (pdfjs-bridge.ts) — PDF.js-Text-Items je Seite in Zeilen (y-Cluster) → Absätze (vertikale Lücke) rekonstruieren, Schriftgröße aus Median-Item-Höhe, Seitenumbruch je PDF-Seite; ein minimal-gültiges .docx wird **von Hand als OOXML-ZIP (fflate) gebaut** — keine docx-Lib, keine neue Laufzeit-Dependency. **Best-Effort-Textfluss, keine 1:1-Layout-Treue** (für Pixel-Treue HTML/PNG nutzen).
- **Bilder→PDF:** `JsImageToPdfConverter` → Bridge `imagesToPdf` → pdf-lib bettet PNG/JPG nativ ein (kein MD5 nötig) → PDF-Bytes.
- **PDF/A / PDF/UA:** `JsPdfArchiveService` → Bridge `convertToPdfA` / `preparePdfUa` → pdf-lib-Umbau → `PdfArchiveResult` mit Bytes + Warnungen, die die UI anzeigt.
