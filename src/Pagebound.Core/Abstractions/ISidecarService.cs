using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Sidecar-Persistenz. Im Browser-Pfad nutzen wir <see cref="SerializeAsync"/> +
/// <see cref="ParseAsync"/> (Download/Upload-Flow); auf Desktop-Hosts kommen
/// später <see cref="TryLoadAsync"/> + <see cref="SaveAsync"/> dazu, die das
/// Dateisystem neben der PDF nutzen.
/// Erfüllt FA-070 bis FA-074.
/// </summary>
public interface ISidecarService
{
    /// <summary>
    /// Serialisiert das Sidecar zu einem JSON-String (UTF-8, indented),
    /// passend zur aktuellen Schema-Version. Plattformunabhängig.
    /// </summary>
    Task<string> SerializeAsync(Sidecar sidecar, CancellationToken cancellationToken);

    /// <summary>
    /// Liest ein Sidecar aus einem JSON-Stream. Schema-Version wird geprüft;
    /// abweichende Versionen werden im Anschluss über <see cref="MigrateAsync"/>
    /// behandelt. Gibt <c>null</c> zurück, wenn der Stream nicht parsebar ist
    /// oder das Schema-Feld fehlt.
    /// </summary>
    Task<Sidecar?> ParseAsync(Stream json, CancellationToken cancellationToken);

    Task<Sidecar?> TryLoadAsync(string pdfPath, CancellationToken cancellationToken);

    Task SaveAsync(Sidecar sidecar, string pdfPath, CancellationToken cancellationToken);

    Task<Sidecar> CreateNewAsync(string pdfPath, PdfMeta meta, CancellationToken cancellationToken);

    Task<MigrationResult> MigrateAsync(Sidecar sidecar, CancellationToken cancellationToken);
}

public sealed record MigrationResult(
    bool Migrated,
    string FromVersion,
    string ToVersion,
    Sidecar Result);

/// <summary>
/// Eine Sidecar-Schema-Migration zwischen zwei Versionen.
/// Implementierungen registrieren sich beim ISidecarService.
/// </summary>
public interface ISidecarMigration
{
    string FromVersion { get; }
    string ToVersion { get; }

    Task<Sidecar> MigrateAsync(Sidecar source, CancellationToken cancellationToken);
}
