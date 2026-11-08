# Datei-Eintritt (PWA)

## Zweck

Ein Eintritt für alle Wege, auf denen eine PDF-Datei in die App kommt: Drop auf den Boot-Bildschirm, Dateiauswahl, Doppelklick im Betriebssystem (`file_handlers`) und Teilen aus einer anderen App (`share_target`). Alle Wege laufen durch dieselbe Prüfung (Endung, MIME, Magic Bytes) und dieselbe Übergabe an den Reader, damit eine Datei nicht je nach Herkunft anders behandelt wird.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/wwwroot/js/boot.js` | Annahme und Prüfung der Datei, Sortier-Sperre, Übergabe an Blazor (`pageboundBoot`, `boot.js:94`); Abholen einer geteilten Datei aus dem Cache (`pickUpShared`, `boot.js:460`) |
| `src/Pagebound.Web/wwwroot/service-worker.published.js` | Nimmt `POST /share-target` an, legt die Datei unter einer gezogenen Kennung im Cache `pb-share` ab und leitet auf den Reader (`onShareTarget`, `:214`) |
| `src/Pagebound.Web/wwwroot/service-worker.js` | Entwicklungs-Worker (kein Offline-Cache) |
| `src/Pagebound.Web/wwwroot/manifest.webmanifest` | `file_handlers` (`:14`) und `share_target` (`:28`); **kein** `launch_handler`, deshalb öffnet jede Freigabe ihren eigenen Client |
| `src/Pagebound.Web/tests-js/boot.test.mjs` | 47 Prüfungen zur Annahme, zur Sperre und zum Aufräumen fremder Freigaben |
| `src/Pagebound.Web/tests-js/service-worker.test.mjs` | 26 Prüfungen zu Form und Einmaligkeit der Kennung, Zeitstempel, Größengrenze |
| `src/Pagebound.Web/tests-js/manifest.test.mjs` | Prüft das Manifest gegen die Zusagen (Handler, Teilen-Ziel, Icons) |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Interop-Hilfen (UI)** (Querschnitt, via `load`): `boot.js` liest die UI-Feineinstellungen, um den Boot-Bildschirm passend zu zeichnen — `src/Pagebound.Web/wwwroot/js/boot.js:581`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).

Die Übergabe an den Reader läuft **nicht** über eine Kante im geprüften Graph, sondern über das globale `window.pageboundBoot`, das `ReaderPage` per JS-Interop abfragt (`boot.js:11` benennt diesen Weg im Kopfkommentar).

### Extern (Packages)

- Keine. Alles sind Browser-APIs: Service Worker, Cache Storage, `File`, `FileReader`, `crypto.getRandomValues`.

## Öffentliche API / Interface

```js
// boot.js:94 — das Einzige, was andere Schichten sehen
window.pageboundBoot = {
  takePendingFile(), // Datei + Name abholen (einmalig), oder null
  pendingFileName(), // Name ohne Abholen
  offer(file),       // aus Blazor: Datei anbieten
  freigeben(),       // Haltegriff auf die Datei lösen
  // ...
};
```

Eintrittspunkte am Rand der App:

- `POST /share-target` — vom Betriebssystem beim Teilen; nginx liefert dafür den Einstieg aus (`infra/docker/nginx.conf:123`).
- `GET /reader?share=<Kennung>` — die Weiterleitung des Workers; die Kennung ist eine UUID oder 32 Hex-Zeichen (`boot.js:435` prüft genau diese zwei Formen).
- `file_handlers` im Manifest (`manifest.webmanifest:14`) — Start mit `launchQueue`.

## Datenfluss / Call-Flow

**Drop oder Auswahl**

1. Der Nutzer legt eine Datei auf `#pb-boot-drop` oder wählt sie über `#pb-boot-file` (`index.html:84`–`85`).
2. `accept()` prüft Endung und MIME (`boot.js:172`), `sniff()` liest die ersten Bytes und verlangt `%PDF` (`boot.js:166`, `headerKind` `:156`).
3. `withSortLock()` serialisiert die Annahme, damit zwei schnell aufeinander folgende Dateien sich nicht überholen (`boot.js:247`).
4. Die geprüfte Datei liegt als Haltegriff bereit; `ReaderPage` holt sie per `takePendingFile` ab.

**Teilen aus einer anderen App**

1. Das Betriebssystem schickt `POST /share-target` an den Service Worker.
2. `shareFromElsewhere()` prüft die Herkunft der Anfrage (`service-worker.published.js:160`).
3. `onShareTarget()` liest das Formular, prüft `file.size` gegen `shareMaxBytes` = 100 MB (`:47`, Prüfung in `:214` ff.) und legt die Datei im Cache `pb-share` (`:33`) unter `/__pb-share/<Kennung>` (`:34`) ab, mit `X-Pagebound-Filename` (`:35`) und `X-Pagebound-Shared-At` (`:44`).
4. Die Kennung wird **gezogen, nicht gezählt**: `crypto.randomUUID()`, als Rückfall 16 Zufallsbytes als Hex (`neueKennung`, `:206`). Damit ist sie nicht erratbar, und ein Aufruf mit fremder Kennung kann keine andere Freigabe treffen.
5. Der Worker leitet auf `/reader?share=<Kennung>`.
6. `pickUpShared()` im neuen Client holt genau den Eintrag zu seiner Kennung (`boot.js:460`, Pfadvergleich über `meinPfad` `:463`).
7. Fremde Einträge löscht der Start nur, wenn sie **älter als fünf Minuten** sind (`SHARE_ORPHAN_MS`, `boot.js:71`; Prüfung `shareIsOrphan` `:450`). Ein Eintrag ohne lesbaren Zeitstempel gilt als alt; scheitert das Nachsehen, wird nichts gelöscht.

## Offene Fragen / TODOs

- **Ungemessen:** welche Herkunft Edge einer Installation aus dem Microsoft Store beim Teilen schickt. Für Android-TWA ist gemessen, dass die Herkunft `android-app://<pkg>/` ist und `URL.origin` daraus die Zeichenkette `"null"` macht; für Edge fehlt die Messung am Gerät. Steht als Nebenbefund in `docs/contracts/datei-eintritt.md`, Nachtrag 4.
- Chromium übergibt dem Worker bei einer Freigabe **kein** `Content-Length` (gemessen: acht Header, `Content-Length` nicht dabei). Eine frühere Schranke darauf war wirkungslos und ist entfernt; geprüft wird an `file.size`.
