using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// PDF-Manipulationen ohne erneutes Rendering: Seiten zusammenfügen,
/// aufteilen, neu sortieren, löschen, drehen, komprimieren, verschlüsseln,
/// Signaturen einbetten.
///
/// Default-Implementierung im Web-Pfad ist <c>JsPdfLibManipulator</c>:
/// Signatur-Embed läuft via pdf-lib (JS-Interop), Seiten-Operationen
/// delegieren an <c>PdfSharpManipulator</c>. Erfüllt FA-015 + FA-020 bis FA-027.
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

    /// <summary>
    /// Bettet die übergebenen Signaturen als sichtbares Bild in die jeweilige
    /// PDF-Seite ein und schreibt die Signer-Metadaten in das Info-Dictionary
    /// (Standard <c>/Author</c> sowie eigene <c>/Pagebound:Signature:i:*</c>-Keys).
    /// Erfüllt den "Signatur ist auch im PDF, nicht nur in der Sidecar"-Teil
    /// von FA-015.
    /// </summary>
    Task<byte[]> EmbedSignaturesAsync(
        Stream pdf,
        IReadOnlyList<EmbeddedSignature> signatures,
        CancellationToken cancellationToken);

    /// <summary>
    /// Zeichnet ein diagonales Text-Wasserzeichen und/oder Seitenzahlen (Bates)
    /// auf jede Seite und gibt die neue PDF zurück. Die Eingabe bleibt unverändert.
    /// </summary>
    Task<byte[]> StampAsync(
        Stream pdf,
        StampOptions options,
        CancellationToken cancellationToken);

    /// <summary>
    /// „Annotationen einbrennen": brennt die übergebenen Sidecar-Annotationen
    /// (Highlights, Ink, Formen, Notizen, Signaturen) dauerhaft in die PDF-Bytes
    /// — das Ergebnis ist eine normale PDF mit fest eingezeichneten Markierungen,
    /// unabhängig von der Sidecar. Die Eingabe bleibt unverändert; eine leere
    /// Liste liefert die PDF unverändert zurück.
    /// </summary>
    Task<byte[]> FlattenAnnotationsAsync(
        Stream pdf,
        IReadOnlyList<Annotation> annotations,
        CancellationToken cancellationToken);

    /// <summary>
    /// Echte Redaktion (Schwärzen): die betroffenen Seiten werden rasterisiert
    /// und die angegebenen Bereiche als schwarze Pixel eingebrannt — der
    /// darunterliegende Text/Vektor-Inhalt wird dabei ENTFERNT (nicht nur
    /// verdeckt), also weder markier- noch extrahierbar. Seiten ohne Bereiche
    /// bleiben vektor-treu. Leere Liste → PDF unverändert.
    /// </summary>
    Task<byte[]> RedactAsync(
        Stream pdf,
        IReadOnlyList<RedactionRegion> regions,
        CancellationToken cancellationToken);

    /// <summary>
    /// Legt AcroForm-Felder (Text/Checkbox) an den angegebenen Positionen an
    /// (Formular-Erstellung, Roadmap D1). Position in 0..1-Page-Fractions
    /// (Ursprung oben-links, wie im UI). Leere Liste → PDF unverändert.
    /// </summary>
    Task<byte[]> CreateFormFieldsAsync(
        Stream pdf,
        IReadOnlyList<FormFieldRegion> fields,
        CancellationToken cancellationToken);

    /// <summary>Setzt Dokument-Metadaten (Titel/Autor/Betreff/Keywords) im Info-Dictionary.</summary>
    Task<byte[]> SetMetadataAsync(Stream pdf, PdfMetadata metadata, CancellationToken cancellationToken);

    /// <summary>Liest die aktuellen Dokument-Metadaten (für „bearbeiten" / Vorbelegung).</summary>
    Task<PdfMetadata> GetMetadataAsync(Stream pdf, CancellationToken cancellationToken);
}

/// <summary>
/// Ein zu schwärzender Bereich auf einer Seite, in 0..1-Page-Fractions
/// (Origin oben-links, wie im Reader-UI).
/// </summary>
public sealed record RedactionRegion(
    int PageNumber,
    double X,
    double Y,
    double Width,
    double Height);

/// <summary>
/// Ein neu anzulegendes Formularfeld (Roadmap D1). Position in 0..1-Page-Fractions
/// (Ursprung oben-links). <see cref="FieldType"/>: "text" oder "checkbox".
/// </summary>
public sealed record FormFieldRegion(
    int PageNumber,
    double X,
    double Y,
    double Width,
    double Height,
    string Name,
    string FieldType);

/// <summary>Dokument-Metadaten (MCP↔PWA-Parität für <c>pdf_set_metadata</c>).
/// <see cref="Keywords"/> als kommaseparierter String.</summary>
public sealed record PdfMetadata(
    string? Title,
    string? Author,
    string? Subject,
    string? Keywords);

/// <summary>
/// Eine Signatur, wie sie der <see cref="IPdfManipulator"/> in eine PDF einbetten soll.
/// Position in 0..1-Page-Fractions, Bilddaten als rohe PNG-Bytes.
/// </summary>
public sealed record EmbeddedSignature(
    int PageNumber,
    byte[] ImageBytes,
    double X,
    double Y,
    double Width,
    double Height,
    DateTimeOffset SignedAt,
    SignerInfo Signer,
    string? IntegrityHash);
