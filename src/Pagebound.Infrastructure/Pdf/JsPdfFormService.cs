using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfFormService"/>-Implementation für Blazor WASM. Liest und füllt
/// AcroForms über die pdf-lib-JS-Bridge
/// (<c>pageboundPdfManipulator.getFormFields</c> / <c>.fillForm</c>).
///
/// Hintergrund wie bei <see cref="JsPdfLibManipulator"/>: PdfSharpCores
/// Save-Pfad ruft unter Blazor WASM <c>MD5.Create()</c> auf und crasht — pdf-lib
/// hat diese Abhängigkeit nicht und bringt eine vollständige Form-API mit.
/// </summary>
public sealed class JsPdfFormService : IPdfFormService
{
    private readonly IJSRuntime _js;

    public JsPdfFormService(IJSRuntime js) => _js = js;

    public async Task<IReadOnlyList<PdfFormField>> GetFieldsAsync(
        Stream pdf,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        var pdfBytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);

        try
        {
            var dtos = await _js.InvokeAsync<JsFormField[]>(
                "pageboundPdfManipulator.getFormFields",
                cancellationToken,
                pdfBytes).ConfigureAwait(false);

            if (dtos is null || dtos.Length == 0)
            {
                return Array.Empty<PdfFormField>();
            }

            return dtos.Select(d => new PdfFormField(
                Name: d.Name,
                Type: ParseType(d.Type),
                Value: d.Value ?? Array.Empty<string>(),
                Options: d.Options ?? Array.Empty<string>(),
                ReadOnly: d.ReadOnly,
                Required: d.Required,
                PageNumber: d.PageNumber)).ToList();
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:getFormFields] pdf-lib getFormFields fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> FillAsync(
        Stream pdf,
        IReadOnlyList<FormFieldValue> values,
        FillFormOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(values);
        ArgumentNullException.ThrowIfNull(options);

        var pdfBytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);

        // Property-Namen müssen (camelCase) zu FormFieldValueDto in
        // pdf-manipulator-bridge.ts passen.
        var payload = values.Select(v => new JsFormFieldValue
        {
            Name = v.Name,
            Value = v.Value?.ToArray() ?? Array.Empty<string>()
        }).ToArray();

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.fillForm",
                cancellationToken,
                pdfBytes,
                payload,
                new { flatten = options.Mode == FormSaveMode.Flatten }).ConfigureAwait(false);
            return result ?? pdfBytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:fillForm] pdf-lib fillForm fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    private static async Task<byte[]> ReadAllAsync(Stream pdf, CancellationToken cancellationToken)
    {
        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
        return ms.ToArray();
    }

    /// <summary>
    /// Mappt den von der Bridge gelieferten Typ-Token auf das Domain-Enum.
    /// Öffentlich, damit der JS↔C#-Token-Vertrag in einem Unit-Test gepinnt
    /// werden kann (siehe JsPdfFormServiceTests).
    /// </summary>
    public static PdfFormFieldType ParseType(string? type) => type switch
    {
        "Text" => PdfFormFieldType.Text,
        "Checkbox" => PdfFormFieldType.Checkbox,
        "Radio" => PdfFormFieldType.Radio,
        "Dropdown" => PdfFormFieldType.Dropdown,
        "ListBox" => PdfFormFieldType.ListBox,
        _ => PdfFormFieldType.Text
    };

    /// <summary>DTO für die Deserialisierung der Bridge-Antwort (Type als String).</summary>
    private sealed class JsFormField
    {
        public string Name { get; init; } = string.Empty;
        public string Type { get; init; } = "Text";
        public string[] Value { get; init; } = Array.Empty<string>();
        public string[] Options { get; init; } = Array.Empty<string>();
        public bool ReadOnly { get; init; }
        public bool Required { get; init; }
        public int PageNumber { get; init; }
    }

    /// <summary>DTO für die Übergabe der Feldwerte an die Bridge (camelCase).</summary>
    private sealed class JsFormFieldValue
    {
        public string Name { get; init; } = string.Empty;
        public string[] Value { get; init; } = Array.Empty<string>();
    }
}
