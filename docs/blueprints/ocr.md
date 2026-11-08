# OCR (Texterkennung)

## Zweck

Texterkennung auf gescannten, bildbasierten Seiten — vollständig lokal über Tesseract.js, mit **mitgeliefertem** WASM-Kern, Worker und Sprachmodellen. Kein CDN, kein Dienst, kein Byte nach draußen; das ist hier nicht Bequemlichkeit, sondern die Kernzusage des Produkts. Das Ergebnis liefert neben dem Text auch Wortkästen, aus denen der Reader einen unsichtbaren Textlayer über die Seite legt — damit sind Auswahl und Suche auf einem Scan möglich.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IOcrService.cs` | Vertrag `RecognizePageAsync(imageDataUrl, languages, ct)` → `OcrPageResult` (`:10`) |
| `src/Pagebound.Core/Domain/OcrTypes.cs` | `OcrWord(Text, X, Y, Width, Height, Confidence)`, `OcrPageResult(Text, Confidence, Words, ImageWidth, ImageHeight)` |
| `src/Pagebound.Infrastructure/Ocr/TesseractOcrService.cs` | `IOcrService` über die OCR-Brücke |
| `src/Pagebound.Web/wwwroot/js/ocr-bridge.ts` | Startet den Worker mit mitgelieferten Pfaden, `recognizePage` (`:80`), `terminate` (`:144`) |
| `src/Pagebound.Web/wwwroot/tesseract/` | Mitgelieferte Tesseract-Teile: tesseract-core-simd-lstm.wasm, der zugehörige JS-Lader und worker.min.js |
| `src/Pagebound.Web/wwwroot/tessdata/` | Sprachmodelle `eng.traineddata.gz`, `deu.traineddata.gz` |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

Dieses Feature hat **keine ausgehende Kante** im geprüften Graph: es hängt an nichts anderem im Repo, nur an seinen eigenen Dateien und am Browser.

Eingehend (zur Orientierung, keine ausgehende Abhängigkeit): „PDF-Reader & Rendering" bindet `IOcrService` ein (`src/Pagebound.Web/Features/Reader/ReaderPane.razor:16`) und liefert das Seitenbild.

### Extern (Packages)

- **Tesseract.js** (mitgeliefert, kein CDN) — WASM-Kern `tesseract-core-simd-lstm`, Worker, LSTM-Sprachmodelle `eng` und `deu` als gzip-komprimierte traineddata

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IOcrService.cs:10
public interface IOcrService
{
    // imageDataUrl: vollständige data:image/...;base64,...-URL des Seitenbildes.
    // languages: Tesseract-Codes, z. B. "eng", "deu", "eng+deu".
    Task<OcrPageResult> RecognizePageAsync(string imageDataUrl, string languages, CancellationToken ct);
}
```

**Koordinaten-Vertrag:** `OcrWord`-Kästen sind **Pixel relativ zum Eingabebild**, nicht Seitenanteile. Die Rückrechnung in Seitenpunkte macht der Aufrufer über `OcrPageResult.ImageWidth` und `ImageHeight`. Das ist der einzige Ort im Projekt, an dem Geometrie nicht in 0..1 übergeben wird — begründet darin, dass Tesseract das Bild sieht, nicht die Seite.

`Confidence` gibt es je Wort und aggregiert je Seite.

## Datenfluss / Call-Flow

1. Der Reader rendert die Seite über PDF.js auf ein Canvas und exportiert sie als Data-URL.
2. `TesseractOcrService.RecognizePageAsync` ruft per JS-Interop `recognizePage` (`ocr-bridge.ts:80`).
3. Die Brücke startet einmalig den Worker mit den **mitgelieferten** Pfaden — `wwwroot/tesseract/` für Kern und Worker, `wwwroot/tessdata/` für die Modelle.
4. Der Worker erkennt den Text und liefert Text, Konfidenzen und Wortkästen.
5. Der Reader legt aus den Kästen einen unsichtbaren Textlayer über die Seite; der erkannte Text verhält sich dann wie nativer PDF-Text.
6. `terminate` (`ocr-bridge.ts:144`) beendet den Worker. Das ist Pflicht und keine Kür: ein nicht beendeter Tesseract-Worker hält seinen WASM-Speicher, und davon gibt es in WASM wenig.

## Offene Fragen / TODOs

- OCR-Ergebnisse werden **nicht** pro PDF gespeichert; jede Sitzung erkennt neu. Der Kommentar in `IOcrService.cs` nennt das als Vorhaben, sobald die Bibliotheks-Speicherung gehärtet ist.
- Weitere Sprachen wären nur eine weitere `*.traineddata.gz` plus Auswahl in der Oberfläche — und mehr ausgelieferte Bytes.
- Die beiden minifizierten Tesseract-Bündel unter `wwwroot/tesseract/` sind im Blueprint **absichtlich keinem Feature zugeordnet**: als minifizierter Fremdcode ziehen sie Namenskollisionen mit halber Codebase an und würden den Kantengraph verfälschen. Siehe „Bewusste Reste" in [`./INDEX.md`](./INDEX.md).
