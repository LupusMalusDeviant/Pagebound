using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Pdf.Encryption;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfEncryptor"/>-Implementation: normalisiert die Eingabe über die
/// pdf-lib-JS-Bridge (<c>normalizePdf</c> → klassische, unkomprimierte Struktur)
/// und verschlüsselt sie dann managed mit AES-256 (ISO 32000-2 V5/R6) via
/// <see cref="PdfAesEncryptor"/> — beides ohne MD5, daher WASM-tauglich.
/// (PdfSharpCore wird NICHT genutzt: dessen Save crasht in WASM am MD5.)
///
/// Passwort-Semantik (MVP): Ist nur ein Owner-Passwort gesetzt, wird es auch als
/// User-Passwort verwendet, damit das eine Passwort tatsächlich zum Öffnen
/// nötig ist. Berechtigungen: alle erlaubt (reiner Öffnen-Schutz).
/// </summary>
public sealed class ManagedPdfEncryptor : IPdfEncryptor
{
    private readonly IJSRuntime _js;

    public ManagedPdfEncryptor(IJSRuntime js) => _js = js;

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

        // Normalisieren über pdf-lib (klassische xref-Struktur, useObjectStreams:false),
        // damit PdfAesEncryptor die Objekte parsen kann — NICHT PdfSharpCore (MD5-Crash).
        byte[] normalized;
        try
        {
            normalized = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.normalizePdf", cancellationToken, input).ConfigureAwait(false);
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:normalize] pdf-lib normalizePdf fehlgeschlagen: {jsex.Message}", jsex);
        }

        byte[] owner = AesR6.PreparePassword(options.OwnerPassword);
        byte[] user = string.IsNullOrEmpty(options.UserPassword)
            ? owner
            : AesR6.PreparePassword(options.UserPassword);

        // CPU-lastig (Algorithm 2.B iteriert) — nicht den UI-Thread blockieren.
        return await Task.Run(
            () => PdfAesEncryptor.Encrypt(normalized, owner, user, permissions: -1),
            cancellationToken).ConfigureAwait(false);
    }
}
