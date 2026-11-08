# Interop-Hilfen (UI)

## Zweck

Alles, was in Blazor nicht geht und deshalb in JavaScript liegt: Tastaturkürzel, Textauswahl lesen, Elemente ziehen und in Größe ändern, Zeichnen mit Maus und Finger, Downloads auslösen und beobachten, das Signatur-Pad, Theme und Sprache am `<html>`-Element setzen, localStorage lesen. Dazu die UI-Feineinstellungen (Theme, Akzent, Schriftgröße, Dichte, Bewegung), die schon vor Blazor gelesen werden müssen. Dieses Feature hat keine Fachlogik — es ist die Hand, mit der die C#-Schicht den Browser anfasst.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/wwwroot/js/shortcuts-bridge.ts` | Die große Hilfs-Brücke (26 Exporte): Kürzel registrieren (`:70`) und lösen (`:86`), Fokus setzen (`:94`), Klickposition in Seitenanteile (`:107`), Textauswahl lesen (`:146`) und löschen (`:188`), Ziehen (`:208`) und Größe ändern (`:285`), Download (`:345`, `:764`) und Download-Beobachter (`:756`, `:760`), Bytes in neuem Tab (`:366`), Zeichnen aufnehmen (`:409`) und beenden (`:647`), Theme (`:662`) und Sprache (`:672`) setzen, Neuladen (`:679`), Textlayer-Skalierung richten (`:702`), localStorage (`:735`, `:743`), Signatur-Pad (`:804`–`:917`) |
| `src/Pagebound.Web/wwwroot/js/tweaks-bridge.ts` | UI-Feineinstellungen: anwenden (`:47`), lesen (`:58`), speichern (`:68`), einzeln setzen (`:77`), beim Start anwenden (`:83`) |
| `src/Pagebound.Web/wwwroot/js/types.d.ts` | 20 Zeilen gemeinsame Typdeklarationen für die Brücken |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

Dieses Feature hat **keine ausgehende Kante** im geprüften Graph. Es ist die unterste Schicht der Oberfläche und hängt nur am Browser.

Eingehend ist es dagegen das am häufigsten genutzte Feature überhaupt: App-Shell, Datei-Eintritt, Reader, PDF-Werkzeuge, Seiten-Organizer, Formulare, Konvertierung, Stapellauf, Signatur, Designer, Lokalisierung und die Store-Werkzeuge greifen darauf zu — zwölf eingehende Kanten im [INDEX](./INDEX.md).

### Extern (Packages)

- Keine. Reine Browser-APIs: `KeyboardEvent`, `Selection`, Pointer Events, Canvas, `Blob`, `URL.createObjectURL`, `localStorage`.

## Öffentliche API / Interface

Die Brücken werden als globale Objekte nach C# exportiert; aus Blazor heißt ein Aufruf etwa `JS.InvokeAsync<…>("pageboundShortcuts.clientPositionToFraction", …)`.

```ts
// shortcuts-bridge.ts — die Exporte, die andere Features belegen
export function register(ref: DotNetRef): void;                 // :70
export function clientPositionToFraction(...): Fraction;         // :107  Klick → 0..1 auf der Seite
export function getCurrentTextSelection(...): SelectionDto;      // :146  Markierung für Highlights
export function dragElementToFraction(...): void;                // :208
export function resizeElementToFraction(...): void;              // :285
export function downloadFile(...): void;                         // :345
export function downloadBytes(...): void;                        // :764
export function registerDownloadObserver(dotnetRef): void;       // :756
export function applyTheme(name: string): void;                  // :662
export function applyLang(code: string): void;                   // :672
export function getStorage(key: string): string | null;          // :735
export function setStorage(key: string, value: string): void;    // :743
export function initSignaturePad(selector: string): void;        // :804
export function getSignatureDataUrl(selector: string): string|null; // :863
export function renderTypedSignature(...): Promise<string|null>; // :875

// tweaks-bridge.ts
export function apply(t: Tweaks): void;   // :47
export function load(): Tweaks;           // :58
export function save(t: Tweaks): Tweaks;  // :68
export function set(key: string, value: unknown): Tweaks; // :77
export function init(): void;             // :83
```

Vertrag der Kürzel-Brücke: die Zuordnung Tastendruck → C#-Zeichenkette steht im Kopfkommentar von `shortcuts-bridge.ts` (`page-prev`, `page-next`, `page-first`, `page-last`, `focus-search`, `clear-search`, `zoom-in`, `zoom-out`, `zoom-reset`). Es gibt genau **einen** Listener auf `window`; jede Komponente registriert beim Einhängen und löst beim Verwerfen.

**Wichtige Regel in diesem Vertrag:** liegt der Fokus in einem Eingabefeld, einer Textarea, einem Select oder einem `contenteditable`, feuern nur `Escape` und `Ctrl+F` — alles andere bleibt dem Formularelement (`isEditingTarget` in `shortcuts-bridge.ts`). Ohne diese Regel würde das Tippen eines Pfeils in einem Freitextfeld die Seite blättern.

## Datenfluss / Call-Flow

1. **Kürzel:** Komponente ruft `register(ref)` (`:70`) mit einer `DotNetObjectReference`. Der einzige Listener auf `window` übersetzt den Tastendruck in die Zeichenkette und ruft die C#-Methode. Beim Verwerfen `unregister()` (`:86`) — sonst bleibt die Referenz hängen.
2. **Geometrie:** ein Klick auf dem Seiten-Canvas geht durch `clientPositionToFraction` (`:107`) und kommt als Anteil 0..1 in C# an. Das ist der Grund, warum alle Annotationen zoomfest sind.
3. **Zeichnen:** `startDrawingCapture` (`:409`) nimmt Pointer-Ereignisse auf und liefert Linienzüge; `stopDrawingCapture` (`:647`) hängt sich wieder aus.
4. **Download:** `downloadBytes` (`:764`) baut eine Blob-URL und klickt sie an; der Download-Beobachter (`:756`) meldet nach C#, dass die Datei draußen ist, damit die Oberfläche den Fortschritt beenden kann.
5. **Feineinstellungen:** das Vor-Boot-Skript in `index.html` setzt Theme und Akzent, bevor Blazor startet; danach hält `tweaks-bridge.ts` den Zustand, `apply` (`:47`) schreibt ihn an das `<html>`-Element, `save` (`:68`) in localStorage.

## Offene Fragen / TODOs

- `shortcuts-bridge.ts` ist mit 26 Exporten kein „Kürzel"-Modul mehr, sondern die Sammelstelle für alles Browsernahe — Signatur-Pad, Downloads und localStorage haben mit Tastaturkürzeln nichts zu tun. Der Name führt in die Irre; eine Aufteilung wäre sauberer, würde aber zwölf eingehende Kanten anfassen.
- `tweaks-bridge.ts` schreibt denselben localStorage-Schlüssel, den das Vor-Boot-Skript in `index.html` liest. Die beiden Stellen müssen dieselbe Struktur annehmen; ein gemeinsamer Vertrag dafür existiert nur als Kommentar.
