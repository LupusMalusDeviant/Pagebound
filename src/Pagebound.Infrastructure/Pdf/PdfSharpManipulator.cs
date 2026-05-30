using Pagebound.Core.Domain;
using PdfSharpCore.Fonts;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using PdfSharpCore.Pdf.Security;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// PDF-Seitenoperationen auf Basis von PdfSharpCore (MIT): Merge, Split,
/// Reorder, Delete, Rotate.
///
/// Wird als Composition-Target vom <see cref="JsPdfLibManipulator"/> genutzt —
/// der implementiert das volle <c>IPdfManipulator</c>-Interface und delegiert
/// hierher nur die Operationen, die in Blazor WASM stabil laufen.
///
/// Bewusst NICHT hier: Embed/Compress/Encrypt. Embed läuft über pdf-lib (JS),
/// weil PdfSharpCores Save-Pfad intern <c>MD5.Create()</c> ruft und der
/// WASM-CryptoConfig MD5 nicht kennt. Compress/Encrypt kommen in Release 0.8
/// (FA-026/FA-027), siehe ADR-004.
/// </summary>
public sealed class PdfSharpManipulator
{
    static PdfSharpManipulator()
    {
        // PdfSharpCore greift beim Save / bei XGraphics auf den globalen
        // FontResolver zu — auch wenn wir gar keinen Text zeichnen. Auf
        // Blazor WASM ist der Default nicht implementiert; schon das Lesen
        // des Getters wirft NotImplementedException. Setter unconditional
        // aufrufen, evtl. Setter-Fehler schlucken.
        try
        {
            GlobalFontSettings.FontResolver = new NoopFontResolver();
        }
        catch
        {
            // Best-effort.
        }
    }

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

        // Rotation ändert nur Metadaten der einzelnen Pages; wir öffnen das
        // Dokument im Modify-Modus und schreiben in-place.
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

    public async Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);
        if (string.IsNullOrEmpty(options.OwnerPassword))
            throw new ArgumentException("Owner-Passwort darf nicht leer sein.", nameof(options));
        if (options.Strength == EncryptionStrength.Aes256)
            throw new NotSupportedException(
                "AES-256 wird von PdfSharpCore 1.x nicht unterstützt. " +
                "Upgrade auf PdfSharp 6.x geplant für Release 1.1 (ADR-004).");

        await using var buffered = await CopyToSeekableAsync(pdf, cancellationToken).ConfigureAwait(false);
        using var doc = PdfReader.Open(buffered, PdfDocumentOpenMode.Modify);

        doc.SecuritySettings.DocumentSecurityLevel = PdfDocumentSecurityLevel.Encrypted128Bit;
        doc.SecuritySettings.OwnerPassword = options.OwnerPassword;
        if (options.UserPassword is not null)
            doc.SecuritySettings.UserPassword = options.UserPassword;

        return Save(doc);
    }

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

    /// <summary>
    /// Minimaler FontResolver-Stub. PdfSharpCore ruft ihn intern auf —
    /// solange wir keinen Text rendern, wird er nie nach Glyphen gefragt.
    /// Für Release 0.8 (echtes Text-Rendering) wird das durch einen Resolver
    /// ersetzt, der die Tailwind-Standardfonts bereitstellt.
    /// </summary>
    private sealed class NoopFontResolver : IFontResolver
    {
        public string DefaultFontName => "Arial";

        public byte[]? GetFont(string faceName) => null;

        public FontResolverInfo? ResolveTypeface(string familyName, bool isBold, bool isItalic)
            => new FontResolverInfo(familyName ?? "Arial", isBold, isItalic);
    }
}
