using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Pdf.Encryption;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfEncryptor"/>-Implementation: normalisiert die Eingabe über
/// PdfSharpCore (klassische Struktur) und verschlüsselt sie dann managed mit
/// AES-256 (ISO 32000-2 V5/R6) via <see cref="PdfAesEncryptor"/> — kein MD5,
/// daher WASM-tauglich.
///
/// Passwort-Semantik (MVP): Ist nur ein Owner-Passwort gesetzt, wird es auch als
/// User-Passwort verwendet, damit das eine Passwort tatsächlich zum Öffnen
/// nötig ist (sonst öffnete die PDF ohne Abfrage). Berechtigungen: alle erlaubt
/// (reiner Öffnen-Schutz).
/// </summary>
public sealed class ManagedPdfEncryptor : IPdfEncryptor
{
    private readonly PdfSharpManipulator _pdfSharp;

    public ManagedPdfEncryptor(PdfSharpManipulator pdfSharp) => _pdfSharp = pdfSharp;

    public async Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrEmpty(options.OwnerPassword))
            throw new ArgumentException("Owner-Passwort darf nicht leer sein.", nameof(options));

        byte[] normalized = await _pdfSharp.NormalizeAsync(pdf, cancellationToken).ConfigureAwait(false);

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
