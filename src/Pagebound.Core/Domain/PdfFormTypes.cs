namespace Pagebound.Core.Domain;

/// <summary>
/// Typ eines interaktiven Formularfeldes (AcroForm, FA-040).
/// Signatur-Felder sind bewusst nicht abgebildet — handschriftliche
/// Signaturen laufen über FA-015 (PNG-Signatur), zertifikatsbasierte
/// (PAdES) sind als FA-043 nach 1.0 verschoben.
/// </summary>
public enum PdfFormFieldType
{
    Text,
    Checkbox,
    Radio,
    Dropdown,
    ListBox
}

/// <summary>
/// Wie ein ausgefülltes Formular gespeichert wird (FA-041).
/// </summary>
public enum FormSaveMode
{
    /// <summary>Werte werden gesetzt, die Felder bleiben weiter ausfüllbar/änderbar.</summary>
    KeepEditable,

    /// <summary>Werte werden fest ins PDF eingebrannt; die Felder sind danach nicht mehr editierbar.</summary>
    Flatten
}

/// <summary>
/// Ein interaktives Formularfeld einer PDF (AcroForm, FA-040).
///
/// <para><see cref="Value"/> hält die aktuell gesetzten Werte: Textfelder 0..1
/// Einträge, Checkboxen <c>["true"]</c> oder leer, Radio/Dropdown 0..1, ListBox
/// 0..n. <see cref="Options"/> listet die wählbaren Optionen bei
/// Radio/Dropdown/ListBox (leer bei Text/Checkbox).</para>
///
/// <para>Positionsangaben fehlen bewusst — Phase 1 ist eine Feldliste; das
/// In-Place-Overlay (Phase 2) ergänzt die Geometrie separat.</para>
/// </summary>
public sealed record PdfFormField(
    string Name,
    PdfFormFieldType Type,
    IReadOnlyList<string> Value,
    IReadOnlyList<string> Options,
    bool ReadOnly,
    bool Required,
    int PageNumber);

/// <summary>
/// Ein vom Nutzer gesetzter Feldwert, der zurück ins PDF geschrieben wird.
/// <see cref="Value"/> ist mehrwertig, damit Multi-Select-ListBoxen abgedeckt
/// sind; einwertige Felder liefern 0..1 Einträge.
/// </summary>
public sealed record FormFieldValue(
    string Name,
    IReadOnlyList<string> Value);

/// <summary>
/// Optionen für das Speichern eines ausgefüllten Formulars (FA-041).
/// </summary>
public sealed record FillFormOptions(
    FormSaveMode Mode = FormSaveMode.KeepEditable);
