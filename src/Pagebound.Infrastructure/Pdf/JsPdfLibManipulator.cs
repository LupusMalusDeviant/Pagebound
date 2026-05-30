using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfManipulator"/>-Implementation für Blazor WASM. Bettet
/// Signaturen via <c>pdf-lib</c> (JS-Bridge) ein und delegiert Seiten-Operationen
/// (Merge/Split/Reorder/Delete/Rotate) an den inneren <see cref="PdfSharpManipulator"/>.
///
/// Hintergrund: PdfSharpCores Save-Pfad ruft im Konstruktor von
/// <c>PdfStandardSecurityHandler</c> (lazy via Trailer-Dictionary mit
/// <c>VCF.CreateIndirect</c>) <c>MD5.Create()</c> auf — das schlägt unter
/// Blazor WebAssembly mit <c>Cryptography_UnknownHashAlgorithm, MD5</c> fehl,
/// weil der WASM-<c>HashProviderDispenser</c> MD5 nicht kennt. pdf-lib hat
/// diese Abhängigkeit nicht.
///
/// Compress/Encrypt sind im Web-Pfad nicht angeschlossen (Release 0.8, ADR-004).
/// </summary>
public sealed class JsPdfLibManipulator : IPdfManipulator
{
    private readonly IJSRuntime _js;
    private readonly PdfSharpManipulator _inner;
    private readonly IPdfEncryptor _encryptor;

    public JsPdfLibManipulator(IJSRuntime js, PdfSharpManipulator inner, IPdfEncryptor encryptor)
    {
        _js = js;
        _inner = inner;
        _encryptor = encryptor;
    }

    public Task<byte[]> MergeAsync(IReadOnlyList<Stream> pdfs, CancellationToken cancellationToken)
        => _inner.MergeAsync(pdfs, cancellationToken);

    public Task<IReadOnlyList<byte[]>> SplitAsync(Stream pdf, IReadOnlyList<int> splitAfterPages, CancellationToken cancellationToken)
        => _inner.SplitAsync(pdf, splitAfterPages, cancellationToken);

    public Task<byte[]> ReorderAsync(Stream pdf, IReadOnlyList<int> newOrder, CancellationToken cancellationToken)
        => _inner.ReorderAsync(pdf, newOrder, cancellationToken);

    public Task<byte[]> DeletePagesAsync(Stream pdf, IReadOnlyList<int> pageIndices, CancellationToken cancellationToken)
        => _inner.DeletePagesAsync(pdf, pageIndices, cancellationToken);

    public Task<byte[]> RotateAsync(Stream pdf, IReadOnlyDictionary<int, int> rotationDegrees, CancellationToken cancellationToken)
        => _inner.RotateAsync(pdf, rotationDegrees, cancellationToken);

    public async Task<byte[]> CompressAsync(
        Stream pdf,
        CompressionOptions options,
        IProgress<int>? progress,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);

        // PDF einlesen — die JS-Bridge nimmt Uint8Array entgegen.
        byte[] pdfBytes;
        await using (var ms = new MemoryStream())
        {
            await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
            pdfBytes = ms.ToArray();
        }

        // ImageQuality im Domain-Modell ist 1..100, JS erwartet 0.1..0.95.
        var quality = (options.ImageQuality ?? 75) / 100.0;
        quality = Math.Clamp(quality, 0.1, 0.95);

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.compressPdf",
                cancellationToken,
                pdfBytes,
                new { imageQuality = quality }).ConfigureAwait(false);
            return result ?? pdfBytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:compress] pdf-lib/PDF.js Re-Rasterize fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    // Verschlüsselung läuft managed über AES-256 (ISO 32000-2 V5/R6) im
    // ManagedPdfEncryptor — NICHT über PdfSharpCore, dessen Security-Handler in
    // WASM am MD5 crasht. V5/R6 nutzt nur SHA-256/384/512 + AES (FA-027, ADR-004).
    public Task<byte[]> EncryptAsync(Stream pdf, EncryptionOptions options, CancellationToken cancellationToken) =>
        _encryptor.EncryptAsync(pdf, options, cancellationToken);

    public async Task<byte[]> EmbedSignaturesAsync(
        Stream pdf,
        IReadOnlyList<EmbeddedSignature> signatures,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(signatures);

        // PDF einmal in ein byte[] kopieren (JS-Interop will Uint8Array, kein Stream).
        byte[] pdfBytes;
        await using (var ms = new MemoryStream())
        {
            await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
            pdfBytes = ms.ToArray();
        }

        if (signatures.Count == 0)
        {
            return pdfBytes;
        }

        // Payload für die JS-Bridge zusammenstellen. Die Property-Namen müssen
        // exakt zu EmbeddedSignatureInput in pdf-manipulator-bridge.ts passen
        // (camelCase, weil System.Text.Json-Default).
        var payload = signatures.Select(s => new JsEmbeddedSignature
        {
            PageNumber = s.PageNumber,
            ImageBytes = s.ImageBytes,
            X = s.X,
            Y = s.Y,
            Width = s.Width,
            Height = s.Height,
            SignedAtIso = s.SignedAt.ToUniversalTime().ToString("o", System.Globalization.CultureInfo.InvariantCulture),
            SignerName = s.Signer.Name ?? string.Empty,
            SignerEmail = string.IsNullOrWhiteSpace(s.Signer.Email) ? null : s.Signer.Email,
            SignerReason = string.IsNullOrWhiteSpace(s.Signer.Reason) ? null : s.Signer.Reason,
            SignerLocation = string.IsNullOrWhiteSpace(s.Signer.Location) ? null : s.Signer.Location,
            IntegrityHash = string.IsNullOrWhiteSpace(s.IntegrityHash) ? null : s.IntegrityHash
        }).ToArray();

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.embedSignatures",
                cancellationToken,
                pdfBytes,
                payload).ConfigureAwait(false);
            return result ?? pdfBytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:js-embed] pdf-lib embedSignatures fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    /// <summary>
    /// DTO für die Übergabe an die JS-Bridge. Property-Namen werden via
    /// System.Text.Json zu camelCase serialisiert.
    /// </summary>
    private sealed class JsEmbeddedSignature
    {
        public int PageNumber { get; init; }
        public byte[] ImageBytes { get; init; } = Array.Empty<byte>();
        public double X { get; init; }
        public double Y { get; init; }
        public double Width { get; init; }
        public double Height { get; init; }
        public string SignedAtIso { get; init; } = string.Empty;
        public string SignerName { get; init; } = string.Empty;
        public string? SignerEmail { get; init; }
        public string? SignerReason { get; init; }
        public string? SignerLocation { get; init; }
        public string? IntegrityHash { get; init; }
    }
}
