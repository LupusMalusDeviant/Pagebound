# Seiten-Organizer

## Zweck

Seiten einer PDF visuell verwalten: Vorschaubilder per Ziehen neu ordnen, einzeln um ±90° drehen und löschen. Das Ergebnis wird als neue Datei `<name>.organized.pdf` ausgegeben; Original und Sidecar bleiben unangetastet. Ohne dieses Feature müsste man dieselbe Arbeit über drei einzelne Werkzeuge (Reorder, Rotate, Delete) nacheinander machen, ohne zu sehen, was man tut.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/Features/PdfTools/OrganizerPage.razor` | Seite `/organize` (`:1`): Datei wählen, Vorschaubilder rendern, Ziehen, Drehen, Löschen, „Anwenden & speichern" |

Die Arbeit am PDF selbst liegt in [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md) (`OrganizePagesAsync` in `IPdfManipulator:135`, JS-Seite `organizePages` in `src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.ts`).

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **PDF-Werkzeuge & Manipulation** (Laufzeit, via `IPdfManipulator`): baut das neue Dokument aus den Quellseiten — `src/Pagebound.Web/Features/PdfTools/OrganizerPage.razor:4`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).
- **PDF-Reader & Rendering** (Typ, via `LoadResult`): die Vorschaubilder entstehen über die PDF.js-Brücke — `…/OrganizerPage.razor:93`. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `…/OrganizerPage.razor:5`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `apply`, `init`, `downloadBytes`): Download des Ergebnisses, Feineinstellungen — `…/OrganizerPage.razor:27`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

### Extern (Packages)

- `pdf-lib` (indirekt) — `copyPages`, `setRotation`, `save` für den Neuaufbau
- `pdfjs-dist` (indirekt) — Rasterung der Vorschaubilder

## Öffentliche API / Interface

Das Feature exportiert nichts; es ist eine Seite. Sein Vertrag nach unten ist `PageOp`:

```csharp
// src/Pagebound.Core/Domain/PdfManipulatorTypes.cs
public sealed record PageOp(int SourceIndex, int Rotation);

// src/Pagebound.Core/Abstractions/IPdfManipulator.cs:135
Task<byte[]> OrganizePagesAsync(Stream pdf, IReadOnlyList<PageOp> ops, CancellationToken ct);
```

`SourceIndex` ist nullbasiert; die **Reihenfolge der Liste** ist die neue Seitenreihenfolge. `Rotation` ist ein Delta zur bestehenden Seitenrotation, ein Vielfaches von 90°. Ausgelassene Quellseiten sind gelöscht — Löschen ist also kein eigener Vorgang, sondern das Fehlen in der Liste.

## Datenfluss / Call-Flow

1. Der Nutzer wählt eine PDF; die Seite lädt sie über die PDF.js-Brücke und rendert je Seite ein Vorschaubild (`OrganizerPage.razor:93` nutzt `LoadResult`).
2. Ziehen ordnet die Liste `_pages` um; die Drehknöpfe ändern das `Rotation`-Delta, die Vorschau dreht per CSS-`transform`; ✕ markiert eine Seite als gelöscht und ist zurücknehmbar.
3. „Anwenden" baut aus den nicht gelöschten Einträgen die `PageOp`-Liste und ruft `OrganizePagesAsync` (`…/OrganizerPage.razor:4` injiziert `IPdfManipulator`).
4. Die Brücke kopiert die Quellseiten in der gegebenen Reihenfolge, wendet die Rotationen an und speichert; die Bytes gehen über `downloadBytes` als `<name>.organized.pdf` an den Nutzer (`…/OrganizerPage.razor:27`).

## Offene Fragen / TODOs

- Die Anzeige ist auf die ersten 60 Seiten begrenzt (`MaxPages` in `OrganizerPage.razor`) — eine Grenze aus Rücksicht auf die Rasterung der Vorschaubilder, keine Grenze der Operation.
- Die Vorschau dreht per CSS, das Ergebnis-PDF über pdf-lib. Beide Wege können theoretisch auseinanderlaufen; eine Prüfung, die genau das findet (Vergleich der Ausgabe-Rotation mit der Vorschau), fehlt.
