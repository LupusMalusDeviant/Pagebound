namespace Pagebound.Core.Abstractions;

/// <summary>
/// Schlüssel-Wert-Persistenz. Default-Implementierung (IndexedDbStorage)
/// kapselt IndexedDB via JS-Interop. In Tests durch InMemoryStorage ersetzbar.
/// Erfüllt NFA-010, NFA-011.
/// </summary>
public interface IStorageService
{
    Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken);

    Task SetAsync<T>(string key, T value, CancellationToken cancellationToken);

    Task DeleteAsync(string key, CancellationToken cancellationToken);

    Task<bool> ExistsAsync(string key, CancellationToken cancellationToken);

    IAsyncEnumerable<string> KeysAsync(string prefix, CancellationToken cancellationToken = default);

    /// <summary>
    /// Speichert ein Byte-Array nativ in IndexedDB (kein JSON-Roundtrip,
    /// kein Base64-Overhead). Genutzt für die persistierten PDF-Bytes der
    /// Library — `pdf:bytes:{hash}` (FA-060 Auto-Open).
    /// </summary>
    Task SetBytesAsync(string key, byte[] bytes, CancellationToken cancellationToken);

    /// <summary>
    /// Liest das Byte-Array zurück (oder <c>null</c>, wenn der Key nicht
    /// existiert bzw. unter einem anderen Typ gespeichert wurde).
    /// </summary>
    Task<byte[]?> GetBytesAsync(string key, CancellationToken cancellationToken);
}
