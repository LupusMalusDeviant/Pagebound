using System.Runtime.CompilerServices;
using Pagebound.Core.Abstractions;

namespace Pagebound.Core.Tests.Helpers;

/// <summary>
/// In-Memory-<see cref="IStorageService"/> für Service-Tests — ersetzt die
/// IndexedDB-/JS-Implementierung durch ein simples Dictionary. Hält Objekt-
/// Referenzen (kein JSON-Roundtrip), was für die Logik-Tests von LibraryService
/// und AnnotationService ausreicht.
/// </summary>
public sealed class InMemoryStorage : IStorageService
{
    private readonly Dictionary<string, object?> _kv = new();
    private readonly Dictionary<string, byte[]> _bytes = new();

    public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken) =>
        Task.FromResult(_kv.TryGetValue(key, out var v) && v is T typed ? typed : default);

    public Task SetAsync<T>(string key, T value, CancellationToken cancellationToken)
    {
        _kv[key] = value;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        _kv.Remove(key);
        _bytes.Remove(key);
        return Task.CompletedTask;
    }

    public Task<bool> ExistsAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(_kv.ContainsKey(key) || _bytes.ContainsKey(key));

    public async IAsyncEnumerable<string> KeysAsync(
        string prefix, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (var k in _kv.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
        {
            yield return k;
        }
        await Task.CompletedTask;
    }

    public Task SetBytesAsync(string key, byte[] bytes, CancellationToken cancellationToken)
    {
        _bytes[key] = bytes;
        return Task.CompletedTask;
    }

    public Task<byte[]?> GetBytesAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(_bytes.TryGetValue(key, out var b) ? b : null);
}
