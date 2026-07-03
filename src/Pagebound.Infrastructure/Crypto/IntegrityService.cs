using System.Globalization;
using System.Text;
using System.Text.Json;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using DomainHashAlgorithm = Pagebound.Core.Domain.HashAlgorithm;

namespace Pagebound.Infrastructure.Crypto;

/// <summary>
/// Default-Implementierung von <see cref="IIntegrityService"/>. Baut einen
/// kanonischen String aus PdfId + sortierten Annotation-Records + Zeitstempel
/// und hasht ihn via <see cref="IHashService"/>.
///
/// Kanonisierung:
///   - Annotationen werden ohne die zu signierende Annotation berücksichtigt
///   - Sortiert nach <c>Annotation.Id.Value</c> (stabil über Sessions hinweg)
///   - Jeder Eintrag wird zu einer Zeile <c>{id}|{type}|{page}|{json(payload)}|{createdAt:o}|{updatedAt:o}</c>
///   - Payload-JSON nutzt camelCase und sortierte Schlüssel über
///     <see cref="JsonSerializerOptions"/>, damit die Reihenfolge der
///     Dictionary-Einträge keinen Einfluss auf den Hash hat
///
/// Erfüllt FA-016 und FA-017.
/// </summary>
public sealed class IntegrityService : IIntegrityService
{
    private readonly IHashService _hashService;

    private static readonly JsonSerializerOptions PayloadJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public IntegrityService(IHashService hashService)
    {
        _hashService = hashService ?? throw new ArgumentNullException(nameof(hashService));
    }

    public async Task<string> ComputeSignatureHashAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        DateTimeOffset signedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(signatureAnnotation);
        ArgumentNullException.ThrowIfNull(otherAnnotations);

        var canonical = BuildCanonicalString(pdfId, signatureAnnotation, otherAnnotations, signedAt);
        var bytes = Encoding.UTF8.GetBytes(canonical);
        var hash = await _hashService
            .ComputeAsync(bytes, DomainHashAlgorithm.Sha256, cancellationToken)
            .ConfigureAwait(false);
        return hash;
    }

    public async Task<SignatureIntegrityStatus> VerifySignatureAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(signatureAnnotation);

        var storedHash = SignatureAnnotation.GetIntegrityHash(signatureAnnotation);
        if (string.IsNullOrEmpty(storedHash))
        {
            return SignatureIntegrityStatus.NoHash;
        }

        var signedAt = SignatureAnnotation.GetSignedAt(signatureAnnotation);
        var recomputed = await ComputeSignatureHashAsync(
            pdfId, signatureAnnotation, otherAnnotations, signedAt, cancellationToken)
            .ConfigureAwait(false);

        return string.Equals(recomputed, storedHash, StringComparison.OrdinalIgnoreCase)
            ? SignatureIntegrityStatus.Valid
            : SignatureIntegrityStatus.Invalid;
    }

    public async Task<IReadOnlyDictionary<AnnotationId, SignatureIntegrityStatus>> VerifyAllAsync(
        PdfId pdfId,
        IEnumerable<Annotation> annotations,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(annotations);

        var annotationList = annotations as IReadOnlyList<Annotation> ?? annotations.ToList();
        var signatures = annotationList.Where(a => a.Type == AnnotationType.Signature).ToList();
        var result = new Dictionary<AnnotationId, SignatureIntegrityStatus>();
        if (signatures.Count == 0) return result;

        // F-12: Der kanonische Annotations-Block ist für ALLE Signaturen identisch
        // (Signaturen werden ohnehin ausgeschlossen) → genau EINMAL bauen und für
        // jede Signatur wiederverwenden. Nur die Header-Zeilen (signedAt/signatureId)
        // unterscheiden sich pro Signatur. Das Hash-Format bleibt unverändert.
        var annotationsBlock = BuildAnnotationsBlock(annotationList, excludeId: null);

        foreach (var sig in signatures)
        {
            var storedHash = SignatureAnnotation.GetIntegrityHash(sig);
            if (string.IsNullOrEmpty(storedHash))
            {
                result[sig.Id] = SignatureIntegrityStatus.NoHash;
                continue;
            }

            var signedAt = SignatureAnnotation.GetSignedAt(sig);
            var canonical = ComposeCanonical(pdfId, sig.Id.Value, signedAt, annotationsBlock);
            var bytes = Encoding.UTF8.GetBytes(canonical);
            var recomputed = await _hashService
                .ComputeAsync(bytes, DomainHashAlgorithm.Sha256, cancellationToken)
                .ConfigureAwait(false);

            result[sig.Id] = string.Equals(recomputed, storedHash, StringComparison.OrdinalIgnoreCase)
                ? SignatureIntegrityStatus.Valid
                : SignatureIntegrityStatus.Invalid;
        }

        return result;
    }

    private static string BuildCanonicalString(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        DateTimeOffset signedAt)
    {
        var annotationsBlock = BuildAnnotationsBlock(otherAnnotations, signatureAnnotation.Id.Value);
        return ComposeCanonical(pdfId, signatureAnnotation.Id.Value, signedAt, annotationsBlock);
    }

    /// <summary>
    /// Setzt Header (pdfHash/signedAt/signatureId) + fertigen Annotations-Block zum
    /// finalen kanonischen String zusammen — byte-identisch zur früheren Inline-Version.
    /// </summary>
    private static string ComposeCanonical(
        PdfId pdfId,
        string signatureId,
        DateTimeOffset signedAt,
        string annotationsBlock)
    {
        var sb = new StringBuilder(capacity: 512);
        sb.Append("pdfHash=").Append(pdfId.Value).Append('\n');
        sb.Append("signedAt=").Append(signedAt.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture)).Append('\n');
        sb.Append("signatureId=").Append(signatureId).Append('\n');
        sb.Append(annotationsBlock);
        return sb.ToString();
    }

    /// <summary>
    /// Baut den kanonischen <c>annotations=[…]</c>-Block. Signaturen werden NICHT
    /// mitgehasht — sie können sich gegenseitig nicht invalidieren, und Reposition
    /// einer Signatur (Drag-and-Drop) soll keinen anderen Signatur-Status verletzen.
    /// Inhaltliche Annotationen (Sticky Notes, Highlights, Freitexte) bleiben Teil des
    /// Hashs. Da alle Signaturen ohnehin ausgeschlossen sind, ist der Block für JEDE
    /// Signatur identisch (<paramref name="excludeId"/> ist für Signaturen redundant)
    /// und kann in <see cref="VerifyAllAsync"/> einmalig gebaut und wiederverwendet
    /// werden.
    /// </summary>
    private static string BuildAnnotationsBlock(IEnumerable<Annotation> otherAnnotations, string? excludeId)
    {
        var sb = new StringBuilder(capacity: 512);
        sb.Append("annotations=[");
        var sortedOthers = otherAnnotations
            .Where(a => (excludeId is null || a.Id.Value != excludeId)
                       && a.Type != AnnotationType.Signature)
            .OrderBy(a => a.Id.Value, StringComparer.Ordinal)
            .ToList();

        for (var i = 0; i < sortedOthers.Count; i++)
        {
            if (i > 0) sb.Append(',');
            AppendAnnotationCanonical(sb, sortedOthers[i]);
        }
        sb.Append(']');
        return sb.ToString();
    }

    private static void AppendAnnotationCanonical(StringBuilder sb, Annotation annotation)
    {
        sb.Append('{')
          .Append("id=").Append(annotation.Id.Value)
          .Append("|type=").Append((int)annotation.Type)
          .Append("|page=").Append(annotation.PageNumber);

        var payloadJson = JsonSerializer.Serialize(
            SortedPayload(annotation.Payload),
            PayloadJsonOptions);
        sb.Append("|payload=").Append(payloadJson);

        sb.Append("|created=")
          .Append(annotation.CreatedAt.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture))
          .Append('}');
    }

    private static SortedDictionary<string, object?> SortedPayload(
        IReadOnlyDictionary<string, object?> payload)
    {
        var sorted = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var kvp in payload)
        {
            sorted[kvp.Key] = kvp.Value;
        }
        return sorted;
    }
}
