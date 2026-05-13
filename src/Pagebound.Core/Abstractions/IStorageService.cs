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

    IAsyncEnumerable<string> KeysAsync(string prefix);
}
