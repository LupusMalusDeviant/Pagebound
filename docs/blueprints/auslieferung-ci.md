# Auslieferung, Build & CI

## Zweck

Wie aus dem Quelltext ein auslieferbares Abbild wird und was dabei geprüft wird: TypeScript-Brücken mit esbuild bündeln, CSS mit Tailwind bauen, .NET nach `wwwroot` veröffentlichen, das Ganze in ein nginx-Abbild packen, das vorkomprimierte Dateien direkt ausliefert. Dazu der **Datenschutz-Wächter**, der die Kernzusage des Produkts maschinell durchsetzt, und die Prüfungen, die an einem echten Abbild laufen statt nur auf dem Entwicklerrechner.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Web/esbuild.mjs` | Je Brücke ein eigenes IIFE-Bündel mit eigenem globalen Namen (14 Einträge, `:36`–`:115`) |
| `Dockerfile` | Drei Stufen: Node baut JS und CSS (`:12`), .NET-SDK veröffentlicht (`:26`), Alpine mit nginx liefert aus (`:65`); `nginx -t` noch im Build (`:79`) |
| `infra/docker/nginx.conf` | Sicherheits-Header (`:31`–`:34`), CSP mit `connect-src 'self'` (`:35`), `brotli_static` und `gzip_static` (`:85`–`:86`), Service-Worker ohne Cache (`:106`, `:110`), `/share-target` (`:123`), Framework-Dateien unveränderlich für ein Jahr (`:137`) |
| `infra/docker/script-srcs.sh` | Listet die ausgelieferten Skriptquellen |
| `infra/docker/script-srcs.test.sh` | Prüft diese Liste gegen die Erwartung |
| `infra/docker/smoke.sh` | Prüft das **laufende** Abbild, nicht den Build; seit `5f5cae9` auch die ausgelieferten Digital Asset Links und das ausgelieferte Manifest gegen das Repo |
| `infra/deploy/docker-compose.yml`, `Caddyfile.pagebound`, `deploy.sh`, `README.md` | Betrieb hinter Caddy; Auslieferung bleibt manuell |
| `tools/privacy-check.mjs` | Der Datenschutz-Wächter (siehe unten) |
| `src/Pagebound.Infrastructure/Telemetry/NoOpTelemetryService.cs` | Die einzige Umsetzung von `ITelemetryService`: tut nichts, und das ist der Punkt |
| `.github/workflows/ci.yml` | Zwei Arbeiten: `build-and-test` (`:16`) und `E2E Tests (Playwright)` (`:148`) |
| `.github/workflows/publish-image.yml` | Zwei Arbeiten: `image` (`:21`) und `mcp-image` (`:59`), beide nach GHCR |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

Dieses Feature hat **keine ausgehende Kante** im geprüften Graph: es baut und prüft die anderen, ohne deren Symbole zu benutzen.

Umgekehrt gilt für jedes Feature: wer eine neue TypeScript-Brücke anlegt, muss sie in `esbuild.mjs` eintragen, sonst wird sie nicht gebündelt und fehlt im Abbild — eine Abhängigkeit, die das Skript nicht sieht, weil sie über Pfade statt Symbole läuft.

### Extern (Packages)

- `esbuild` — Bündelung der Brücken
- `tailwindcss` v4 — CSS
- Node 24 (Build), .NET-SDK 10 (Build), Alpine 3.22 mit `nginx` und `nginx-mod-http-brotli` (Betrieb)
- Playwright mit Chromium — nur in der CI, für die E2E-Prüfungen

## Öffentliche API / Interface

Die Kommandos, die zählen — und zwar **genau diese**, weil nur sie dasselbe prüfen wie die CI:

```bash
node tools/privacy-check.mjs                                  # Datenschutz-Wächter
npm run typecheck                                             # tsc --noEmit (unter src/Pagebound.Web)
npm test                                                      # node --test, die tests-js/*.test.mjs
npm run build                                                 # CSS + alle JS-Brücken
dotnet build Pagebound.slnx --configuration Release
dotnet test --filter "FullyQualifiedName!~E2ETests"
bash infra/docker/script-srcs.test.sh
bash infra/docker/smoke.sh http://localhost:5000              # am laufenden Abbild
npm run smoke                                                 # unter mcp/
```

**Was der Datenschutz-Wächter durchsetzt** (`tools/privacy-check.mjs:1`–`18`):

1. Keine `http(s)://`-Verweise auf **fremde** Hosts in `index.html`, `*.razor`, `*.ts` — mit einer ausdrücklichen Ausnahmeliste für die eigene Herkunft, XML- und PDF-Namensraum-Bezeichner und den Repo-Verweis.
2. Kein `<script src=…>` und kein `<link href=…>` auf eine fremde Herkunft in `index.html`.
3. `Program.cs` registriert weiterhin `NoOpTelemetryService` für `ITelemetryService`.
4. Jede Abweichung der Laufzeit-Abhängigkeiten in `package.json` von der geprüften Grundlinie wird als Prüfhinweis gemeldet.

Der Wächter ruft selbst **keine** externen Dienste auf und endet mit Code 1, wenn eine Regel bricht. Das ist die Stelle, an der die Produktzusage „alles lokal" nicht von einer Absicht, sondern von einem Befehl abhängt.

## Datenfluss / Call-Flow

1. **JS-Stufe** (`Dockerfile:12`): `npm ci`, dann `npm run build` — esbuild baut aus 14 Einträgen je ein Bündel mit eigenem globalen Namen (`esbuild.mjs:36` ff.), Tailwind baut `app.css`.
2. **.NET-Stufe** (`Dockerfile:26`): die gebauten JS- und CSS-Dateien werden in die Quelle kopiert (`:37`, `:43`–`:44`), dann `dotnet restore` und `dotnet publish`. Der Publish erzeugt auch die `.br`- und `.gz`-Fassungen.
3. **Laufzeit-Stufe** (`Dockerfile:65`): Alpine mit `nginx` und `nginx-mod-http-brotli`; die Konfiguration wird noch im Build mit `nginx -t` geprüft (`:79`), dann wird nur `wwwroot` ins Abbild kopiert (`:82`). Port 80 (`:84`). Im Abbild läuft **keine** .NET-Laufzeit — die App ist WASM.
4. **Ausliefern:** nginx liefert `.br` bzw. `.gz` direkt aus (`nginx.conf:85`–`86`); die Service-Worker-Dateien bekommen ausdrücklich **kein** Caching (`:106`, `:110`), die Framework-Dateien dagegen ein Jahr unveränderlich (`:137`). `/share-target` hat eine eigene Stelle (`:123`), damit die Freigabe-Navigation beim Einstieg landet.
5. **CI, Arbeit 1** (`ci.yml:16`): Datenschutz-Wächter (`:40`), Landingpages gegen den Generator (`:57`), `npm ci`, `typecheck` (`:107`), `build` (`:111`), `npm test` (`:117`), `dotnet build` (`:120`), Unit- und Komponententests mit Abdeckung (`:125`) und zusätzlich die Core-Tests im **invarianten Globalisierungsmodus**, also so wie im Browser (`:132`).
6. **CI, Arbeit 2** (`ci.yml:148`): baut das Auslieferungsabbild (`:194`), startet den Container (`:197`), startet einen **umleitenden Gegenspieler** (`:206`) — damit die Prüfung bemerkt, wenn die App doch nach draußen telefoniert —, raucht das Abbild ab (`:228`) und fährt die Playwright-Prüfungen dagegen.
7. **Veröffentlichen** (`publish-image.yml`): zwei Abbilder nach GHCR, eines für die PWA (`:21`), eines für den MCP-Server (`:59`). Push, Merge und Auslieferung bleiben Handarbeit.

## Die Falle, auf die `smoke.sh` ausgelegt ist

nginx beantwortet einen **fehlenden** Pfad wegen des SPA-Fallbacks (`try_files … /index.html`) mit HTTP 200 und `text/html`, nicht mit 404. Eine Prüfung, die nur den Status ansieht, hält jede fehlende Datei für vorhanden. Das ist die wiederkehrende Fehlerklasse dieses Projekts, und `smoke.sh` prüft deshalb durchweg Inhalt oder Content-Type:

- `src/Pagebound.Web/wwwroot/.well-known/assetlinks.json`, ausgeliefert unter `/.well-known/assetlinks.json`: Content-Type muss JSON sein und der Inhalt mit `[` beginnen. Fehlt die Datei im Abbild, bekommt Googles Prüfer eine gültige Antwort, die kein JSON ist, und die Android-App zeigt stumm eine Browser-Leiste.
- Das ausgelieferte `manifest.webmanifest` wird zeilenende-normalisiert gegen die Fassung im Repo verglichen. `manifest.test.mjs` prüft nur die Datei im Arbeitsbaum, PWABuilder und Bubblewrap bauen die Store-Pakete aber aus dem ausgelieferten Manifest. Weicht es ab, entstünde ein Paket ohne PDF-Dateihandler und ohne Teilen-Ziel, ohne dass Typ, Bilder oder Status etwas gemeldet hätten.
- Die Datenschutzseiten prüft `smoke.sh` seit `37f718b` je auf ihre Überschrift und ihr `lang`-Attribut.

## Offene Fragen / TODOs

- Das Abbild wird in der CI **zweimal** gebaut (einmal in `ci.yml:194` für E2E, einmal in `publish-image.yml`). Kostet Laufzeit, kein Korrektheitsproblem.
- Der Start des Containers in der E2E-Arbeit wartet mit einem Zeitlimit auf die URL. Das ist der wahrscheinlichste Flattermacher dieser Werkzeugkette — wird der Lauf dort rot, ist zuerst die Wartezeit zu prüfen und nicht der Code.
- `tests/Pagebound.Web.Tests` enthält genau eine Datei, `Reader/SignaturePadTests.cs` (11 Prüfungen, seit `c9a567c`). Die rund 11000 Zeilen der Oberflächenschicht prüft die CI darüber hinaus nur über die `tests-js`-Dateien und die E2E-Prüfungen. Für Reader, Designer und die PDF-Werkzeuge gibt es keine .NET-Komponententests. (`CLAUDE.md` nennt das Projekt an dieser Stelle noch eine „leere Hülle"; das stimmt seit `c9a567c` nicht mehr.)
