using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Berechnet kryptografische Hashes (Standard: SHA-256).
/// Erfüllt NFA-024.
/// </summary>
public interface IHashService
{
    Task<string> ComputeAsync(
        Stream data,
        HashAlgorithm algorithm,
        CancellationToken cancellationToken);

    Task<string> ComputeAsync(
        ReadOnlyMemory<byte> data,
        HashAlgorithm algorithm,
        CancellationToken cancellationToken);
}
