using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Workspace;

/// <summary>
/// <see cref="IWorkspaceService"/> auf Basis der File-System-Access-Directory-API.
/// Dünne Hülle über die <c>pageboundWorkspace</c>-Bridge (wwwroot/js/workspace-bridge.ts).
/// Erfüllt FA-072 (zentraler Sidecar-Workspace) und FA-073 (Auto-Erkennung).
/// </summary>
public sealed class BrowserWorkspaceService : IWorkspaceService
{
    private const string Module = "pageboundWorkspace";

    private readonly IJSRuntime _js;

    public BrowserWorkspaceService(IJSRuntime js)
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

    public async Task<string?> GetWorkspaceNameAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await _js.InvokeAsync<string?>($"{Module}.getWorkspaceName", cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    public async Task<string?> PickWorkspaceAsync(CancellationToken cancellationToken) =>
        await _js.InvokeAsync<string?>($"{Module}.pickWorkspace", cancellationToken).ConfigureAwait(false);

    public async Task ClearWorkspaceAsync(CancellationToken cancellationToken) =>
        await _js.InvokeVoidAsync($"{Module}.clearWorkspace", cancellationToken).ConfigureAwait(false);

    public async Task<bool> SaveSidecarAsync(string pdfHash, string json, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(pdfHash);
        ArgumentNullException.ThrowIfNull(json);
        return await _js.InvokeAsync<bool>($"{Module}.saveSidecar", cancellationToken, pdfHash, json).ConfigureAwait(false);
    }

    public async Task<string?> LoadSidecarAsync(string pdfHash, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(pdfHash);
        return await _js.InvokeAsync<string?>($"{Module}.loadSidecar", cancellationToken, pdfHash).ConfigureAwait(false);
    }
}
