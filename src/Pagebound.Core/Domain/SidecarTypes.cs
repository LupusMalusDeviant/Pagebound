namespace Pagebound.Core.Domain;

public readonly record struct LibraryEntryId(string Value)
{
    public static LibraryEntryId NewId() => new("lib-" + Guid.NewGuid().ToString("N")[..12]);
    public override string ToString() => Value;
}

public sealed record PdfMeta(
    string Filename,
    string FileHashSha256,
    long FileSize,
    int PageCount);

public sealed record ReadingProgress(
    int CurrentPage,
    DateTimeOffset LastReadAt);

public sealed record LibraryEntry(
    LibraryEntryId Id,
    string PdfPath,
    string Title,
    string? Author,
    IReadOnlyList<string> Tags,
    int? Rating,
    DateTimeOffset AddedAt,
    DateTimeOffset? LastOpenedAt,
    ReadingProgress? Progress);

public sealed record IntegrityRecord(
    HashAlgorithm Algorithm,
    string Hash,
    string Scope,
    DateTimeOffset ComputedAt);

public enum IntegrityStatus
{
    NoHashPresent,
    Valid,
    Invalid,
    AmbiguousSources
}

public sealed record IntegrityVerification(
    IntegrityStatus Status,
    string? ExpectedHash,
    string? ActualHash,
    DateTimeOffset? SignedAt);

public sealed record Sidecar(
    string SchemaVersion,
    string CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    PdfMeta PdfMeta,
    LibraryEntry LibraryEntry,
    IReadOnlyList<Annotation> Annotations,
    IntegrityRecord? Integrity)
{
    public const string CurrentSchemaVersion = "1.0";
}
