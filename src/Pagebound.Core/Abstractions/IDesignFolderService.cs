namespace Pagebound.Core.Abstractions;

/// <summary>Kurzinfo einer Design-Datei (<c>*.pbdesign.json</c>) im Design-Ordner.</summary>
public sealed record DesignFileInfo(string FileName, string Title, DateTimeOffset UpdatedAt);

/// <summary>
/// Optionaler Design-Ordner des WYSIWYG-Designers auf dem Ausführungssystem:
/// ein vom Nutzer gewähltes Verzeichnis, in dem Designs/Vorlagen als
/// <c>*.pbdesign.json</c> liegen. Designs dienen als Schablonen — „Verwenden“
/// lädt eine Kopie ins Dokument, die Datei selbst bleibt unverändert; nur der
/// explizite „Template bearbeiten“-Modus schreibt zurück.
///
/// Im Browser über die File-System-Access-Directory-API (Chromium-only)
/// realisiert, Handle in IndexedDB persistiert — gleiches Muster wie
/// <see cref="IWorkspaceService"/>. Ohne API-Unterstützung liefern alle
/// Methoden neutrale Ergebnisse (<see cref="IsSupportedAsync"/> = false).
/// </summary>
public interface IDesignFolderService
{
    /// <summary>True, wenn <c>window.showDirectoryPicker</c> verfügbar ist.</summary>
    Task<bool> IsSupportedAsync(CancellationToken cancellationToken);

    /// <summary>Name des aktuell gesetzten Design-Ordners, oder <c>null</c>.</summary>
    Task<string?> GetFolderNameAsync(CancellationToken cancellationToken);

    /// <summary>Öffnet den Verzeichnis-Picker und persistiert das Handle.
    /// Liefert den Ordnernamen, oder <c>null</c> bei Abbruch/fehlender API.</summary>
    Task<string?> PickFolderAsync(CancellationToken cancellationToken);

    /// <summary>Vergisst den Ordner (entfernt das persistierte Handle).</summary>
    Task ClearFolderAsync(CancellationToken cancellationToken);

    /// <summary>Listet alle Designs im Ordner (sortiert nach Titel).</summary>
    Task<IReadOnlyList<DesignFileInfo>> ListAsync(CancellationToken cancellationToken);

    /// <summary>Liest eine Design-Datei als JSON, oder <c>null</c>.</summary>
    Task<string?> ReadAsync(string fileName, CancellationToken cancellationToken);

    /// <summary>Schreibt JSON als Design-Datei (legt an oder überschreibt).</summary>
    Task<bool> WriteAsync(string fileName, string json, CancellationToken cancellationToken);

    /// <summary>Löscht eine Design-Datei.</summary>
    Task<bool> DeleteAsync(string fileName, CancellationToken cancellationToken);

    /// <summary>True, wenn die Design-Datei existiert.</summary>
    Task<bool> ExistsAsync(string fileName, CancellationToken cancellationToken);
}
