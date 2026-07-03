# Stapelverarbeitung

## Zweck

Eine Operation (z. B. Komprimieren, Verschlüsseln, Export) auf mehrere PDFs gleichzeitig anwenden (FA-052). Ergebnisse werden gesammelt als ZIP ausgeliefert. Häufig genutzte Konfigurationen lassen sich als benannte Stapel-Regeln lokal speichern und wiederverwenden — 100 % lokal in IndexedDB, kein Server.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Domain/BatchRule.cs` | Domain: benanntes Preset einer Batch-Operation (`Id`, `Name`, `Operation` als Enum-Name-String, `UpdatedAt`) — bewusst **ohne Passwort** (Secrets werden nie persistiert) |
| `src/Pagebound.Core/Abstractions/IBatchRuleStore.cs` | Interface: `ListAsync` / `SaveAsync` / `DeleteAsync` für Stapel-Regeln |
| `src/Pagebound.Infrastructure/Pdf/BatchRuleStore.cs` | Implementierung — Persistenz über `IStorageService` (IndexedDB) |
| `src/Pagebound.Web/Features/PdfTools/BatchPage.razor` | UI: Dateien wählen, Operation/Regel wählen, Lauf starten, ZIP herunterladen |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **PDF-Werkzeuge** — genutzt für die eigentlichen Operationen pro Datei (Compress via `IPdfManipulator.CompressAsync`, Encrypt via `EncryptAsync`/`IPdfEncryptor`). Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **Konvertierung** — genutzt für Export-Operationen (z. B. PDF→Bild/Text) im Stapel. Siehe [`./konvertierung.md`](./konvertierung.md).
- **Storage & Persistenz** — genutzt für die Regel-Persistenz (`IBatchRuleStore` → `IStorageService` → IndexedDB). Siehe [`./storage-persistenz.md`](./storage-persistenz.md).

### Extern (Packages)
- ZIP-Erzeugung im Browser (Sammel-Download der Ergebnisse).

## Öffentliche API / Interface

```csharp
public interface IBatchRuleStore
{
    Task<IReadOnlyList<BatchRule>> ListAsync(CancellationToken ct);   // neueste zuerst
    Task SaveAsync(BatchRule rule, CancellationToken ct);             // setzt Id (falls leer) + UpdatedAt
    Task DeleteAsync(string id, CancellationToken ct);
}
```

```csharp
public sealed class BatchRule
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Operation { get; set; }   // Enum-Name, z. B. "Compress"
    public DateTimeOffset UpdatedAt { get; set; }
}
```

Sicherheits-Invariante: Verschlüsselungs-Passwörter sind **nie** Teil einer gespeicherten Regel — der Nutzer gibt sie bei jedem Lauf neu ein.

## Datenfluss / Call-Flow

1. Nutzer wählt in `BatchPage.razor` mehrere PDFs und eine Operation (oder lädt eine gespeicherte Regel via `IBatchRuleStore.ListAsync`).
2. Bei Encrypt: Passwort-Eingabe pro Lauf (nicht persistiert).
3. Pro Datei wird die passende Operation ausgeführt (`IPdfManipulator` bzw. `IPdfConverter`), Fortschritt wird angezeigt.
4. Alle Ergebnis-Dateien werden zu einem ZIP gepackt und als Download angeboten.
5. Optional: Konfiguration als `BatchRule` benennen und via `SaveAsync` in IndexedDB ablegen.
