# Formulare (AcroForms)

## Zweck

Interaktive PDF-Formulare lesen, ausfüllen und wahlweise festschreiben (flatten), plus ein Form-Builder, der neue Text- und Ankreuzfelder per Klick auf der Seite platziert. Ausfüllen geht sowohl auf der eigenen Seite `/form-builder` als auch direkt im Reader über ein Formular-Panel.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Abstractions/IPdfFormService.cs` | Vertrag: Felder lesen, Werte setzen, optional flatten (`:14`) |
| `src/Pagebound.Core/Domain/PdfFormTypes.cs` | `PdfFormFieldType` (Text, Checkbox, Radio, Dropdown, ListBox), `FormSaveMode` (KeepEditable, Flatten), `PdfFormField`, `FormFieldValue`, `FillFormOptions` |
| `src/Pagebound.Infrastructure/Pdf/JsPdfFormService.cs` | Umsetzung über die pdf-lib-Brücke (`getFormFields`, `fillForm`) |
| `src/Pagebound.Web/Features/PdfTools/FormBuilderPage.razor` | Seite `/form-builder` (`:1`): Felder auf der gerenderten Seite platzieren |
| `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts` | JS-Seite: `getFormFields` (`:361`), `fillForm` (`:421`) |

Das Formular-Panel im Reader liegt in `src/Pagebound.Web/Features/Reader/ReaderPane.razor` und gehört dort zum Reader-Feature; die Kante dazu steht als eingehende Kante von „PDF-Reader & Rendering" im Graph.

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **PDF-Werkzeuge & Manipulation** (Laufzeit, via `IPdfManipulator`): `CreateFormFieldsAsync` legt die neuen Felder an — `src/Pagebound.Web/Features/PdfTools/FormBuilderPage.razor:5`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **PDF-Reader & Rendering** (Typ, via `LoadResult`, `registerFormBuilder`): die Seite, auf der platziert wird, kommt aus der PDF.js-Brücke — `…/FormBuilderPage.razor:145`. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `…/FormBuilderPage.razor:6`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `init`): Feineinstellungen beim Start des Dienstes — `src/Pagebound.Infrastructure/Pdf/JsPdfFormService.cs:119`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

### Extern (Packages)

- `pdf-lib` (self-hosted) — vollständige AcroForm-API: lesen, füllen, flatten, Felder anlegen

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IPdfFormService.cs:14
public interface IPdfFormService
{
    // Alle Felder der PDF; leere Liste, wenn kein AcroForm vorhanden ist.
    Task<IReadOnlyList<PdfFormField>> GetFieldsAsync(Stream pdf, CancellationToken ct);

    // Setzt Feldwerte; FillFormOptions.Mode entscheidet zwischen
    // KeepEditable und Flatten.
    Task<byte[]> FillAsync(Stream pdf, IReadOnlyList<FormFieldValue> values,
                           FillFormOptions options, CancellationToken ct);
}
```

Verträge im Detail:

- `PdfFormField.Value` ist mehrwertig: Textfelder 0..1 Einträge, Ankreuzfelder `["true"]` oder leer, Radio und Dropdown 0..1, ListBox 0..n. `Options` listet die wählbaren Werte.
- `PdfFormField` trägt **bewusst keine Position**. Stufe 1 ist eine Feldliste; das Overlay direkt auf der Seite (Stufe 2) würde die Geometrie separat ergänzen.
- Signaturfelder sind hier nicht abgebildet. Handschriftliche Signaturen laufen als Annotation, zertifikatbasierte über `IPdfSignService` — siehe [`./signatur-integritaet.md`](./signatur-integritaet.md).
- Feld-Erzeugung: `IPdfManipulator.CreateFormFieldsAsync` (`IPdfManipulator.cs:114`) mit `FormFieldRegion(PageNumber, X, Y, Width, Height, Name, FieldType)` in Seitenanteilen 0..1, Ursprung oben links; `FieldType` ist `"text"` oder `"checkbox"`.

## Datenfluss / Call-Flow

1. **Lesen:** Oberfläche → `JsPdfFormService.GetFieldsAsync` → Brücke `getFormFields` (`pdf-manipulator-bridge.ts:361`) → pdf-lib liest das AcroForm → Feldliste.
2. **Füllen:** Nutzer trägt Werte ein → `FillAsync` → Brücke `fillForm` (`:421`) → pdf-lib setzt die Werte und flattet auf Wunsch → neue Bytes → Download.
3. **Bauen:** `FormBuilderPage.razor` platziert Felder in Seitenanteilen (`:145` holt die Seite über die Reader-Brücke) → `CreateFormFieldsAsync` → pdf-lib legt die AcroForm-Felder an.

## Offene Fragen / TODOs

- Stufe 2 (Felder direkt an ihrer Position auf der Seite ausfüllen) steht aus; aktuell ist das Ausfüllen listenbasiert, was bei großen Formularen die Zuordnung erschwert.
- Für die Formular-Pfade gibt es keine Prüfung auf der UI-Schicht — `Pagebound.Web.Tests` ist leer.
