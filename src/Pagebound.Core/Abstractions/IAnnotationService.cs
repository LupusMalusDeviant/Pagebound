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

    /// <summary>
    /// Übernimmt eine Annotation MIT ihrer mitgebrachten Identität und ihrem
    /// Zeitpunkt — für Importe aus einer Quelle, die beides schon führt
    /// (vorgefundene <c>/Annots</c> mit <c>/NM</c> und <c>/M</c>).
    /// <para>
    /// Warum nicht <see cref="CreateAsync"/>: das vergibt eine neue Id und die
    /// aktuelle Uhrzeit. Beim Weg importieren → ändern → als /Annots speichern
    /// hieße das, die Annotation bekommt ein anderes <c>/NM</c> als das Objekt
    /// in der Datei; der Ersetzen-Schritt findet das Original dann nicht mehr
    /// und beide Fassungen stehen nebeneinander in der PDF. Genau das soll der
    /// Vertrag (<c>docs/contracts/annotationen-als-pdf-annots.md</c>)
    /// verhindern.
    /// </para>
    /// <para>
    /// Ist die Id schon bekannt, wird der vorhandene Eintrag ersetzt (Upsert) —
    /// ein zweiter Import derselben Datei verdoppelt also nichts.
    /// </para>
    /// </summary>
    Task<Annotation> ImportAsync(Annotation annotation, CancellationToken cancellationToken);

    Task<Annotation> UpdateAsync(Annotation annotation, CancellationToken cancellationToken);

    Task DeleteAsync(AnnotationId id, CancellationToken cancellationToken);

    Task<IReadOnlyList<Annotation>> GetForDocumentAsync(PdfId pdfId, CancellationToken cancellationToken);

    IAsyncEnumerable<AnnotationChange> ObserveChanges(PdfId pdfId);
}
