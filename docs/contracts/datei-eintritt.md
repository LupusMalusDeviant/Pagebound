# Vertrag: Wie eine Datei in Pagebound hineinkommt

Status: **abgenommen 2026-11-07**, einschließlich der Nachträge 1 bis 4 · betrifft `boot.js`,
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

---

# Nachtrag 3 — abgenommen 2026-11-07, aus dem Review von 37f718b

Zwei Änderungen am abgenommenen Stand. Die erste behebt einen Fehler, bei dem
die App eine Datei öffnet, die der Nutzer nicht gewählt hat; die zweite schließt
die Herkunftsprüfung, die in Nachtrag 2 zu weit offen stand.

## 3.1 Eine Freigabe wird genau dort abgeholt, wohin sie umgeleitet hat

**Der Fehler.** Nachtrag 2 gibt jeder Freigabe einen eigenen Schlüssel
`/__pb-share/<n>`, und `boot.js` holt bei jedem Start **alle** geparkten
Einträge ab, aufsteigend sortiert. Die *älteste* gewinnt also, und jede weitere
läuft in `if (pending)`, wird aber vorher schon aus dem Cache gelöscht. Daraus
folgt:

1. Freigabe A wird als `/__pb-share/1` geparkt, der Start bricht ab (Fenster
   geschlossen, Tab beendet) — A bleibt liegen.
2. Tage später teilt der Nutzer B. Der Worker legt B als `/__pb-share/2` ab.
3. `boot.js` nimmt A, öffnet A, und löscht B mit der Meldung „Mehrere geteilte
   Dateien — geöffnet wird die erste".

Der Nutzer sieht eine Datei, die er nicht gewählt hat; seine eigene ist weg; und
die Meldung ist falsch, weil er eine Datei geteilt hat. Weil `pickUpShared()`
bei **jedem** Start und auf **jeder** Route läuft, geht A auch bei einem
gewöhnlichen Aufruf von `/` oder `/editor` auf, und `accept()` reißt die Route
auf `/reader`. Das widerspricht auch der Zusage der Datenschutzseite, eine
geteilte Datei werde „beim nächsten Start der App entnommen und gelöscht":
gelöscht ja, entnommen nein.

**Die Änderung.** Der Schlüssel wird mitgeteilt, statt erraten.

| | vorher (Nachtrag 2) | neu |
|---|---|---|
| Umleitung bei Erfolg | `/reader` | `/reader?share=<n>` |
| Abholung | alle Einträge, aufsteigend, in Runden | **genau** `/__pb-share/<n>` aus dem Parameter |
| Start ohne `?share=` | holt alles ab | öffnet nichts aus dem Freigabe-Cache |

Im Einzelnen:

1. Der Worker kennt `n` innerhalb der Sperre und hängt es an das Umleitungsziel.
   Die Kennung ist eine Zahl; `?share=failed|rejected|toobig` bleiben unverändert
   die Fehlerfälle.
2. `boot.js` liest `share` per `URLSearchParams`. Ist der Wert eine Zahl, wird
   `/__pb-share/<zahl>` geholt, verarbeitet und gelöscht — und nur dieser.
3. **Waisen werden aufgeräumt, nicht geöffnet.** Jeder andere Eintrag im
   Freigabe-Cache wird beim Start gelöscht, ohne ihn zu öffnen und ohne Meldung.
   Damit bleibt die Zusage der Datenschutzseite wahr, und ein liegengebliebener
   Eintrag kann nie mehr eine Route aufreißen. Das deckt auch den festen
   Schlüssel `/__pb-share` ohne Nummer aus dem Ursprungsstand ab (nie
   ausgeliefert — `a194d53` ist bis heute nicht gepusht, belegt über
   `git log origin/main..HEAD`; die Aufräumregel kostet aber nichts).

   **Zwei Einschränkungen, bei der Umsetzung gefunden** (enger als „jeder andere
   Eintrag", deshalb hier nachgetragen):

   a) **Eine HÖHERE Nummer als die eigene wird nicht gelöscht.** Teilt der
      Nutzer B, während die Seite aus Freigabe A noch lebt, parkt der Worker B
      und antwortet mit einer Umleitung — die Navigation dorthin kommt erst. Ein
      Aufräumen, das „alles außer meiner" löscht, würde B in genau diesem
      Fenster wegräumen, und das neue Dokument fände nichts. Gelöscht werden
      deshalb nur Einträge mit **kleinerer** Nummer und Einträge ohne Nummer.
      Ein Start **ohne** `?share=` räumt alles auf, was er beim Nachsehen
      vorfindet: dort ist keine eigene Navigation unterwegs, an der sich die
      Reihenfolge messen ließe. Maßgeblich ist immer die eine Momentaufnahme von
      `cache.keys()`; was danach ankommt, bleibt liegen.

   b) **Fehlt der Eintrag zur eigenen Nummer, wird das gemeldet** (dieselbe
      Meldung wie `?share=failed`). Sonst wäre genau der Fall aus (a) — oder ein
      vom Browser geräumter Cache — ein stilles Nichts: die App käme leer hoch,
      und der Nutzer erfährt nicht, dass seine Datei nicht ankam.
4. Die Runden-Schleife entfällt. Sie sollte eine Freigabe einsammeln, die
   *während* der Abholung ankommt; eine solche Freigabe hat jetzt ihre eigene
   Navigation mit ihrer eigenen Nummer und braucht die Schleife nicht.
5. Die Meldung „Mehrere geteilte Dateien — geöffnet wird die erste" entfällt mit
   ihr. Mehrere Dateien in **einer** Freigabe bleiben der Fall von Nachtrag 2
   (die erste gewinnt), dort unverändert.

## 3.2 Die Herkunftsprüfung nennt die Schemata, statt alle fremden zu erlauben

**Der Fehler.** Nachtrag 2 wertet nur einen `http(s)`-Verweis mit fremder Origin
als fremd — damit die Android-Fassung (`android-app://<paket>/`) nicht jede
Freigabe abgewiesen bekommt. Das fällt aber nach *offen* aus, mehr als nötig:

- ein Verweis, den `new URL()` nicht lesen kann, gilt jetzt als vertrauenswürdig
  (vorher als fremd);
- **jedes** andere Schema gilt als Betriebssystem, auch `chrome-extension://`.

**Die Änderung.** Vertrauenswürdig ist genau: kein Verweis, `about:client`, die
eigene Origin über `http(s)`, oder das Schema `android-app:`. Alles andere —
fremde `http(s)`-Origin, jedes weitere Schema, ein unlesbarer Verweis — wird mit
`?share=rejected` abgewiesen. Kommt ein weiterer Auslieferungsweg hinzu
(iOS, Microsoft Store), wird sein Schema hier eingetragen und geprüft, nicht
pauschal erlaubt.

**Was das nicht schließt**, unverändert zu Nachtrag 2 und zu „Offen 2": eine
fremde Seite kann den Verweis per `referrerpolicy="no-referrer"` unterdrücken.
Dann ist `request.referrer` leer und die Freigabe gilt als Freigabe des
Betriebssystems. Das ist bekannt und wird ausdrücklich in Kauf genommen; es
gehört in `SECURITY.md`, damit es nicht als Schutz erscheint, der es nicht ist.

---

# Nachtrag 4 — abgenommen 2026-11-07, aus dem Review von b727c01

Nachtrag 3 ist in zwei Punkten auf einer Annahme gebaut, die nicht hält, und ein
dritter Punkt beruht auf einem Header, den es nicht gibt. Alle drei sind
nachgemessen, nicht erschlossen.

**Vorbemerkung zu 4.1 und 4.2.** Eine erste Fassung dieses Nachtrags behandelte
die beiden Befunde einzeln: ein dauerhafter Zähler gegen das Zurückfallen der
Nummern, eine Altersregel gegen das Wegräumen fremder Einträge. Beide Befunde
hängen aber an **einer** Entscheidung — dass die Freigabe-Kennung eine laufende
Nummer ist. Daraus folgt, dass sie irgendwoher kommen muss (und bei leerem Cache
bei 1 wieder anfängt) und dass Kennungen vergleichbar sind (also „kleiner heißt
älter" naheliegt und `?share=999` zur Waffe wird). Dieser Nachtrag ersetzt die
Entscheidung statt ihre beiden Folgen zu verwalten.

## 4.1 Die Freigabe-Kennung ist ein nicht erratbarer Wert, keine laufende Nummer

**Die Annahme.** Nachtrag 3.1 a stützt sich darauf, dass eine höhere Nummer
neuer ist.

**Warum sie nicht hält.** Die Nummer wird als `max(vorhandene Nummern) + 1`
aus dem Cache-Inhalt abgeleitet. Ist der Cache leer — und das ist er nach jeder
erfolgreichen Abholung —, beginnt die Zählung wieder bei 1. Eine Adresse
`?share=5`, die in einem Tab stehen geblieben ist, hält dann eine frische
Freigabe `/__pb-share/1` für älter und löscht sie als Waise. Bei gleicher Nummer
öffnet der alte Tab die Datei der neuen Freigabe, und die richtige Navigation
findet nichts.

**Die Änderung.**

1. Der Worker erzeugt je Freigabe eine Kennung aus `crypto.randomUUID()`. Ein
   Service Worker ist immer ein sicherer Kontext, dort ist die Funktion
   verfügbar; fehlt sie trotzdem, treten 16 Bytes aus
   `crypto.getRandomValues()` als Hexadezimaltext an ihre Stelle. Der Schlüssel
   im Cache ist `/__pb-share/<kennung>`, die Umleitung lautet
   `?share=<kennung>`.
2. Damit entfällt der Lesen-Ändern-Schreiben-Schritt. Zwei gleichzeitige
   Freigaben schreiben verschiedene Schlüssel, können sich also nicht
   überschreiben — **ohne** dass etwas sie hintereinander hält.
3. **`withShareLock` entfällt deshalb.** Die Sperre hatte genau eine Aufgabe: die
   Vergabe von `max + 1` unteilbar zu machen. Sie als stillen Zusatzschutz
   stehen zu lassen wäre ein Wächter ohne Fehler, den er finden könnte. Die
   Eigenschaft, die sie geschützt hat (zwei Freigaben kurz hintereinander
   überleben beide), gilt jetzt von selbst und wird weiter geprüft — der
   vorhandene Test auf zwei gleichzeitige Freigaben bleibt und prüft
   verschiedene Schlüssel statt aufeinanderfolgende Nummern.
4. `boot.js` erkennt eine Kennung an ihrer Form (UUID oder 32 Hexzeichen) und
   hält alles andere für eine Fehlerkennung oder für nichts. Die
   Fehlerkennungen `rejected`, `toobig`, `failed` können mit keiner Kennung
   zusammenfallen.

**Was die Zufälligkeit hier nicht berührt.** Die Zusicherung „keine Zufalls-Ids"
gilt für die Ausgabe des MCP-Pakets: gleiche Eingabe → byte-gleiches PDF. Eine
Kennung in einem lokalen Zwischenspeicher ist keine Ausgabe; sie verlässt das
Gerät nicht und steht in keiner erzeugten Datei.

## 4.2 Aufgeräumt wird nach Alter, nicht nach Vergleich der Kennungen

**Die Annahme.** Nachtrag 3.1 a sagt: „Ein Start ohne `?share=` räumt alles auf,
was er beim Nachsehen vorfindet: dort ist keine eigene Navigation unterwegs."

**Warum sie nicht hält.** Das gilt nur, wenn es genau einen Client gibt. Das
Manifest hat **kein** `launch_handler`, also öffnet jede Freigabe und jeder
Dateistart einen eigenen Client. Während Fenster A auf seine Freigabe 1 wartet,
kann ein zweiter Client ohne Nummer starten — ein Neuladen eines offenen
Fensters, ein Dateistart über `launchQueue`, oder ein `?share=rejected`, das
eine fremde Seite sogar selbst auslösen kann. Dieser Client löscht alles, was er
vorfindet, also auch Eintrag 1. Fenster A meldet dann „konnte nicht übernommen
werden", und die Datei ist weg. Ein Link auf `/reader?share=999` löscht ebenso
jeden Eintrag mit kleinerer Nummer.

**Die Änderung.** Aufgeräumt wird nur, was **nachweislich alt** ist. Mit 4.1 gibt
es kein „kleiner" mehr, über das ein Start einen fremden Eintrag überhaupt
beanspruchen könnte; was bleibt, ist die Pflicht, nie abgeholte Freigaben
loszuwerden — das verlangt die Zusage der Datenschutzseite.

1. Der Worker legt zu jeder Freigabe den Ablagezeitpunkt in einen Header
   (`X-Pagebound-Shared-At`, Millisekunden). Die Systemuhr ist hier erlaubt: die
   Reproduzierbarkeitszusage gilt für das MCP-Paket und für erzeugte PDFs, nicht
   für einen Zwischenspeicher. Der Zeitstempel wandert nie in eine Ausgabe.
2. Ein Start räumt einen **fremden** Eintrag nur weg, wenn er **älter als 5
   Minuten** ist — unabhängig davon, ob der Start selbst eine Kennung trägt.
   Fünf Minuten sind länger als jeder Start braucht und kurz genug, dass die
   Zusage der Datenschutzseite stimmt.
3. Einen Eintrag ohne Zeitstempel (oder mit unlesbarem) behandelt er als alt.
   Solche gibt es nur aus einem Stand vor diesem Nachtrag — die alten
   Nummern-Schlüssel fallen damit beim ersten Start darunter.
4. Der eigene Eintrag wird weiterhin unabhängig vom Alter geholt.
5. Fehlt der Eintrag zur eigenen Kennung, bleibt es bei Nachtrag 3.1 b:
   gemeldet. Das gilt auch, wenn `caches.has()` nein sagt oder die Abholkette
   scheitert — vorher war beides ein stilles Nichts, und die Kennung blieb sogar
   in der Adresse stehen.
6. Die Datenschutzseite (`tools/gen-landing.mjs`, alle Sprachfassungen) und
   `SECURITY.md` werden im selben Commit nachgezogen: „ein späterer Start löscht
   sie" wird zu „ein späterer Start löscht sie, sobald sie älter als fünf
   Minuten ist". Eine Zusage, die den Code überholt, ist der Fehler, den dieses
   Projekt sich am wenigsten leisten kann.

## 4.3 Die Content-Length-Schranke entfällt — der Header kommt nicht an

**Die Zusage in `b727c01`.** „Größengrenze aus Content-Length VOR `formData()`:
vorher lief eine 1-GB-Datei vollständig durch den Service Worker."

**Die Messung.** Ein Sonden-Worker im echten Abbild, über die E2E-Strecke mit
echtem Chromium und einer echten Formular-Navigation auf `/share-target`. Der
Worker sieht **acht** Header:

```
accept, content-type, origin, sec-ch-ua, sec-ch-ua-mobile,
sec-ch-ua-platform, upgrade-insecure-requests, user-agent
```

`Content-Length` ist **nicht** dabei (`cl=NULL`). `Number(null)` ist `0`, die
Schranke greift also nie. Die Zusage ist unbelegt, und die beiden Tests dazu
konnten das nicht sehen, weil sie `headers.get` von Hand nachbauen.

**Die Änderung.** Die Schranke und ihre Zusage entfallen. Eine Zählung über den
Body als Stream wäre kein Gewinn: dafür muss der Body ebenso gelesen werden.
Geprüft wird weiter an `file.size` nach `formData()`, und das ist die Grenze, die
die App wirklich hat. Die Tests mit nachgebauten Headern entfallen mit ihr.

## 4.4 Das Vorlesen bekommt die Sprache des Dokuments

**Warum das hierher gehört und nicht in ein Bean.** Ohne Dokumentsprache hat das
Vorlesen nur schlechte Wahlmöglichkeiten, und ich habe sie in zwei Commits
hintereinander gegeneinander getauscht:

| Vorgehen | Schadet bei |
|---|---|
| App-Sprache (`5edb4ad`) | deutsche Oberfläche, englisches PDF → deutsche Stimme liest Englisch, und `u.lang = "de-DE"` ist eine **falsche Angabe** an die Engine |
| Vorgabe der Plattform (`b727c01`) | deutsche Oberfläche, deutsches PDF, englische Systemstimme → englische Stimme liest Deutsch |

Beides ist ein Raten über den Inhalt. Die Sprache steht im Dokument, und PDF.js
liefert sie an der Stelle, an der die Brücke heute schon den Titel holt.

**Die Änderung.**

1. `pdfjs-bridge.ts` liest in `loadPdf` zusätzlich `info.Language` (das ist
   `/Lang` aus dem Katalog) und gibt sie im Ergebnis mit.
2. Das Ergebnis-Objekt bekommt dafür ein Feld `language: string | null`. **Das
   berührt den Renderer-Vertrag** (`LoadResult` in der Brücke und das
   C#-Gegenstück in `PdfJsRenderer`) — deshalb steht es hier und wird nicht
   nebenbei gemacht. Ein zusätzliches, optionales Feld; keine Signatur ändert
   sich, keine Modulgrenze verschiebt sich.
3. `ReaderPane` gibt die Sprache als vierten Parameter an
   `pageboundTts.speak` weiter. Der Parameter `langHint` existiert seit
   `b727c01`.
4. Fehlt `/Lang` — bei den meisten PDFs fehlt es —, bleibt es bei der Vorgabe der
   Plattform. Das ist dann eine bewusste Entscheidung mit Begründung, kein
   stiller Tausch: nichts Falsches wird behauptet, und `u.lang` passt immer zur
   gewählten Stimme.
5. Bean `PDF-Tool-czeg` beschreibt genau diese Arbeit und wird damit erledigt.

**Nebenbefund aus derselben Messung, nicht Teil dieses Nachtrags.** `origin`
*ist* vorhanden. Anders als der Verweis lässt sich dieser Header nicht per
`referrerpolicy` unterdrücken; er wäre damit das bessere Signal für die
Herkunftsprüfung und könnte „Offen 2" schließen. Was Chrome einer Trusted Web
Activity als `origin` schickt, ist allerdings ungemessen — ohne diese Messung am
Gerät wäre es genau der Fehler, der in Nachtrag 3.2 schon einmal passiert ist.
Deshalb hier nur notiert, nicht gebaut.
