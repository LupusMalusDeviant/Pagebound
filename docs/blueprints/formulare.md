# Formulare (AcroForms)

## Zweck

Interaktive PDF-Formulare (AcroForms) lesen, ausfüllen und wahlweise flatten (FA-040/041) — plus ein Form-Builder, mit dem neue Formularfelder (Text/Checkbox) per Klick auf der Seite platziert werden. Das Ausfüllen ist auch direkt im Reader über ein Formular-Panel möglich.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IPdfFormService.cs` | Interface: `GetFieldsAsync` (Felder lesen) + `FillAsync` (Werte setzen, optional flatten) |
| `src/Pagebound.Core/Domain/PdfFormTypes.cs` | Domain-Typen: `PdfFormFieldType` (Text/Checkbox/Radio/Dropdown/ListBox), `FormSaveMode` (KeepEditable/Flatten), `PdfFormField`, `FormFieldValue`, `FillFormOptions` |
| `src/Pagebound.Infrastructure/Pdf/JsPdfFormService.cs` | Implementierung über die pdf-lib-Bridge (`pageboundPdfManipulator.getFormFields` / `.fillForm`) |
| `src/Pagebound.Web/Features/PdfTools/FormBuilderPage.razor` | Form-Builder: Felder auf Seiten platzieren, erzeugt AcroForm-Felder |
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Formular-Panel im Reader: Feldliste anzeigen, Werte eingeben, speichern/flatten |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `CreateFormFieldsAsync`: legt neue Text-/Checkbox-Felder an Positionen in 0..1-Page-Fractions an (Roadmap D1) |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | JS-Seite der Form-Funktionen (pdf-lib-Form-API) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Werkzeuge** — genutzt für `CreateFormFieldsAsync` (Feld-Erzeugung im Form-Builder) und die gemeinsame pdf-lib-Bridge. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **PDF-Reader** — genutzt für die Seitenanzeige, auf der der Form-Builder Felder platziert, und für das Formular-Panel in `ReaderPane.razor`. Siehe [`./pdf-reader.md`](./pdf-reader.md).

### Extern (Packages)
- **pdf-lib** (JS, self-hosted) — vollständige AcroForm-API (lesen, füllen, flatten, Felder erzeugen). Bewusst statt PdfSharpCore, dessen Save-Pfad unter Blazor WASM auf `MD5.Create()` crasht (siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md)).

## Öffentliche API / Interface

```csharp
public interface IPdfFormService
{
    // Alle Felder der PDF; leere Liste, wenn kein AcroForm vorhanden.
    Task<IReadOnlyList<PdfFormField>> GetFieldsAsync(Stream pdf, CancellationToken ct);

    // Setzt Feldwerte; je nach FillFormOptions.Mode bleibt das Formular
    // editierbar (KeepEditable) oder wird geflattet (Flatten).
    Task<byte[]> FillAsync(Stream pdf, IReadOnlyList<FormFieldValue> values,
                           FillFormOptions options, CancellationToken ct);
}
```

Wichtige Domain-Details:
- `PdfFormField.Value` ist mehrwertig: Textfelder 0..1 Einträge, Checkboxen `["true"]` oder leer, Radio/Dropdown 0..1, ListBox 0..n; `Options` listet wählbare Optionen.
- `PdfFormField` trägt bewusst **keine Positionsangaben** — Phase 1 ist eine Feldliste, das In-Place-Overlay (Phase 2) ergänzt die Geometrie separat.
- Signatur-Felder sind nicht abgebildet: handschriftliche Signaturen laufen über FA-015 (PNG), zertifikatsbasierte (PAdES) sind als FA-043 nach 1.0 verschoben.
- Feld-Erzeugung (Form-Builder): `IPdfManipulator.CreateFormFieldsAsync(Stream pdf, IReadOnlyList<FormFieldRegion> fields, CancellationToken)` mit `FormFieldRegion(PageNumber, X, Y, Width, Height, Name, FieldType)` in 0..1-Page-Fractions (Ursprung oben-links), `FieldType` = `"text"` oder `"checkbox"`.

## Datenfluss / Call-Flow

1. **Lesen:** Reader/UI → `JsPdfFormService.GetFieldsAsync` → Bridge `getFormFields` → pdf-lib liest AcroForm → Feldliste als `PdfFormField[]` zurück ans Formular-Panel.
2. **Füllen:** Nutzer editiert Werte im Panel → `FillAsync(values, options)` → Bridge `fillForm` → pdf-lib setzt Werte, flattet optional → neue PDF-Bytes → Speichern/Download.
3. **Bauen:** `FormBuilderPage.razor` — Nutzer platziert Felder auf der gerenderten Seite (Fractions-Koordinaten) → `CreateFormFieldsAsync` → pdf-lib legt AcroForm-Felder an → Ergebnis-PDF.

## Offene Fragen / TODOs

- Phase 2 (In-Place-Overlay mit Feld-Geometrie direkt auf der Seite) steht noch aus; aktuell ist das Ausfüllen listenbasiert.
