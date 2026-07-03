using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Berechnet und verifiziert den Integritäts-Hash einer PNG-Signatur (FA-016, FA-017).
///
/// Pragmatische Variante laut ADR-006: kein PDF-Re-Hashing, stattdessen ein
/// kombinierter Hash über
///   1. den SHA-256 der Original-PDF (= <see cref="PdfId"/>),
///   2. den deterministisch serialisierten Annotation-Set ohne diese Signatur,
///   3. den Signaturzeitpunkt.
///
/// Erhöht oder verändert sich einer dieser Werte nach dem Signieren, schlägt
/// die Verifikation fehl und die UI zeigt einen Warn-Status.
/// </summary>
public interface IIntegrityService
{
    Task<string> ComputeSignatureHashAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        DateTimeOffset signedAt,
        CancellationToken cancellationToken);

    Task<SignatureIntegrityStatus> VerifySignatureAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        CancellationToken cancellationToken);

    /// <summary>
    /// Verifiziert ALLE Signaturen eines Dokuments in einem Durchlauf. Der kanonische
    /// Annotations-Block ist für alle Signaturen identisch (Signaturen sind ohnehin
    /// ausgeschlossen) und wird daher nur EINMAL gebaut und wiederverwendet (F-12) —
    /// statt O(Signaturen × Annotationen). Liefert je Signatur-<see cref="AnnotationId"/>
    /// denselben Status wie ein einzelner <see cref="VerifySignatureAsync"/>-Aufruf.
    /// Das Hash-Format bleibt unverändert.
    /// </summary>
    Task<IReadOnlyDictionary<AnnotationId, SignatureIntegrityStatus>> VerifyAllAsync(
        PdfId pdfId,
        IEnumerable<Annotation> annotations,
        CancellationToken cancellationToken);
}
