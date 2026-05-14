using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// PDF-Manipulationen ohne erneutes Rendering: Seiten zusammenfügen,
/// aufteilen, neu sortieren, löschen, drehen, komprimieren, verschlüsseln.
/// Default-Implementierung (PdfSharpManipulator) basiert auf PdfSharpCore.
/// Erfüllt FA-020 bis FA-027.
/// </summary>
public interface IPdfManipulator
{
    Task<byte[]> MergeAsync(
        IReadOnlyList<Stream> pdfs,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<byte[]>> SplitAsync(
        Stream pdf,
        IReadOnlyList<int> splitAfterPages,
        CancellationToken cancellationToken);

    Task<byte[]> ReorderAsync(
        Stream pdf,
        IReadOnlyList<int> newOrder,
        CancellationToken cancellationToken);

    Task<byte[]> DeletePagesAsync(
        Stream pdf,
        IReadOnlyList<int> pageIndices,
        CancellationToken cancellationToken);

    Task<byte[]> RotateAsync(
        Stream pdf,
        IReadOnlyDictionary<int, int> rotationDegrees,
        CancellationToken cancellationToken);

    Task<byte[]> CompressAsync(
        Stream pdf,
        CompressionOptions options,
        IProgress<int>? progress,
        CancellationToken cancellationToken);

    Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken);
}
