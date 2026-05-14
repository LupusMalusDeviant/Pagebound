using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// PDF-Manipulation auf Basis von PdfSharpCore (MIT, läuft in Blazor WASM).
///
/// Implementiert die typischen Seiten-Operationen aus FA-020 bis FA-024.
/// Komprimierung (FA-026) und Verschlüsselung (FA-027) sind in dieser
/// Iteration als <see cref="NotImplementedException"/> markiert; sie kommen
/// in einer späteren Iteration (Release 0.8) — siehe ADR-004 Mitigation
/// für AES-256.
/// </summary>
public sealed class PdfSharpManipulator : IPdfManipulator
{
    public async Task<byte[]> MergeAsync(
        IReadOnlyList<Stream> pdfs,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdfs);
        if (pdfs.Count == 0) throw new ArgumentException("Mindestens eine PDF erforderlich.", nameof(pdfs));

        var merged = new PdfDocument();
        foreach (var sourceStream in pdfs)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await using var buffered = await CopyToSeekableAsync(sourceStream, cancellationToken).ConfigureAwait(false);
            using var input = PdfReader.Open(buffered, PdfDocumentOpenMode.Import);
            for (var i = 0; i < input.PageCount; i++)
            {
                merged.AddPage(input.Pages[i]);
            }
        }
        return Save(merged);
    }

    public async Task<IReadOnlyList<byte[]>> SplitAsync(
        Stream pdf,
        IReadOnlyList<int> splitAfterPages,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(splitAfterPages);

        await using var buffered = await CopyToSeekableAsync(pdf, cancellationToken).ConfigureAwait(false);
        using var source = PdfReader.Open(buffered, PdfDocumentOpenMode.Import);

        // Normalisierte Trennpunkte: aufsteigend, eindeutig, innerhalb [1, pageCount-1].
        var totalPages = source.PageCount;
        var sortedPoints = splitAfterPages
            .Where(p => p >= 1 && p < totalPages)
            .Distinct()
            .OrderBy(p => p)
            .ToList();

        var ranges = new List<(int Start, int Length)>();
        var cursor = 0;
        foreach (var sp in sortedPoints)
        {
            ranges.Add((cursor, sp - cursor));
            cursor = sp;
        }
        ranges.Add((cursor, totalPages - cursor));

        var results = new List<byte[]>(ranges.Count);
        foreach (var (start, length) in ranges)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var part = new PdfDocument();
            for (var i = 0; i < length; i++)
            {
                part.AddPage(source.Pages[start + i]);
            }
            results.Add(Save(part));
        }
        return results;
    }

    public async Task<byte[]> ReorderAsync(
        Stream pdf,
        IReadOnlyList<int> newOrder,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(newOrder);

        await using var buffered = await CopyToSeekableAsync(pdf, cancellationToken).ConfigureAwait(false);
        using var source = PdfReader.Open(buffered, PdfDocumentOpenMode.Import);

        var output = new PdfDocument();
        foreach (var oneBasedIndex in newOrder)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (oneBasedIndex < 1 || oneBasedIndex > source.PageCount)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(newOrder),
                    oneBasedIndex,
                    $"Seitenindex {oneBasedIndex} liegt außerhalb von [1, {source.PageCount}].");
            }
            output.AddPage(source.Pages[oneBasedIndex - 1]);
        }
        return Save(output);
    }

    public async Task<byte[]> DeletePagesAsync(
        Stream pdf,
        IReadOnlyList<int> pageIndices,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(pageIndices);

        await using var buffered = await CopyToSeekableAsync(pdf, cancellationToken).ConfigureAwait(false);
        using var source = PdfReader.Open(buffered, PdfDocumentOpenMode.Import);

        var toKeep = Enumerable.Range(1, source.PageCount)
            .Except(pageIndices)
            .OrderBy(i => i)
            .ToList();

        var output = new PdfDocument();
        foreach (var oneBasedIndex in toKeep)
        {
            cancellationToken.ThrowIfCancellationRequested();
            output.AddPage(source.Pages[oneBasedIndex - 1]);
        }
        return Save(output);
    }

    public async Task<byte[]> RotateAsync(
        Stream pdf,
        IReadOnlyDictionary<int, int> rotationDegrees,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(rotationDegrees);

        await using var buffered = await CopyToSeekableAsync(pdf, cancellationToken).ConfigureAwait(false);

        // Rotation ändert nur Metadaten der einzelnen Pages; wir können das
        // Dokument im Modify-Modus öffnen und in-place schreiben.
        using var doc = PdfReader.Open(buffered, PdfDocumentOpenMode.Modify);
        foreach (var (oneBasedIndex, degrees) in rotationDegrees)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (oneBasedIndex < 1 || oneBasedIndex > doc.PageCount) continue;
            var normalized = ((degrees % 360) + 360) % 360;
            var page = doc.Pages[oneBasedIndex - 1];
            // PdfSharp.Rotate ist additiv-replace: wir setzen den absoluten Wert.
            page.Rotate = (normalized + page.Rotate) % 360;
        }
        return Save(doc);
    }

    public Task<byte[]> CompressAsync(
        Stream pdf,
        CompressionOptions options,
        IProgress<int>? progress,
        CancellationToken cancellationToken) =>
        throw new NotImplementedException(
            "CompressAsync folgt in Release 0.8 (FA-026). Erste Iteration: " +
            "Re-Encoding eingebetteter Bilder mit wählbarer JPEG-Qualität.");

    public Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken) =>
        throw new NotImplementedException(
            "EncryptAsync folgt in Release 0.8 (FA-027). PdfSharpCore liefert " +
            "AES-128; AES-256 erfordert eigenständige Erweiterung (ADR-004).");

    // --- Helpers --------------------------------------------------------------

    private static byte[] Save(PdfDocument document)
    {
        using var ms = new MemoryStream();
        document.Save(ms);
        return ms.ToArray();
    }

    /// <summary>
    /// PdfSharpCore braucht einen seekable Stream. Eingehende Streams
    /// (z.B. aus IBrowserFile) sind oft forward-only, daher in einen
    /// MemoryStream kopieren.
    /// </summary>
    private static async Task<MemoryStream> CopyToSeekableAsync(Stream source, CancellationToken ct)
    {
        var ms = new MemoryStream();
        await source.CopyToAsync(ms, ct).ConfigureAwait(false);
        ms.Position = 0;
        return ms;
    }
}
