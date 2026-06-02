namespace Pagebound.Core.Abstractions;

/// <summary>
/// Persistente File-Referenz auf Basis der File-System-Access-API (Chromium-only,
/// FA-060 Phase 2). Erlaubt einem Library-Eintrag One-Click-Wiederöffnen ohne
/// File-Picker, indem ein <c>FileSystemFileHandle</c> in IndexedDB persistiert
/// wird; beim späteren Reopen reicht ein dezenter Permission-Dialog.
///
/// Wenn der Browser die API nicht kennt (Firefox/Safari), liefern alle Methoden
/// neutrale Ergebnisse — der Aufrufer fällt automatisch auf seinen Bytes-Cache
/// (oder den klassischen File-Picker) zurück.
/// </summary>
public interface IFileHandleService
{
    /// <summary>
    /// True, wenn <c>window.showOpenFilePicker</c> verfügbar ist.
    /// Wird vom Reader genutzt, um zwischen FSA-Picker und Standard-InputFile
    /// zu wählen.
    /// </summary>
    Task<bool> IsSupportedAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Öffnet den nativen File-Picker. Gibt die rohen Bytes + den Filenamen
    /// zurück, plus eine kurzlebige Temp-ID, mit der das gerade frisch erzeugte
    /// File-Handle anschließend per <see cref="PersistHandleAsync"/> unter dem
    /// PDF-Hash gespeichert werden kann.
    /// Null, wenn der User abgebrochen oder die API nicht unterstützt wird.
    /// </summary>
    Task<PickedPdf?> PickPdfAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Persistiert das per <see cref="PickPdfAsync"/> bekommene File-Handle
    /// unter <c>pdf:handle:{hash}</c> in IndexedDB.
    /// </summary>
    Task<bool> PersistHandleAsync(string tempId, string hash, CancellationToken cancellationToken);

    /// <summary>
    /// Versucht, ein zuvor gespeichertes File-Handle für den gegebenen Hash
    /// zu reaktivieren. Bei der ersten Reaktivierung pro Session zeigt der
    /// Browser einen schmalen Permission-Dialog (kein File-Picker). Bei
    /// Ablehnung oder fehlendem Handle wird <c>null</c> zurückgegeben.
    /// </summary>
    Task<PickedPdf?> TryReopenAsync(string hash, CancellationToken cancellationToken);

    /// <summary>
    /// Entfernt das persistierte Handle aus IndexedDB — z.B. beim Library-
    /// Remove.
    /// </summary>
    Task ClearHandleAsync(string hash, CancellationToken cancellationToken);
}

/// <summary>
/// Ergebnis eines File-Picker-Aufrufs.
/// </summary>
/// <param name="Bytes">Roh-Inhalt der gewählten Datei.</param>
/// <param name="Filename">Dateiname (ohne Pfad).</param>
/// <param name="TempHandleId">
/// Temporäre ID des frisch erzeugten Handles auf JS-Seite. <c>null</c>, wenn
/// das Reopen-Feature nicht unterstützt wird (Firefox/Safari).
/// </param>
public sealed record PickedPdf(byte[] Bytes, string Filename, string? TempHandleId);
