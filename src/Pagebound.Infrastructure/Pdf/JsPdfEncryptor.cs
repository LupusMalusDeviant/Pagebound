using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfEncryptor"/>-Implementation für Blazor WASM: verschlüsselt über
/// die JS-Bridge (<c>pageboundPdfManipulator.encryptPdf</c>) — AES-256
/// (ISO 32000-2 V5/R6) mit hardware-beschleunigtem <b>WebCrypto</b>. ~15 ms statt
/// ~30 s (managed AES fror den Single-Thread-WASM ein). Im Browser gegen PDF.js
/// verifiziert (öffnet mit Passwort, weist falsches ab).
///
/// MVP-Grenze: nur Streams werden verschlüsselt (<c>/StmF /StdCF /CFM AESV3</c>),
/// Strings bleiben Klartext (<c>/StrF /Identity</c>).
///
/// Die managed Referenz-Implementierung (<c>AesR6</c> + <c>PdfAesEncryptor</c>,
/// unit-getestet) bleibt als Algorithmus-Referenz / möglicher Desktop-Pfad erhalten.
/// Passwort-Semantik: ist nur ein Owner-Passwort gesetzt, dient es auch als
/// User-Passwort (das eine Passwort ist dann zum Öffnen nötig).
/// </summary>
public sealed class JsPdfEncryptor : IPdfEncryptor
{
    private readonly IJSRuntime _js;

    public JsPdfEncryptor(IJSRuntime js) => _js = js;

    public async Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrEmpty(options.OwnerPassword))
            throw new ArgumentException("Owner-Passwort darf nicht leer sein.", nameof(options));

        byte[] input;
        await using (var ms = new MemoryStream())
        {
            await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
            input = ms.ToArray();
        }

        var owner = options.OwnerPassword;
        var user = string.IsNullOrEmpty(options.UserPassword) ? owner : options.UserPassword!;

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.encryptPdf",
                cancellationToken,
                input, owner, user, -1).ConfigureAwait(false);
            return result ?? input;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:encrypt] WebCrypto encryptPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }
}
