using System.Text.Json.Serialization;
using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Storage;

/// <summary>
/// <see cref="IFileHandleService"/>-Implementierung über die JS-Bridge
/// <c>pageboundFiles</c> (siehe <c>wwwroot/js/file-handle-bridge.ts</c>).
/// Browser-Erkennung läuft serverseitig über einen einzigen JS-Aufruf, der
/// gecached wird — der Wert ändert sich pro Session nicht.
/// </summary>
public sealed class FileSystemAccessHandleService : IFileHandleService
{
    private const string JsModuleId = "pageboundFiles";

    private readonly IJSRuntime _js;
    private bool? _supportedCached;

    public FileSystemAccessHandleService(IJSRuntime js)
    {
        _js = js;
    }

    public async Task<bool> IsSupportedAsync(CancellationToken cancellationToken)
    {
        if (_supportedCached is { } cached) return cached;
        try
        {
            var ok = await _js.InvokeAsync<bool>(
                $"{JsModuleId}.supportsFileHandles", cancellationToken).ConfigureAwait(false);
            _supportedCached = ok;
            return ok;
        }
        catch
        {
            _supportedCached = false;
            return false;
        }
    }

    public async Task<PickedPdf?> PickPdfAsync(CancellationToken cancellationToken)
    {
        if (!await IsSupportedAsync(cancellationToken).ConfigureAwait(false)) return null;
        try
        {
            var result = await _js.InvokeAsync<JsPickedPdf?>(
                $"{JsModuleId}.pickPdf", cancellationToken).ConfigureAwait(false);
            if (result is null || result.Bytes is null) return null;
            return new PickedPdf(result.Bytes, result.Filename ?? "document.pdf", result.TempId);
        }
        catch
        {
            return null;
        }
    }

    public async Task<bool> PersistHandleAsync(string tempId, string hash, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(tempId) || string.IsNullOrWhiteSpace(hash)) return false;
        if (!await IsSupportedAsync(cancellationToken).ConfigureAwait(false)) return false;
        try
        {
            return await _js.InvokeAsync<bool>(
                $"{JsModuleId}.persistHandle", cancellationToken, tempId, hash).ConfigureAwait(false);
        }
        catch
        {
            return false;
        }
    }

    public async Task<PickedPdf?> TryReopenAsync(string hash, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hash)) return null;
        if (!await IsSupportedAsync(cancellationToken).ConfigureAwait(false)) return null;
        try
        {
            var result = await _js.InvokeAsync<JsReopenedPdf?>(
                $"{JsModuleId}.tryReopenByHash", cancellationToken, hash).ConfigureAwait(false);
            if (result is null || result.Bytes is null) return null;
            return new PickedPdf(result.Bytes, result.Filename ?? "document.pdf", TempHandleId: null);
        }
        catch
        {
            return null;
        }
    }

    public async Task ClearHandleAsync(string hash, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hash)) return;
        try
        {
            await _js.InvokeVoidAsync(
                $"{JsModuleId}.clearHandle", cancellationToken, hash).ConfigureAwait(false);
        }
        catch
        {
            // Best-effort.
        }
    }

    // DTOs für System.Text.Json-Deserialisierung (camelCase passt zur JS-Bridge).
    private sealed class JsPickedPdf
    {
        [JsonPropertyName("bytes")] public byte[]? Bytes { get; set; }
        [JsonPropertyName("filename")] public string? Filename { get; set; }
        [JsonPropertyName("tempId")] public string? TempId { get; set; }
    }

    private sealed class JsReopenedPdf
    {
        [JsonPropertyName("bytes")] public byte[]? Bytes { get; set; }
        [JsonPropertyName("filename")] public string? Filename { get; set; }
    }
}
