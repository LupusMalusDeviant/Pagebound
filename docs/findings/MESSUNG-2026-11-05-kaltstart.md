# Messung: Kaltstart der PWA (2026-11-05)

Bean: `PDF-Tool-cld1`. Anlass: Vergleich mit einem reinen JS-Werkzeug (zwei
CDN-Skripte, sofort bedienbar). Frage: Wie lange wartet jemand beim ersten
Besuch, bevor er mit Pagebound etwas tun kann?

## Aufbau

- `dotnet publish src/Pagebound.Web -c Release` — wie das Docker-Image:
  ohne AOT, ohne Trimming (`PublishTrimmed=false`), ohne `wasm-tools`.
- Ausgeliefert von einem kleinen Node-Server, der `infra/docker/nginx.conf`
  nachbildet: `try_files`, dieselbe CSP, **gzip Stufe 6 für dieselben MIME-Typen**
  (nginx liefert die vorkomprimierten `.br`/`.gz` des Publish nicht aus).
- Chromium (Playwright), **frischer Kontext** pro Lauf: kein HTTP-Cache, Service
  Worker blockiert — also wirklich der erste Besuch. Netz per CDP gedrosselt.
- Ziel-URL `/reader`. Gemessen ab Navigationsstart:
  - **FCP** — erster sichtbarer Inhalt
  - **Drop-Zone bedienbar** — `#pb-boot-drop` sichtbar
  - **Blazor bereit** — Boot-Bildschirm durch die App ersetzt

## Ergebnis

| Netz | FCP | Drop-Zone bedienbar | Blazor bereit | übertragen | Requests |
|---|---|---|---|---|---|
| 4G (9 Mbit/s, 60 ms) — vorher | 0,24 s | — | **12,3 s** | 12,4 MB (31,1 MB roh) | 232 |
| 4G (9 Mbit/s, 60 ms) — nachher | 0,25 s | **0,22 s** | 12,2 s | 12,4 MB | 233 |
| DSL (25 Mbit/s, 20 ms) — vorher | 0,13 s | — | **5,0 s** | 12,4 MB | 232 |
| DSL (25 Mbit/s, 20 ms) — nachher | 0,16 s | **0,10 s** | 5,0 s | 12,4 MB | 233 |

Größte Posten über die Leitung (gzip, 4G-Lauf):

| MB | Datei |
|---|---|
| 1,58 | `System.Private.CoreLib.wasm` |
| 1,20 | `dotnet.native.wasm` |
| 1,07 | `System.Private.Xml.wasm` |
| 0,69 | `js/pdf-manipulator-bridge.js` |
| 0,55 | `icudt_EFIGS.dat` (nicht gzip-komprimiert: `application/octet-stream`) |
| 0,52 | `System.Text.Encoding.CodePages.wasm` |
| 0,38 | `System.Data.Common.wasm` |
| 0,31 | `System.Private.DataContractSerialization.wasm` |

## Was geändert wurde (und was nicht)

**Geändert:** Der Splash ist jetzt ein Boot-Bildschirm (`wwwroot/js/boot.js`,
reines JS, ~5 KB, läuft vor allen Bridges): echter Ladefortschritt aus
`--blazor-load-percentage` und eine Drop-Zone. Eine dort abgelegte oder
ausgewählte PDF wird geprüft (MIME + `%PDF-` in den ersten 1024 Bytes, max.
100 MB wie der Reader), die Route auf `/reader` gestellt und nach dem Boot
geöffnet (`ReaderPage` → `pageboundBoot.takePendingFile`, Uint8Array → `byte[]`,
kein base64). Ab ~0,1–0,2 s kann man also etwas tun, statt 5–12 s zu warten.

**Nicht geändert — ehrlich:** Die Wartezeit bis zur fertigen App und die
übertragene Menge sind **gleich geblieben**. Es ist eine Verbesserung der
gefühlten Wartezeit, nicht der Ladezeit.

## Hebel für echte Einsparungen (nicht umgesetzt, je eigener Bean)

1. ~~**Brotli statt gzip ausliefern.**~~ Umgesetzt, siehe Nachtrag unten.
2. ~~**Nicht benötigte Assemblies nicht laden.**~~ Umgesetzt (Trimming `partial`), siehe Nachtrag unten.
3. **ICU.** `InvariantGlobalization` würde `icudt_*.dat` sparen, ändert aber
   Sortierung/Formatierung (DE/EN) — nur mit Tests der Formatierungen.
4. ~~**Bridges bei Bedarf laden.**~~ Umgesetzt für die drei großen, siehe Nachtrag unten.

## Nachtrag: Brotli (Bean `PDF-Tool-br01`)

### Was Produktion tatsächlich ausliefert (an der Live-Seite gemessen)

Die Messung oben bildete nginx mit gzip nach. Die Live-Seite zeigt etwas
anderes: **nginx hat hinter Caddy gar nicht komprimiert.** Caddy setzt `Via`
zum Upstream, und nginx' Standard `gzip_proxied off` schaltet dann gzip ab;
Caddy (`encode zstd gzip`) packt jede Antwort selbst neu.

| 210 Framework-Dateien des Kaltstarts | übertragen |
|---|---|
| roh | 27,39 MB |
| Produktion, Chrome/Firefox (zstd von Caddy) | 11,09 MB |
| Produktion, Safari (gzip von Caddy) | 11,22 MB |
| `.br` aus dem Publish | **8,21 MB (−26 %)** |

Ausreißer: `icudt_EFIGS.dat` kam unkomprimiert (0,55 MB) — als `.br` 0,14 MB.

### Umsetzung

- `nginx.conf`: `brotli_static on` + `gzip_static on` liefern die vom Publish
  erzeugten `.br`/`.gz` direkt aus (keine CPU pro Abruf); `gzip_proxied any`
  damit auch hinter Caddy; `font/woff(2)` aus `gzip_types` (gzip machte sie größer).
- `Dockerfile`: Laufzeit-Stufe auf `alpine:3.22` + `nginx nginx-mod-http-brotli`
  (das offizielle `nginx:alpine` hat kein Brotli-Modul). Alpine-Fakten aus
  aports 3.22-stable: Modul lädt sich über `/etc/nginx/modules/10_http_brotli.conf`,
  Sites aus `/etc/nginx/http.d/`, `/run/nginx` legt das Paket nicht an.
- `infra/docker/smoke.sh` + CI-Job „Docker image smoke": baut das Image und
  prüft Kompression (mit und ohne `Via`), Typen, CSP, Landingpages, SPA-Fallback.

### Nachmessung (lokale Kette: Chrome → Caddy/TLS → nginx 1.24 + ngx_brotli → Publish)

| Netz | Blazor bereit vorher* | nachher | übertragen nachher |
|---|---|---|---|
| 4G (9 Mbit/s, 60 ms) | 12,2 s | **9,7 s** | 9,45 MB (Framework 8,22 MB, alle 210 als br) |
| DSL (25 Mbit/s, 20 ms) | 5,0 s | **4,3 s** | 9,45 MB |

\* „vorher" ist die gzip-Messung von oben (Framework 10,82 MB) — nahe an
Produktion (11,09 MB). Die lokale Kette mit der alten Konfiguration taugt nicht
als Vergleich: Ubuntus Caddy 2.6.2 komprimiert wasm gar nicht (27 MB).

Service Worker: installiert vollständig (244/244 cachebare Assets); jede Datei
besteht die Integritätsprüfung, br ist für ihn transparent.

### Grenzen

- Das Alpine-Image selbst konnte hier nicht gebaut werden (kein Docker-Daemon);
  das prüft erst der neue CI-Job.
- Dass die Produktions-Caddy-Version vorhandenes `Content-Encoding: br`
  unverändert durchreicht, ist mit Caddy 2.6.2 belegt, mit der Live-Version erst
  nach dem Deploy (`bash infra/docker/smoke.sh https://pagebound.app.lupusmalus.dev`).

## Nachtrag: Trimming (Bean `PDF-Tool-asm1`)

`System.Private.Xml`, `System.Data.Common`, `System.Text.Encoding.CodePages`,
`DataContractSerialization` werden von **nichts** in Pagebound benutzt (kein
Code, kein Paket). Sie kamen nur mit, weil ohne Trimming 205 Framework-
Assemblies ausgeliefert und beim Start alle geladen wurden. Statt Lazy-Loading
daher `PublishTrimmed=true` mit `TrimMode=partial`: gekürzt werden nur
Framework-Assemblies; unsere eigenen (mit allen per System.Text.Json
serialisierten Typen) bleiben vollständig.

| Kaltstart, Kette mit Brotli | ungekürzt | gekürzt (`partial`) |
|---|---|---|
| wasm-Dateien | 205 | **49** |
| `_framework` gesamt (.br) | 8,68 MB | **3,43 MB** |
| übertragen | 9,45 MB | **4,19 MB** |
| Blazor bereit, 4G | 10,2 s | **5,0 s** |
| Blazor bereit, DSL | 4,4 s | **2,4 s** |

Gegenüber dem Ausgangspunkt dieser Messreihe (12,4 MB, 12,2 s bei 4G) ist der
Kaltstart damit etwa halb so schnell **und** ein Drittel so schwer.

**Funktionsnachweis:** sieben Abläufe über alle reflexionsbasierten JSON-Pfade
(Routen, Sprachwechsel, Stift + getippte Signatur mit Integritäts-Hash, Sidecar-
Export, IndexedDB-Round-Trip über die Library, Sidecar-Import, Designer-JSON),
gegen beide Builds: Ergebnisse **identisch**, keine Konsolenfehler. Gegenprobe
mit `TrimMode=full`: App stürzt beim ersten Render ab (`CtorNotLocated`).
Dauerhaft abgesichert durch die E2E-Tests `JsonRoundTripTests` (Gegenprobe:
gezielt kaputtes Sidecar-Parsen bzw. IndexedDB-Lesen → genau die betroffenen
Tests scheitern).

## Nachtrag: Bridges bei Bedarf (Bean `PDF-Tool-brg1`)

Von 14 Bridges (944 KB br) machen drei 94 % aus: `pdf-manipulator` (543 KB),
`sign` (230 KB), `pdfjs` (119 KB). Sie lädt jetzt `wwwroot/js/lazy-bridges.js`
erst beim ersten Aufruf (Platzhalter mit demselben globalen Namen; die C#-Aufrufe
bleiben unverändert) und nach dem App-Start im Leerlauf vorab.
`mind` und `wysiwyg` bleiben bewusst sofort geladen: `wysiwyg-editor` ruft
`pageboundMind.renderMindmapDataUrl` **synchron** auf — ein Platzhalter lieferte
dort ein Promise statt eines Strings.

| `/reader`, Kette mit Brotli + Trimming | alles sofort | bei Bedarf |
|---|---|---|
| Blazor bereit, 4G | 4,9 s | **3,9 s** |
| Blazor bereit, DSL | 2,37 s | **1,98 s** |
| bis „bereit" übertragen (4G) | 4,19 MB | **3,42 MB** |

Sieben Funktionsabläufe (wie beim Trimming) identisch, keine Konsolenfehler.
E2E `LazyBridgeTests`: Lade-Mechanik mit gefälschten, verzögerten Bridges
(inkl. Ladefehler + erneuter Versuch), „nicht vor dem App-Start" (Zeitpunkte im
Browser gemessen — Gegenprobe: sofortiges Vorladen wird mit „1161 ms VOR dem
App-Start" erkannt), Einbrennen über die nachgeladene Manipulator-Bridge.

**Stand der ganzen Reihe (4G, kalter Cache):** 12,2 s / 12,4 MB → 3,9 s / 3,4 MB.
