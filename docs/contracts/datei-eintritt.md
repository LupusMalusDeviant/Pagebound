# Vertrag: Wie eine Datei in Pagebound hineinkommt

Status: **abgenommen 2026-11-07**, einschließlich Nachtrag 1 · betrifft `boot.js`,
`wysiwyg-editor.ts`, `service-worker.published.js`, `ReaderPage.razor`,
`DesignerPage.razor`, `manifest.webmanifest`

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

> **Rückgabeform geändert durch Nachtrag 1.** Die beiden Tabellen unten nennen
> die Bedeutung der Mitglieder; die *Rückgaben* stehen so nur im Ursprungsstand.
> Verbindlich ist Nachtrag 1: `pendingFileName()`, `takePendingFile()` und
> `takePendingDesign()` liefern **Promises** und warten intern auf die einmalige
> Abholung der Freigaben.

Bestehend:

| Mitglied | Rückgabe (vor Nachtrag 1) | Bedeutung |
|---|---|---|
| `pendingFileName()` | `string \| null` | Name der geparkten PDF, ohne sie zu verbrauchen |
| `takePendingFile()` | `Uint8Array \| null` (in .NET `byte[]`) | geparkte PDF, **einmalig**; danach leer |
| `offer(file)` | `Promise<boolean>` | prüft und parkt eine Datei; `false` = abgelehnt |

Neu:

| Mitglied | Rückgabe (vor Nachtrag 1) | Bedeutung |
|---|---|---|
| `takePendingDesign()` | `string \| null` | geparkter Inhalt einer `.pbdesign.json`, **einmalig** |

`offer(file)` bleibt der einzige Prüfpunkt und behält seine heutigen Regeln:
MIME **und** Magic Bytes (`%PDF`), Größe ≤ 100 MB (= `ReaderPane.MaxFileSize`).
Jede PDF geht durch `offer()`; keine Quelle parkt eine PDF selbst. Den
Design-Parkplatz füllt `sortLaunched()` direkt — und nur dort, wo ihn auch
jemand abholt, siehe Nachtrag 2.

**Zum MIME-Typ der beiden neuen Quellen.** Bei Drop-Zone und Auswahl kommt er
vom Browser und ist etwas wert. Bei einem Dateihandler und erst recht bei einer
Freigabe ist er eine Behauptung des Betriebssystems — Android gibt für eine PDF
regelmäßig `application/octet-stream`. Beide Quellen sortieren laut diesem
Vertrag ohnehin **nach Inhalt**; steht dort `%PDF-`, wird `offer()` deshalb ein
`File` mit dem *geprüften* Typ `application/pdf` übergeben, nicht mit dem
behaupteten. Sonst verwirft die MIME-Regel eine einwandfreie PDF, und die
Freigabe ist auf Android schlicht kaputt. Die Regel selbst bleibt unverändert,
und für die Drop-Zone ändert sich nichts.

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

> **Eingeschränkt durch Nachtrag 2.** Der Inhalt entscheidet, *was* die Datei
> ist; ob ein Entwurf überhaupt geparkt wird, entscheidet zusätzlich die Route:
> nur auf `/editor`. Ein JSON, das über das Teilen-Menü hereinkommt, wird
> verworfen. Erkannt wird JSON vor PDF (ein Entwurf darf `%PDF-` im Text
> enthalten).

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
2. Die Datei aus `formData` wird im eigenen Cache `pb-share` abgelegt
   (`cache.put`), Dateiname im Header `X-Pagebound-Filename` (prozentkodiert).
   Der Schlüssel ist `/__pb-share/<n>` mit einer je Freigabe eigenen Nummer
   (Nachtrag 2 — der Ursprungsstand nannte hier den festen Schlüssel
   `/__pb-share`, bei dem die zweite Freigabe die erste überschrieb).
3. Antwort: `Response.redirect('/reader', 303)`, bei einem Fehlschlag mit einer
   Kennung (`?share=failed`, `?share=rejected`, `?share=toobig` — Nachtrag 2).

Dieser Redirect ist unbedenklich und berührt die Härtung aus `c4b7bfb` nicht: er
beantwortet eine **POST**-Anfrage und wird nicht gecacht. Gecacht wird nur die
Datei, und `index.html` bleibt unberührt.

4. `boot.js` sieht beim Start in `pb-share` nach (`caches` nur wenn vorhanden):
   Treffer → Datei entnehmen, Eintrag **löschen**, `offer(file)`.
   Gelöscht wird vor dem Verarbeiten, damit eine kaputte Datei nicht bei jedem
   Start erneut auftaucht.

Der Cache `pb-share` ist kein Offline-Cache. `onActivate` räumt heute nur Caches
weg, deren Name mit `offline-cache-` beginnt und nicht die aktuelle Fassung trägt
(`onActivate`, die `filter`-Zeile auf `cacheNamePrefix`) — ein Cache namens `pb-share` ist davon
also **schon heute unberührt**, es ist keine Ausnahme einzubauen. Festgeschrieben
wird dafür die Bedingung, von der das abhängt:

**Der Name des Freigabe-Caches darf nicht mit `cacheNamePrefix`
(`offline-cache-`) beginnen, und die Aufräumregel in `onActivate` bleibt auf
dieses Präfix beschränkt.** Wird sie je zu „alles außer dem aktuellen Cache"
verallgemeinert, verschwindet eine geteilte Datei, sobald während des Teilens
eine neue Fassung aktiv wird. Der Test unten hält das fest.

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
- Die Abholung ist nicht zu früh: ein Test mit einem gefüllten `pb-share` und
  einem `pendingFileName()`-Aufruf **unmittelbar** nach dem Laden von `boot.js`
  muss den Namen liefern, nicht `null`.
- `pb-share` überlebt einen Fassungswechsel des Service Workers: `onActivate`
  mit einem gefüllten `pb-share` und einer neuen Fassung laufen lassen, danach
  muss der Eintrag noch da sein. Das prüft nicht den heutigen Stand (der ist
  schon richtig), sondern verhindert, dass eine spätere Verallgemeinerung der
  Aufräumregel geteilte Dateien still frisst.

---

# Nachtrag 1 — abgenommen 2026-11-07

Beim Lesen des Codes zeigte sich eine Lücke in der Schnittstelle oben. Sie ist
keine Richtungsänderung, aber sie steht in der Tabelle, die abgenommen wurde.

## Das Problem: die Abholung kommt zu spät

`ReaderPage.razor:151-154` fragt **zuerst** `pendingFileName()` und bricht bei
leerem Namen ab, bevor es `takePendingFile()` überhaupt aufruft:

```csharp
var name = await JS.InvokeAsync<string?>("pageboundBoot.pendingFileName");
if (string.IsNullOrEmpty(name)) return;
```

Die Abholung aus `pb-share` ist asynchron (`caches.open` → `cache.match` →
`blob()`). `pendingFileName()` ist heute ein **synchroner** Getter auf eine
Variable. Mountet der Reader, bevor die Abholung durch ist, antwortet er `null`,
der Reader bricht ab — und die geteilte Datei ist still verloren, obwohl sie
gleich danach im Parkplatz landet. Dass der WASM-Start Sekunden braucht und ein
Cache-Zugriff Millisekunden, ist kein Nachweis: genau diese Art „geht in der
Praxis" steht hinter den bisherigen Fehlschlägen.

## Die Änderung

**`pendingFileName()` und `takePendingDesign()` warten intern auf die einmalige
Abholung und liefern ein Promise.** Statt

| `pendingFileName()` | `string \| null` |
| `takePendingDesign()` | `string \| null` |

gilt

| `pendingFileName()` | `Promise<string \| null>` |
| `takePendingDesign()` | `Promise<string \| null>` |

`takePendingFile()` liefert schon heute ein Promise und wartet künftig auf
dasselbe. Beide .NET-Aufrufer verwenden bereits `JS.InvokeAsync`, das ein
zurückgegebenes Promise auflöst — **an `ReaderPage.razor` und
`DesignerPage.razor` ändert sich keine Zeile.**

`consumeLaunchDesign()` in `wysiwyg-editor.ts` behält Namen und Aufrufstelle
(`DesignerPage.razor:921`), gibt die Zuständigkeit aber ab: es ruft nur noch
`window.pageboundBoot.takePendingDesign()` auf. Der eigene `setConsumer` und der
Zwischenspeicher `globalThis.__pbLaunchDesign` fallen weg.

## Außerdem festgelegt

Der PDF-Dateihandler bekommt `"action": "/reader"` (im Vertrag oben nicht
benannt). Der bestehende Design-Handler behält `/editor`, damit eine
`.pbdesign.json` ohne Umschreiben der Route im Designer landet.

---

# Nachtrag 2 — abgenommen 2026-11-07, aus dem Review von a194d53

Ein unabhängiges Review fand im umgesetzten Stand sechs Lücken. Was daraus
verbindlich wird:

**Ein Entwurf wird nur geparkt, wo ihn jemand abholt.** `sortLaunched()` parkt
ein JSON ausschließlich auf der Designer-Route (`location.pathname` beginnt mit
`/editor`), sonst wird es mit derselben Meldung wie eine abgelehnte Drop-Datei
verworfen. Vorher landete ein über das Teilen-Menü hereinkommendes JSON im
Design-Parkplatz, der Reader (der nur nach einer PDF fragt) bekam nichts — und
beim nächsten Wechsel in den Designer ersetzte es dessen Dokument, ohne dass der
Nutzer in diesem Moment eine Datei gewählt hatte.

**Ein Entwurf hat seine eigene Größengrenze** (5 MB) und muss ein JSON-*Objekt*
sein. Die 100-MB-Grenze der PDFs taugt dafür nicht: der Inhalt wird als String
gelesen und als zweite Kopie nach .NET gereicht.

**Jede Freigabe bekommt einen eigenen Schlüssel** unter `/__pb-share/<n>`, die
Zahl aus dem Cache selbst (keine Uhr, keine Zufalls-Id). `boot.js` arbeitet alle
Einträge in Schlüsselreihenfolge ab; die erste annehmbare PDF gewinnt, weitere
werden gemeldet. Mit einem festen Schlüssel ging bei zwei Freigaben kurz
hintereinander eine verloren, oder `boot.js` löschte eine, die es nie gelesen
hatte.

**Eine Freigabe mit Verweis auf eine fremde Herkunft wird abgewiesen.** Eine
beliebige Website kann ein Formular auf `/share-target` absenden und damit eine
Datei mit einem Namen ihrer Wahl in das Pagebound des Nutzers schieben. Der
Service Worker nimmt nur an, was keinen Verweis hat (so kommt eine echte
Freigabe) oder einen auf die eigene Herkunft. Das ist die **erste** Schranke,
nicht die einzige: `Sec-Fetch-Site` steht im Service Worker nicht zuverlässig
zur Verfügung, und ein Angreifer kann den Verweis unterdrücken.

**Ein Fehlschlag wird gesagt.** Kann der Service Worker die Freigabe nicht
übernehmen (Speicher voll, Formular unlesbar), leitet er auf
`/reader?share=failed`, und `boot.js` meldet es. Ohne das käme der Reader leer
hoch, und die Freigabe sähe auf Android ohne ein Wort kaputt aus.

**Dasselbe tut der Server**, wenn der Service Worker (noch) keine Kontrolle hat:
`location = /share-target { return 303 /reader?share=failed; }`. Sonst
beantwortet `try_files` den POST mit 405 und der Nutzer sieht eine Fehlerseite.

## Offen, nicht entschieden

1. **Eine Datei, die erst nach dem `ready`-Gatter zugestellt wird**, erreicht die
   Seite nicht. `boot.js` hält den Start eine Makrotask-Runde an
   (`setTimeout(…, 0)`), damit gestapelte Startparameter im `ready`-Gatter
   liegen. Das ist ausdrücklich **keine Zusicherung**: die Spezifikation sagt
   nur, dass die Zustellung „in einer Aufgabe" nach `setConsumer` erfolgt, nicht
   in der nächsten, und das Lesen der Datei (`getFile()`) braucht selbst weitere
   Runden. Das übliche Fenster ist damit geschlossen, der Wettlauf nicht
   beseitigt. Fällt die Zustellung dahinter — ebenso ein zweites „Öffnen mit"
   ohne neuen Tab —, liegt die Datei geparkt da und wird erst beim nächsten
   Mount abgeholt. Beides schließt nur eine Benachrichtigung an die Seite; das
   ändert `ReaderPage.razor` und braucht deshalb einen eigenen Nachtrag.
2. **Eine Rückfrage vor dem Öffnen einer geteilten Datei** („Geteilte Datei ‚x'
   öffnen?"). Sie würde die Lücke schließen, die die Herkunftsprüfung offen
   lässt, kostet aber einen Klick bei jeder Freigabe — eine
   Bedienungsentscheidung, nicht meine.
