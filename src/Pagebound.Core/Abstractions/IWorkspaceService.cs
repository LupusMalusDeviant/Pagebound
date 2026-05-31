namespace Pagebound.Core.Abstractions;

/// <summary>
/// Optionaler zentraler Workspace-Ordner für Sidecar-Dateien (FA-072), entkoppelt
/// vom Speicherort der PDF. Im Browser über die File-System-Access-Directory-API
/// (<c>showDirectoryPicker</c>, Chromium-only) realisiert; das gewählte
/// Verzeichnis-Handle wird in IndexedDB persistiert, sodass es Sessions übersteht
/// (mit dezentem Permission-Re-Prompt beim ersten Zugriff pro Session).
///
/// Sidecars liegen als <c>{pdfHash}.pagebound.json</c> im Workspace — beim Öffnen
/// einer PDF wird dort automatisch gesucht (FA-073). Auf Browsern ohne die API
/// liefern alle Methoden neutrale Ergebnisse (<see cref="IsSupportedAsync"/> =
/// false), der Aufrufer fällt dann auf den Download/Upload-Flow zurück.
/// </summary>
public interface IWorkspaceService
{
    /// <summary>True, wenn <c>window.showDirectoryPicker</c> verfügbar ist.</summary>
    Task<bool> IsSupportedAsync(CancellationToken cancellationToken);

    /// <summary>Name des aktuell gesetzten Workspace-Ordners, oder <c>null</c>.</summary>
    Task<string?> GetWorkspaceNameAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Öffnet den nativen Verzeichnis-Picker und persistiert das gewählte Handle.
    /// Gibt den Ordnernamen zurück, oder <c>null</c> bei Abbruch / fehlender API.
    /// </summary>
    Task<string?> PickWorkspaceAsync(CancellationToken cancellationToken);

    /// <summary>Vergisst den Workspace (entfernt das persistierte Handle).</summary>
    Task ClearWorkspaceAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Schreibt das Sidecar-JSON als <c>{pdfHash}.pagebound.json</c> in den
    /// Workspace. <c>false</c>, wenn kein Workspace gesetzt ist oder die
    /// Schreib-Berechtigung verweigert wurde.
    /// </summary>
    Task<bool> SaveSidecarAsync(string pdfHash, string json, CancellationToken cancellationToken);

    /// <summary>
    /// Liest <c>{pdfHash}.pagebound.json</c> aus dem Workspace (FA-073), oder
    /// <c>null</c> wenn die Datei fehlt / kein Workspace gesetzt ist / die
    /// Lese-Berechtigung verweigert wurde.
    /// </summary>
    Task<string?> LoadSidecarAsync(string pdfHash, CancellationToken cancellationToken);
}
