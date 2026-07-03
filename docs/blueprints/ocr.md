# OCR (Texterkennung)

## Zweck

Texterkennung auf gescannten/bildbasierten PDF-Seiten (FA-050) — vollständig lokal im Browser über Tesseract.js, **self-hosted ohne CDN** (Datenschutz/Offline-PWA). Unterstützte Sprachen: Englisch und Deutsch (`eng`, `deu`, `eng+deu`). Die Erkennung läuft in einem Web Worker; das Ergebnis liefert neben dem Text auch Wort-Bounding-Boxen, aus denen der Reader einen OCR-Text-Layer für Selektion und Suche baut.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IOcrService.cs` | Interface: `RecognizePageAsync(imageDataUrl, languages, ct)` → `OcrPageResult` |
| `src/Pagebound.Core/Domain/OcrTypes.cs` | `OcrWord(Text, X, Y, Width, Height, Confidence)` + `OcrPageResult(Text, Confidence, Words, ImageWidth, ImageHeight)` |
| `src/Pagebound.Infrastructure/Ocr/TesseractOcrService.cs` | `IOcrService`-Implementierung — delegiert per JS-Interop an die OCR-Bridge |
| `src/Pagebound.Web/wwwroot/js/ocr-bridge.ts` | JS-Bridge: initialisiert den Tesseract.js-Worker (self-hosted Pfade), führt `recognize` aus, mappt Wörter |
| `src/Pagebound.Web/wwwroot/tesseract/` | Self-hosted Tesseract-Assets: `tesseract-core-simd-lstm.wasm(.js)`, `worker.min.js` |
| `src/Pagebound.Web/wwwroot/tessdata/` | Sprachmodelle: `eng.traineddata.gz`, `deu.traineddata.gz` |
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | OCR-Integration im Reader: Seite als Bild an OCR geben, Text-Layer aus `OcrWord`-Boxen legen |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Reader** — genutzt für das gerenderte Seitenbild (Data-URL als OCR-Input) und den Text-Layer, in den die erkannten Wörter für Selektion/Suche gemappt werden. Siehe [`./pdf-reader.md`](./pdf-reader.md).

### Extern (Packages)
- **Tesseract.js** (self-hosted, kein CDN) — WASM-Core (`tesseract-core-simd-lstm`), Worker, LSTM-Sprachmodelle `eng`/`deu` als gzip-komprimierte traineddata.

## Öffentliche API / Interface

```csharp
public interface IOcrService
{
    // imageDataUrl: vollständige data:image/...;base64,...-URL des Seitenbildes.
    // languages: Tesseract-Codes, z. B. "eng", "deu", "eng+deu".
    Task<OcrPageResult> RecognizePageAsync(string imageDataUrl, string languages, CancellationToken ct);
}
```

Koordinaten-Kontrakt: `OcrWord`-Boxen sind **Pixel relativ zum Eingabebild**; das Mapping zurück in PDF-Page-Punkte macht der Aufrufer über `OcrPageResult.ImageWidth`/`ImageHeight` (Skalierungsfaktor Bild → Seite). `Confidence` gibt es pro Wort und aggregiert pro Seite.

## Datenfluss / Call-Flow

1. Reader (`ReaderPane.razor`) rendert die Seite via PDF.js auf ein Canvas und exportiert sie als Data-URL.
2. `TesseractOcrService.RecognizePageAsync` ruft per JS-Interop die `ocr-bridge.ts`.
3. Die Bridge startet (einmalig) den Tesseract.js-Worker mit self-hosted Pfaden (`wwwroot/tesseract/` für Core/Worker, `wwwroot/tessdata/` für die Sprachmodelle) — es geht kein Byte an ein CDN.
4. Der Worker erkennt den Text (LSTM, `eng+deu` möglich) und liefert Text, Konfidenzen und Wort-Boxen.
5. Der Reader legt aus den Boxen einen unsichtbaren Text-Layer über die Seite — der erkannte Text ist damit selektier- und durchsuchbar wie nativer PDF-Text.

## Offene Fragen / TODOs

- Persistierung der OCR-Ergebnisse pro PDF (statt Erkennung pro Sitzung) ist laut `IOcrService`-Kommentar für Release 0.9 vorgesehen, sobald die Library-Storage gehärtet ist.
- Weitere Sprachen wären nur ein zusätzliches `*.traineddata.gz` in `wwwroot/tessdata/` plus UI-Auswahl.
