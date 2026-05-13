using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Sidecar-Persistenz. Sucht beim Öffnen einer PDF an zwei Orten:
/// (1) Default neben PDF: &lt;path&gt;.pagebound.json,
/// (2) Optionaler zentraler Workspace.
/// Erfüllt FA-070 bis FA-074.
/// </summary>
public interface ISidecarService
{
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
