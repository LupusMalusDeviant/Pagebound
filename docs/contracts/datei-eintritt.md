# Vertrag: Wie eine Datei in Pagebound hineinkommt

Status: **zur Abnahme** · Stand 2026-11-07 · betrifft `boot.js`, `wysiwyg-editor.ts`,
`service-worker.published.js`, `ReaderPage.razor`, `DesignerPage.razor`, `manifest.webmanifest`

Anlass: Für die App-Stores (siehe `docs/distribution/app-stores.md`, Abschnitt 0)
kommen zwei neue Wege hinzu, auf denen eine Datei in die App gelangt — der
PDF-Dateihandler unter Windows („Öffnen mit Pagebound") und `share_target` unter
Android („Teilen → Pagebound"). Beide müssen dort landen, wo die Drop-Zone des
Boot-Bildschirms heute schon landet, statt daneben einen zweiten Pfad aufzubauen.

## Warum ein Vertrag nötig ist

`window.launchQueue` erlaubt **genau einen** Empfänger: `setConsumer` ersetzt den
vorherigen. Heute setzt ihn `wysiwyg-editor.ts` für `.pbdesign.json`. Ein zweiter
Empfänger in `boot.js` für PDFs würde ihn still überschreiben — welcher gewinnt,
entscheidet die Ladereihenfolge der Bundles. Deshalb bekommt der Eintritt **eine**
Zuständigkeit.

## Die Zuständigkeit

**`boot.js` ist die einzige Stelle, die `launchQueue` entgegennimmt und Dateien
prüft.** Es parkt sie, nach Art getrennt; die Seiten holen sie ab, wenn sie bereit
sind. `boot.js` ist dafür die richtige Stelle, weil es ohne Bundle, ohne Blazor und
vor allem anderen läuft — eine gestartete Datei darf nicht davon abhängen, wie weit
der WASM-Start gekommen ist.

## Schnittstelle `window.pageboundBoot`

Bestehend, unverändert:

| Mitglied | Rückgabe | Bedeutung |
|---|---|---|
| `pendingFileName()` | `string \| null` | Name der geparkten PDF, ohne sie zu verbrauchen |
| `takePendingFile()` | `Uint8Array \| null` (in .NET `byte[]`) | geparkte PDF, **einmalig**; danach leer |
| `offer(file)` | `Promise<boolean>` | prüft und parkt eine Datei; `false` = abgelehnt |

Neu:

| Mitglied | Rückgabe | Bedeutung |
|---|---|---|
| `takePendingDesign()` | `string \| null` | geparkter Inhalt einer `.pbdesign.json`, **einmalig** |

`offer(file)` bleibt der einzige Prüfpunkt und behält seine heutigen Regeln:
MIME **und** Magic Bytes (`%PDF`), Größe ≤ 100 MB (= `ReaderPane.MaxFileSize`).
Jede neue Quelle geht durch `offer()`; keine Quelle parkt selbst.

## Die vier Quellen

| Quelle | Weg | Ziel |
|---|---|---|
| Drop-Zone / Auswahl | `offer(file)` | PDF geparkt |
| `file_handlers` (Windows) | `launchQueue` → `boot.js` sortiert nach Art | PDF geparkt bzw. Design geparkt |
| `share_target` (Android) | Service Worker, s. u. | PDF geparkt |
| `?pdf=`-Parameter | unverändert wie heute | — |

`boot.js` sortiert eine gestartete Datei nach ihrem Inhalt, nicht nach der Route:
beginnt sie mit `%PDF` → `offer()`; ist sie JSON → Design-Parkplatz. Nicht
Zuordenbares wird verworfen, mit derselben Meldung wie eine abgelehnte Drop-Datei.

## `share_target`

Manifest:

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "files": [{ "name": "file", "accept": ["application/pdf", ".pdf"] }] }
}
```

Ablauf im Service Worker (`service-worker.published.js`):

1. `onFetch` behandelt `POST /share-target` **vor** der bestehenden Zeile
   `if (event.request.method !== 'GET') return fetch(...)` — sonst geht die
   Freigabe ins Netz und ist verloren.
2. Die Datei aus `formData` wird im eigenen Cache `pb-share` unter
   `/__pb-share` abgelegt (`cache.put`), Dateiname im Header
   `X-Pagebound-Filename` (prozentkodiert).
3. Antwort: `Response.redirect('/reader', 303)`.

Dieser Redirect ist unbedenklich und berührt die Härtung aus `c4b7bfb` nicht: er
beantwortet eine **POST**-Anfrage und wird nicht gecacht. Gecacht wird nur die
Datei, und `index.html` bleibt unberührt.

4. `boot.js` sieht beim Start in `pb-share` nach (`caches` nur wenn vorhanden):
   Treffer → Datei entnehmen, Eintrag **löschen**, `offer(file)`.
   Gelöscht wird vor dem Verarbeiten, damit eine kaputte Datei nicht bei jedem
   Start erneut auftaucht.

Der Cache `pb-share` ist kein Offline-Cache: `onActivate` löscht heute alle
Caches, deren Name nicht die aktuelle Fassung trägt. `pb-share` muss davon
**ausgenommen** werden, sonst verschwindet eine geteilte Datei, wenn zeitgleich
eine neue Fassung aktiv wird.

## Was die Datenschutzzusage angeht

Nichts davon verlässt das Gerät: `launchQueue`, `formData` und `caches` sind
lokale Browser-Schnittstellen, der Redirect zeigt auf dieselbe Origin. `CSP
connect-src 'self'` bleibt unverändert, `privacy-check.mjs` muss grün bleiben.

## Prüfungen, die das belegen sollen

- `offer()` lehnt weiterhin ab: kein PDF, zu groß — und zwar an einer Datei, die
  nur die Endung `.pdf` trägt (Magic Bytes).
- Zwei `setConsumer`-Aufrufe gibt es nicht mehr: ein Test sucht im gebauten
  `wwwroot/js` nach `setConsumer` und erwartet **genau einen** Treffer, in
  `boot.js`.
- E2E: `POST /share-target` mit einer PDF führt zu `/reader` mit geöffneter Datei;
  der Eintrag in `pb-share` ist danach weg.
- E2E: `pb-share` überlebt einen Fassungswechsel des Service Workers.
