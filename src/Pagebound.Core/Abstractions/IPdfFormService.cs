using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Liest und füllt interaktive PDF-Formulare (AcroForms, FA-040/041).
///
/// Default-Implementierung im Web-Pfad ist <c>JsPdfFormService</c>: läuft über
/// die pdf-lib-JS-Bridge (<c>pageboundPdfManipulator.getFormFields</c> /
/// <c>.fillForm</c>), weil PdfSharpCores Save-Pfad unter Blazor WASM auf
/// <c>MD5.Create()</c> crasht (siehe <c>JsPdfLibManipulator</c>), pdf-lib aber
/// eine vollständige Form-API mitbringt.
/// </summary>
public interface IPdfFormService
{
    /// <summary>
    /// Liest alle Formularfelder der PDF. Gibt eine leere Liste zurück, wenn die
    /// PDF kein AcroForm enthält.
    /// </summary>
    Task<IReadOnlyList<PdfFormField>> GetFieldsAsync(
        Stream pdf,
        CancellationToken cancellationToken);

    /// <summary>
    /// Setzt die übergebenen Feldwerte und gibt die gespeicherte PDF als Bytes
    /// zurück. Je nach <see cref="FillFormOptions.Mode"/> bleibt das Formular
    /// editierbar oder wird geflattet (Werte fixiert).
    /// </summary>
    Task<byte[]> FillAsync(
        Stream pdf,
        IReadOnlyList<FormFieldValue> values,
        FillFormOptions options,
        CancellationToken cancellationToken);
}
