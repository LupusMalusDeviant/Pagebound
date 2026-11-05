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

1. **Brotli statt gzip ausliefern.** Der Publish erzeugt schon `.br`-Dateien.
   Für genau die 210 `_framework`-Dateien des Kaltstarts: **10,82 MB gzip
   (gemessen) gegenüber 8,21 MB als `.br` (Dateigrößen) = −24 %**, bei 4G grob
   −2,3 s. nginx:alpine hat kein `brotli_static`; Alternativen: Brotli-Modul
   ins Image, oder Caddy (davor) komprimieren lassen (`encode zstd gzip`) und
   nginx' gzip abschalten.
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
