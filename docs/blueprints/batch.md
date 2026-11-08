# Stapelverarbeitung

## Zweck

Eine Operation auf viele PDFs anwenden — komprimieren, verschlüsseln, exportieren — und die Ergebnisse als ZIP ausliefern. Häufige Zusammenstellungen lassen sich als benannte Regel lokal speichern und wiederverwenden. Ohne das Feature müsste man jede Datei einzeln durch das Werkzeug-Panel schicken.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/PdfTools/BatchPage.razor` | Seite `/batch` (`:1`): Dateien wählen, Operation oder Regel wählen, Lauf starten, ZIP holen |
| `src/Pagebound.Core/Abstractions/IBatchRuleStore.cs` | Vertrag: Regeln auflisten, speichern, löschen (`:9`) |
| `src/Pagebound.Core/Domain/BatchRule.cs` | Die Regel: `Id`, `Name`, `Operation` als Enum-Name, `UpdatedAt` — **ohne Kennwort** |
| `src/Pagebound.Infrastructure/Pdf/BatchRuleStore.cs` | Umsetzung über den Key-Value-Speicher (`:16` nimmt `IStorageService`) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **PDF-Werkzeuge & Manipulation** (Typ, Laufzeit, via `IPdfManipulator`, `CompressionOptions`, `EncryptionOptions`): die Operationen je Datei — `src/Pagebound.Web/Features/PdfTools/BatchPage.razor:3`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Konvertierung & Standards** (Typ, Laufzeit, via `IPdfConverter`, `ConversionFormat`): Export-Operationen im Stapel — `…/BatchPage.razor:4`. Siehe [`./konvertierung.md`](./konvertierung.md).
- **Library & Workspace** (Typ, via `ByteSizeFormatter`): Dateigrößen in der Liste — `…/BatchPage.razor:304`. Siehe [`./library-workspace.md`](./library-workspace.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `…/BatchPage.razor:6`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `save`): Download des ZIP — `…/BatchPage.razor:101`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).
- **Storage & Persistenz** (Querschnitt, via `IStorageService`): die Regeln liegen in IndexedDB — `src/Pagebound.Infrastructure/Pdf/BatchRuleStore.cs:16`. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).

### Extern (Packages)

- `fflate` (über die Brücken) — ZIP der Ergebnisse

## Öffentliche API / Interface

```csharp
// src/Pagebound.Core/Abstractions/IBatchRuleStore.cs:9
public interface IBatchRuleStore
{
    Task<IReadOnlyList<BatchRule>> ListAsync(CancellationToken ct);   // neueste zuerst
    Task SaveAsync(BatchRule rule, CancellationToken ct);             // setzt Id (falls leer) + UpdatedAt
    Task DeleteAsync(string id, CancellationToken ct);
}

public sealed class BatchRule
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Operation { get; set; }   // Enum-Name, z. B. "Compress"
    public DateTimeOffset UpdatedAt { get; set; }
}
```

**Sicherheits-Invariante:** ein Verschlüsselungs-Kennwort ist **nie** Teil einer gespeicherten Regel. `BatchRule` hat kein Feld dafür — der Nutzer gibt es bei jedem Lauf neu ein. Das ist der Grund, warum die Regel nur den Namen der Operation speichert und nicht ihre vollständigen Optionen.

## Datenfluss / Call-Flow

1. Der Nutzer wählt in `BatchPage.razor` mehrere PDFs und eine Operation, oder lädt eine Regel über `ListAsync`.
2. Bei Verschlüsselung: Kennwort-Eingabe pro Lauf, nicht persistiert.
3. Je Datei läuft die passende Operation — `IPdfManipulator` oder `IPdfConverter` (`BatchPage.razor:3`, `:4`) — mit Fortschrittsanzeige.
4. Alle Ergebnisse werden zu einem ZIP gepackt und über `save` zum Download angeboten (`…/BatchPage.razor:101`).
5. Optional wird die Zusammenstellung als `BatchRule` benannt und über `SaveAsync` in IndexedDB abgelegt.

## Offene Fragen / TODOs

- `Operation` ist ein Enum-**Name** als Zeichenkette. Wird ein Enum-Wert umbenannt, zeigen gespeicherte Regeln auf nichts mehr; der Kommentar in `ConversionTypes.cs:11` („nur anhängen") ist genau deshalb da, aber eine Migration gespeicherter Regeln gibt es nicht.
- Der Stapellauf hält die Ergebnisse bis zum ZIP im Speicher. Bei vielen großen Dateien ist das der erwartbare Engpass.
