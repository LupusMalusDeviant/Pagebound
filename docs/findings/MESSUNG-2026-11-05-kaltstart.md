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
2. **Nicht benötigte Assemblies nicht laden.** `System.Private.Xml`,
   `System.Data.Common`, `System.Text.Encoding.CodePages`,
   `DataContractSerialization` landen ohne Trimming im Startpaket (~2,3 MB gzip).
   Entweder gezieltes Trimming mit gepflegten TrimmerRoots (siehe Kommentar in
   `Pagebound.Web.csproj`, warum es aus ist) oder Lazy-Loading
   (`BlazorWebAssemblyLazyLoad`) für die Features, die sie brauchen.
3. **ICU.** `InvariantGlobalization` würde `icudt_*.dat` sparen, ändert aber
   Sortierung/Formatierung (DE/EN) — nur mit Tests der Formatierungen.
4. **Bridges bei Bedarf laden.** Alle 14 Bridges (~1,5 MB gzip) werden vor dem
   Blazor-Skript synchron geladen, auch wenn z. B. Designer/OCR/Signatur nie
   gebraucht werden.

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
