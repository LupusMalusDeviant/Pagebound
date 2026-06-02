using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Storage;

/// <summary>
/// Persistenz-Schicht auf Basis der Browser-IndexedDB.
/// Die eigentliche Datenbank-Interaktion läuft in
/// <c>wwwroot/js/storage-bridge.ts</c> (Global <c>pageboundStorage</c>);
/// hier kapseln wir Serialisierung und JS-Interop.
/// Erfüllt NFA-010 (Offline) und NFA-011 (sofortige Persistenz).
/// </summary>
public sealed class IndexedDbStorage : IStorageService
{
    private const string JsModuleId = "pageboundStorage";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly IJSRuntime _js;

    public IndexedDbStorage(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        var raw = await _js.InvokeAsync<string?>(
            $"{JsModuleId}.get",
            cancellationToken,
            key).ConfigureAwait(false);
        if (string.IsNullOrEmpty(raw))
        {
            return default;
        }
        return JsonSerializer.Deserialize<T>(raw, JsonOptions);
    }

    public async Task SetAsync<T>(string key, T value, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        var json = JsonSerializer.Serialize(value, JsonOptions);
        await _js.InvokeVoidAsync(
            $"{JsModuleId}.set",
            cancellationToken,
            key,
            json).ConfigureAwait(false);
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        await _js.InvokeVoidAsync(
            $"{JsModuleId}.remove",
            cancellationToken,
            key).ConfigureAwait(false);
    }

    public async Task SetBytesAsync(string key, byte[] bytes, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(bytes);
        await _js.InvokeVoidAsync(
            $"{JsModuleId}.setBlob",
            cancellationToken,
            key,
            bytes).ConfigureAwait(false);
    }

    public async Task<byte[]?> GetBytesAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return await _js.InvokeAsync<byte[]?>(
            $"{JsModuleId}.getBlob",
            cancellationToken,
            key).ConfigureAwait(false);
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return await _js.InvokeAsync<bool>(
            $"{JsModuleId}.exists",
            cancellationToken,
            key).ConfigureAwait(false);
    }

    public async IAsyncEnumerable<string> KeysAsync(
        string prefix,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var keys = await _js.InvokeAsync<string[]>(
            $"{JsModuleId}.keys",
            cancellationToken,
            prefix ?? string.Empty).ConfigureAwait(false);
        foreach (var key in keys)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return key;
        }
    }
}
