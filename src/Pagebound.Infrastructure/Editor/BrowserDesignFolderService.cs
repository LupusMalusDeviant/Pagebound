using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Editor;

/// <summary>
/// <see cref="IDesignFolderService"/> auf Basis der File-System-Access-Directory-API.
/// Dünne Hülle über die <c>pageboundDesigns</c>-Bridge (wwwroot/js/designs-bridge.ts) —
/// gleiches Muster wie <see cref="Workspace.BrowserWorkspaceService"/>.
/// </summary>
public sealed class BrowserDesignFolderService : IDesignFolderService
{
    private const string Module = "pageboundDesigns";

    private sealed record DesignEntry(string FileName, string Title, long UpdatedAt);

    private readonly IJSRuntime _js;

    public BrowserDesignFolderService(IJSRuntime js)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
    }

    public async Task<bool> IsSupportedAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _js.InvokeAsync<bool>($"{Module}.isSupported", cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Prerender / Bridge noch nicht geladen → als nicht unterstützt behandeln.
            return false;
        }
    }

    public async Task<string?> GetFolderNameAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _js.InvokeAsync<string?>($"{Module}.getFolderName", cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    public async Task<string?> PickFolderAsync(CancellationToken cancellationToken) =>
        await _js.InvokeAsync<string?>($"{Module}.pickFolder", cancellationToken).ConfigureAwait(false);

    public async Task ClearFolderAsync(CancellationToken cancellationToken) =>
        await _js.InvokeVoidAsync($"{Module}.clearFolder", cancellationToken).ConfigureAwait(false);

    public async Task<IReadOnlyList<DesignFileInfo>> ListAsync(CancellationToken cancellationToken)
    {
        try
        {
            var entries = await _js.InvokeAsync<DesignEntry[]>($"{Module}.listDesigns", cancellationToken).ConfigureAwait(false);
            return entries
                .Select(e => new DesignFileInfo(e.FileName, e.Title, DateTimeOffset.FromUnixTimeMilliseconds(Math.Max(0, e.UpdatedAt))))
                .ToList();
        }
        catch
        {
            return Array.Empty<DesignFileInfo>();
        }
    }

    public async Task<string?> ReadAsync(string fileName, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        return await _js.InvokeAsync<string?>($"{Module}.readDesign", cancellationToken, fileName).ConfigureAwait(false);
    }

    public async Task<bool> WriteAsync(string fileName, string json, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        ArgumentNullException.ThrowIfNull(json);
        return await _js.InvokeAsync<bool>($"{Module}.writeDesign", cancellationToken, fileName, json).ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(string fileName, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        return await _js.InvokeAsync<bool>($"{Module}.deleteDesign", cancellationToken, fileName).ConfigureAwait(false);
    }

    public async Task<bool> ExistsAsync(string fileName, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        return await _js.InvokeAsync<bool>($"{Module}.designExists", cancellationToken, fileName).ConfigureAwait(false);
    }
}
