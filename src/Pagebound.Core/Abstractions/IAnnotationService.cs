using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Annotation-Verwaltung (Highlights, Sticky Notes, Stift, Formen, Signaturen).
/// Persistierung erfolgt über ISidecarService + IStorageService.
/// Erfüllt FA-010 bis FA-014, FA-018.
/// </summary>
public interface IAnnotationService
{
    Task<Annotation> CreateAsync(NewAnnotation input, CancellationToken cancellationToken);

    Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken cancellationToken);

    Task DeleteAsync(AnnotationId id, CancellationToken cancellationToken);

    Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken cancellationToken);

    IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId);
}
