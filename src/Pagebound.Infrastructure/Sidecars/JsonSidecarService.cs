using System.Text.Json;
using System.Text.Json.Serialization;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Sidecars;

/// <summary>
/// JSON-Sidecar (FA-070, FA-071, FA-073). Im Browser-Pfad wird Sidecar über
/// Download/Upload getauscht; die Filesystem-Methoden bleiben für den späteren
/// Desktop-Host. Wir setzen bewusst auf System.Text.Json mit denselben Optionen
/// wie der <c>IndexedDbStorage</c>, damit Round-Trip zwischen IndexedDB-Persistenz
/// und Sidecar-Export keine Daten verliert.
/// </summary>
public sealed class JsonSidecarService : ISidecarService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public Task<string> SerializeAsync(Sidecar sidecar, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sidecar);
        cancellationToken.ThrowIfCancellationRequested();
        var json = JsonSerializer.Serialize(sidecar, JsonOptions);
        return Task.FromResult(json);
    }

    public async Task<SidecarParseResult> ParseAsync(Stream json, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            var sidecar = await JsonSerializer
                .DeserializeAsync<Sidecar>(json, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            // Minimal-Validierung: ein Sidecar ohne SchemaVersion oder ohne
            // PdfMeta ist nicht brauchbar.
            if (sidecar is null
                || string.IsNullOrWhiteSpace(sidecar.SchemaVersion)
                || sidecar.PdfMeta is null)
            {
                return SidecarParseResult.Invalid;
            }
            // Vorwärtskompatibilität (F-07): Annotationen mit einem in DIESER App-
            // Version unbekannten Typ-Ordinal (z.B. aus einer neueren Version) NICHT
            // verwerfen — sie bleiben erhalten und beeinflussen den Signatur-Hash
            // weiter — aber dem Aufrufer als Warnung melden. Die Ordinal-
            // Serialisierung des Enums bleibt unverändert (kein Breaking Change).
            var unknownCount = sidecar.Annotations.Count(a => !a.Type.IsKnown());
            return new SidecarParseResult(sidecar, unknownCount);
        }
        catch (JsonException)
        {
            return SidecarParseResult.Invalid;
        }
    }

    public Task<Sidecar?> TryLoadAsync(string pdfPath, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Browser-Pfad hat keinen Datei-System-Zugriff. Nutze ParseAsync(stream).");

    public Task SaveAsync(Sidecar sidecar, string pdfPath, CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Browser-Pfad hat keinen Datei-System-Zugriff. Nutze SerializeAsync + Download-Bridge.");

    public Task<Sidecar> CreateNewAsync(string pdfPath, PdfMeta meta, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(meta);
        var now = DateTimeOffset.UtcNow;
        // LibraryEntry wird erst mit FA-060 ff. (Release 0.5) befüllt; bis dahin
        // halten wir einen leeren Eintrag, dessen Felder beim ersten Library-Scan
        // angereichert werden.
        var libraryEntry = new LibraryEntry(
            Id: LibraryEntryId.NewId(),
            PdfPath: pdfPath ?? string.Empty,
            Title: meta.Filename,
            Author: null,
            Tags: Array.Empty<string>(),
            Rating: null,
            AddedAt: now,
            LastOpenedAt: null,
            Progress: null,
            PdfMeta: meta);

        var sidecar = new Sidecar(
            SchemaVersion: Sidecar.CurrentSchemaVersion,
            CreatedBy: "Pagebound",
            CreatedAt: now,
            UpdatedAt: now,
            PdfMeta: meta,
            LibraryEntry: libraryEntry,
            Annotations: Array.Empty<Annotation>(),
            Integrity: null);
        return Task.FromResult(sidecar);
    }

    public Task<MigrationResult> MigrateAsync(Sidecar sidecar, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sidecar);
        // Aktuell existiert nur Version 1.0. Wenn das Schema bricht, registrieren
        // wir hier konkrete Migrationen (ISidecarMigration-Implementationen).
        return Task.FromResult(new MigrationResult(
            Migrated: false,
            FromVersion: sidecar.SchemaVersion,
            ToVersion: Sidecar.CurrentSchemaVersion,
            Result: sidecar));
    }
}
