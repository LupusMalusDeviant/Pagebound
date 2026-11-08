# PDF-Werkzeuge & Manipulation

## Zweck

Alles, was ein PDF verändert: Zusammenfügen, Teilen, Seiten ordnen, drehen, löschen, Stempel und Wasserzeichen, Metadaten, Kompression, AES-256-Verschlüsselung, Annotationen einbrennen, Schwärzen, Text bearbeiten und Formularfelder anlegen. Alle Operationen laufen über **eine** Brücke zu pdf-lib — PdfSharpCore ist bewusst draußen, weil sein Speicherpfad unter WASM an `MD5.Create()` abbricht (ADR-004, begründet in `src/Pagebound.Web/Program.cs:38`–`41`).

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/PdfTools/PdfToolsPage.razor` | Seite `/tools` (`:1`) mit Kategorien |
| `src/Pagebound.Web/Features/PdfTools/PdfToolsPanel.razor` | Die eigentliche Werkzeug-Oberfläche, auch im Reader eingebettet |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `IPdfManipulator` über die pdf-lib-Brücke; mappt die Annotationstypen (`:220`) und die Signatur (`:305`) |
| `src/Pagebound.Infrastructure/Pdf/JsPdfEncryptor.cs` | `IPdfEncryptor`: Verschlüsselung als eigener Dienst |
| `src/Pagebound.Infrastructure/Pdf/Encryption/AesR6.cs` | AES-256 nach Revision 6 (managed, kein WASM-inkompatibler Fremdcode) |
| `src/Pagebound.Core/Domain/PdfManipulatorTypes.cs` | `CompressionOptions`, `EncryptionOptions`, `PageOp`, `PdfMetadata`, `FormFieldRegion`, `TextEditRegion`, `RedactionRegion` |
| `src/Pagebound.Core/Domain/StampTypes.cs` | Stempel und Wasserzeichen: Text, Position, Deckkraft, Seitenzahlen |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | pdf-lib-Seite: `embedSignatures` (`:62`), `compressPdf` (`:147`), `redactPdf` (`:212`), `getFormFields` (`:361`), `fillForm` (`:421`), `imagesToPdf` (`:500`), `normalizePdf` (`:561`), `mergePdfs` (`:566`) |
| `src/Pagebound.Web/wwwroot/js/page-geometry.ts` | Seitengeometrie: Rotation normalisieren (`:39`), Anzeigeraum betreten und verlassen (`:93`, `:100`), `withDisplaySpace` (`:109`) |
| `src/Pagebound.Web/tests-js/geometry.test.mjs` | Prüft die Geometrie gegen gedrehte und beschnittene Seiten |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Annotationen** (Typ, via `Annotation`, `AnnotationType`, `HighlightAnnotation`, `InkAnnotation`, `ShapeAnnotation`): Einbrennen in das PDF — `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs:220`. Siehe [`./annotationen.md`](./annotationen.md).
- **Signatur & Integrität** (Typ, Laufzeit, via `SignatureAnnotation`, `IPdfSignService`): Signaturen einbetten — `…/JsPdfLibManipulator.cs:305`. Siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).
- **Konvertierung & Standards** (Typ, Laufzeit, via `IImageToPdfConverter`, `IPdfConverter`, `IPdfArchiveService`, `ConversionFormat`, `PdfPageSizeMode`): die Werkzeugleiste bietet Konvertierungen mit an — `src/Pagebound.Web/Features/PdfTools/PdfToolsPanel.razor:6`. Siehe [`./konvertierung.md`](./konvertierung.md).
- **PDF-Reader & Rendering** (Typ, Laufzeit, via `IPdfRenderer`, `PdfDocumentHandle`, `LoadOptions`, `RenderOptions`): Vorschau der Seiten im Werkzeug-Panel — `…/PdfToolsPanel.razor:4`. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Library & Workspace** (Typ, via `ByteSizeFormatter`): Dateigrößen anzeigen — `…/PdfToolsPanel.razor:1136`. Siehe [`./library-workspace.md`](./library-workspace.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `…/PdfToolsPanel.razor:9`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `init`, `save`, `apply`, `load`, `downloadBytes`): Download der Ergebnisse, Feineinstellungen — `…/JsPdfLibManipulator.cs:522`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).
- **MCP-Server** (Typ, via `catalog`): **Namensgleichheit, keine Abhängigkeit.** `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts:1032` ist eine lokale Variable auf `doc.catalog` von pdf-lib. Siehe die Anmerkung in [`./INDEX.md`](./INDEX.md).

### Extern (Packages)

- `pdf-lib` (self-hosted) — die gesamte Manipulation. Bewusst statt PdfSharpCore (ADR-004).
- `@pdf-lib/fontkit` — Font-Einbettung für Stempel und eingebrannten Text
- `fflate` — ZIP für Sammel-Ergebnisse

## Öffentliche API / Interface

```csharp
public interface IPdfManipulator
{
    Task<byte[]> MergeAsync(IReadOnlyList<Stream> pdfs, CancellationToken ct);                      // :16
    Task<IReadOnlyList<byte[]>> SplitAsync(Stream pdf, IReadOnlyList<int> splitAfterPages, …);      // :20
    Task<byte[]> ReorderAsync(Stream pdf, IReadOnlyList<int> newOrder, …);                          // :25
    Task<byte[]> DeletePagesAsync(Stream pdf, IReadOnlyList<int> pageIndices, …);                   // :30
    Task<byte[]> RotateAsync(Stream pdf, IReadOnlyDictionary<int, int> rotationDegrees, …);         // :35
    Task<byte[]> CompressAsync(…);                                                                  // :40
    Task<byte[]> EncryptAsync(…);                                                                   // :46
    Task<byte[]> EmbedSignaturesAsync(…);                                                           // :58
    Task<byte[]> StampAsync(…);                                                                     // :67
    Task<byte[]> FlattenAnnotationsAsync(…);                                                        // :79
    Task<byte[]> RedactAsync(…);                                                                    // :91
    Task<byte[]> ApplyTextEditsAsync(…);                                                            // :104
    Task<byte[]> CreateFormFieldsAsync(…);                                                          // :114
    Task<byte[]> CreateBlankAsync(double widthPt, double heightPt, int pageCount, …);               // :124
    Task<byte[]> AppendBlankPageAsync(Stream pdf, double widthPt, double heightPt, …);              // :127
    Task<byte[]> OrganizePagesAsync(Stream pdf, IReadOnlyList<PageOp> ops, …);                      // :135
    Task<byte[]> SetMetadataAsync(Stream pdf, PdfMetadata metadata, …);                             // :138
    Task<PdfMetadata> GetMetadataAsync(Stream pdf, …);                                              // :141
}

public interface IPdfEncryptor
{
    Task<byte[]> EncryptAsync(Stream pdf, EncryptionOptions options, CancellationToken ct);
}
```

Zeilenangaben beziehen sich auf `src/Pagebound.Core/Abstractions/IPdfManipulator.cs` bzw. `IPdfEncryptor.cs:14`.

## Datenfluss / Call-Flow

1. Die Oberfläche (`PdfToolsPanel.razor`) sammelt Eingabedateien und Optionen.
2. Der passende Aufruf geht an `JsPdfLibManipulator`, der die Bytes per JS-Interop an `pdf-manipulator-bridge.ts` gibt.
3. Die Brücke arbeitet mit pdf-lib und gibt neue Bytes zurück. Geometrie läuft immer über `page-geometry.ts`, damit gedrehte und beschnittene Seiten (`/Rotate`, `/CropBox`) richtig behandelt werden (`withDisplaySpace`, `page-geometry.ts:109`).
4. Das Ergebnis wird über die Interop-Brücke als Download angeboten (`downloadBytes`), nie hochgeladen.
5. Verschlüsselung geht **nicht** durch pdf-lib, sondern durch `AesR6.cs` — managed AES-256 nach Revision 6. Dieser Pfad ist off-limits für Änderungen ohne ausdrückliche Freigabe.

## Offene Fragen / TODOs

- `PdfToolsPanel.razor` ist mit über 1100 Zeilen die zweite große Sammelkomponente; sie hat acht ausgehende Kanten.
- Mehrere Operationen reichen vollständige Byte-Arrays durch mehrere Schichten. Bei großen PDFs ist das der Hauptverdächtige für Speicherdruck; die Leitplanke verlangt `ArrayBuffer`/`Blob` statt base64-Umwege.
