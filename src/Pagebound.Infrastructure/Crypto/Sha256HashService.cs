using System.Security.Cryptography;
using Pagebound.Core.Abstractions;
using DomainHashAlgorithm = Pagebound.Core.Domain.HashAlgorithm;

namespace Pagebound.Infrastructure.Crypto;

/// <summary>
/// Hash-Service auf Basis von <see cref="System.Security.Cryptography"/>.
/// Liefert Lowercase-Hex-Strings ohne Prefix. Erfüllt NFA-024.
/// </summary>
public sealed class Sha256HashService : IHashService
{
    public async Task<string> ComputeAsync(
        Stream data,
        DomainHashAlgorithm algorithm,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(data);
        using var hasher = CreateHasher(algorithm);
        var bytes = await hasher.ComputeHashAsync(data, cancellationToken).ConfigureAwait(false);
        return ToHex(bytes);
    }

    public Task<string> ComputeAsync(
        ReadOnlyMemory<byte> data,
        DomainHashAlgorithm algorithm,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var hasher = CreateHasher(algorithm);
        var bytes = hasher.ComputeHash(data.ToArray());
        return Task.FromResult(ToHex(bytes));
    }

    private static System.Security.Cryptography.HashAlgorithm CreateHasher(DomainHashAlgorithm algorithm) =>
        algorithm switch
        {
            DomainHashAlgorithm.Sha256 => SHA256.Create(),
            DomainHashAlgorithm.Sha384 => SHA384.Create(),
            DomainHashAlgorithm.Sha512 => SHA512.Create(),
            _ => throw new ArgumentOutOfRangeException(nameof(algorithm), algorithm, "Unbekannter Hash-Algorithmus.")
        };

    private static string ToHex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
}
