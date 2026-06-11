using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfSignService"/> für Blazor WASM — dünne Hülle über die
/// <c>pageboundSign</c>-Bridge (wwwroot/js/sign-bridge.ts, <c>signPdf</c>;
/// pdf-lib + node-forge). Gleiches Muster wie <see cref="JsPdfArchiveService"/>:
/// die Logik lebt im JS, hier nur Marshalling. Zertifikat und Passwort gehen
/// ausschließlich an die lokale Bridge — nichts verlässt den Browser.
/// </summary>
public sealed class JsPdfSignService : IPdfSignService
{
    /// <summary>DTO der Bridge: signierte PDF als base64 + Subject + Hinweise (camelCase via STJ).</summary>
    private sealed record JsSignResult(string DataBase64, string SignerSubject, string[]? Warnings);

    private readonly IJSRuntime _js;

    public JsPdfSignService(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<PdfSignResult> SignAsync(Stream pdf, byte[] certificateP12, string password, PdfSignOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(certificateP12);
        ArgumentException.ThrowIfNullOrEmpty(password);
        ArgumentNullException.ThrowIfNull(options);

        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);

        try
        {
            var result = await _js.InvokeAsync<JsSignResult>(
                "pageboundSign.signPdf",
                cancellationToken,
                Convert.ToBase64String(ms.ToArray()),
                Convert.ToBase64String(certificateP12),
                password,
                new { reason = options.Reason, location = options.Location, contactInfo = options.ContactInfo }).ConfigureAwait(false);
            return new PdfSignResult(
                Convert.FromBase64String(result.DataBase64),
                result.SignerSubject,
                result.Warnings ?? Array.Empty<string>());
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:sign] signPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }
}
