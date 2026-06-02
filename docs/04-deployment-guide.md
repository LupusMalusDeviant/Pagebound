# Deployment-Guide: Pagebound

| Feld | Wert |
|---|---|
| Projekt | **Pagebound** |
| Dokumenttyp | Deployment-Guide |
| Version | 1.0 |
| Stand | 2026-05-30 |

---

## Überblick

Pagebound ist eine rein statische **Blazor WebAssembly**-Anwendung (kein Server-Backend). Der Build-Prozess produziert eine Menge statischer Dateien (`index.html`, WASM-Bundle, JS-Bridges, CSS), die von einem beliebigen statischen Webserver oder CDN ausgeliefert werden können.

**Deployment-Optionen im Überblick:**

| Option | Einsatzszenario | Aufwand |
|---|---|---|
| Docker (nginx) | Produktion, Self-Hosting | niedrig |
| `dotnet run` | Lokale Entwicklung | minimal |
| `serve` / statische Dateien | Staging, lokale Vorschau | minimal |
| GitHub Pages | Open-Source-Hosting | mittel |
| Beliebiger Webserver (nginx, Caddy) | Produktion ohne Docker | mittel |

---

## Voraussetzungen

### Für den Build

| Werkzeug | Version | Zweck |
|---|---|---|
| .NET SDK | 10.0+ | Blazor WASM kompilieren |
| Node.js | 20+ | Tailwind CSS + JS-Bridges bauen |
| npm | 10+ | JS-Paketmanagement |

### Für Docker-Deployment

| Werkzeug | Version |
|---|---|
| Docker | 24+ |
| Docker Compose *(optional)* | 2.x |

---

## 1. Docker-Deployment (empfohlen für Produktion)

Das Repo enthält einen mehrstufigen Dockerfile (`Dockerfile` im Root) mit drei Stages:

1. **jsbuild** (Node 20 Alpine) – baut Tailwind-CSS und die JS-Interop-Bridges
2. **dotnetbuild** (mcr.microsoft.com/dotnet/sdk:10.0) – publiziert das Blazor WASM
3. **runtime** (nginx:alpine) – liefert die statischen Dateien aus

### Build & Start (Einzeiler)

```bash
# Im Repo-Root:
docker build -t pagebound:latest -f Dockerfile .
docker run --rm -p 8081:80 pagebound:latest
```

Anwendung erreichbar unter **http://localhost:8081**.

### Mit Tag und Bind-Mount für nginx-Config

```bash
docker build -t pagebound:1.0 .
docker run -d \
  --name pagebound \
  -p 80:80 \
  --restart unless-stopped \
  pagebound:1.0
```

### Docker Compose (empfohlen für persistente Setups)

```yaml
# docker-compose.yml
services:
  pagebound:
    build: .
    image: pagebound:latest
    ports:
      - "80:80"
    restart: unless-stopped
```

```bash
docker compose up -d
docker compose logs -f pagebound
```

### nginx-Konfiguration

Die eingebettete nginx-Konfiguration (`infra/docker/nginx.conf`) stellt sicher:
- **SPA-Fallback:** alle unbekannten Routen liefern `index.html` (Blazor-Router übernimmt)
- **gzip:** Komprimierung für WASM, CSS, JS, JSON — reduziert das ~3 MB .NET-Runtime-Bundle erheblich
- **Long Cache:** `/_framework/`-Assets werden mit `max-age=31536000, immutable` gecacht (fingerprinted)
- **Service-Worker-Invalidierung:** `service-worker.js` bekommt `no-cache`, damit Updates sofort ankommen
- **MIME-Typen:** `.wasm`, `.dll`, `.pdb` sind korrekt deklariert (Blazor-Anforderung)

Für eigene nginx-Instanzen kann diese Konfiguration direkt aus `infra/docker/nginx.conf` übernommen werden.

---

## 2. Lokale Entwicklung (`dotnet run`)

```bash
# Erstmalig: JS-Abhängigkeiten installieren und bauen
cd src/Pagebound.Web
npm install
npm run build       # Tailwind CSS + JS-Bridges kompilieren

# Anwendung starten
dotnet run          # oder: dotnet watch run
```

Der Dev-Server startet standardmäßig auf **https://localhost:5001** und **http://localhost:5000**.

`dotnet watch run` aktiviert Hot-Reload für Razor-Dateien und C#-Code.

> **Hinweis:** Für CSS-Änderungen muss `npm run build:css` (oder `npm run watch`) separat laufen,
> da Tailwind ein eigener Prozess ist.

---

## 3. Statische Dateien (serve, Caddy, Apache)

### Build-Artefakt erzeugen

```bash
cd src/Pagebound.Web
npm install
npm run build
cd ../..
dotnet publish src/Pagebound.Web \
  --configuration Release \
  --output ./dist
```

Die fertigen statischen Dateien liegen danach unter `./dist/wwwroot/`.

### Ausliefern mit `serve`

```bash
npm install -g serve
serve -s ./dist/wwwroot -l 3000
```

### Ausliefern mit Caddy

```caddy
# Caddyfile
:80 {
    root * /var/www/pagebound
    encode gzip
    try_files {path} /index.html
    file_server
}
```

### Ausliefern mit Apache

```apache
# .htaccess im wwwroot-Verzeichnis
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [QSA,L]
```

> **Wichtig:** Alle drei Server müssen den **SPA-Fallback** konfiguriert haben (unbekannte Pfade → `index.html`), sonst schlägt das direkte Aufrufen von Deeplinks fehl.

---

## 4. GitHub Pages

Pagebound kann direkt aus dem `gh-pages`-Branch bereitgestellt werden. Da GitHub Pages keinen Server-seitigen SPA-Fallback unterstützt, wird ein 404-Workaround benötigt.

### Voraussetzungen

- GitHub-Repository muss GitHub Pages aktiviert haben (Settings → Pages → Source: `gh-pages`)
- `base` in `index.html` muss auf den Repository-Namen gesetzt werden, falls das Repo nicht auf einer Custom Domain liegt

### 404-Workaround für SPA

GitHub Pages liefert bei unbekannten Pfaden `404.html`. Kopiere `index.html` nach `404.html`:

```bash
cp ./dist/wwwroot/index.html ./dist/wwwroot/404.html
```

Dieser Workaround lässt Deep-Links funktionieren, indem die Browser-History per JavaScript korrigiert wird (Standardmuster für GitHub Pages + SPA).

---

## 5. CI/CD-Pipeline

Die CI/CD-Pipeline läuft via **GitHub Actions** (`.github/workflows/ci.yml`) und hat drei Jobs:

### `build-and-test` (läuft bei jedem Push/PR auf `main`)

1. .NET 10 + Node 20 einrichten
2. `dotnet restore` + `npm ci`
3. Tailwind CSS + JS-Bridges bauen (`npm run build`)
4. `dotnet build --configuration Release`
5. `dotnet test` mit XPlat Code Coverage
6. Testergebnisse (`.trx`) und Coverage (`cobertura.xml`) als Artefakte hochladen

### `e2e-tests` (abhängig von `build-and-test`)

1. Blazor WASM publizieren (`dotnet publish`)
2. `serve` auf Port 5000 starten
3. Playwright-Browser installieren (`playwright.ps1 install --with-deps chromium`)
4. E2E-Tests ausführen (`dotnet test tests/Pagebound.E2ETests`)
5. Bei Fehler: Playwright-Report als Artefakt hochladen

### `lighthouse` (abhängig von `build-and-test`)

1. Blazor WASM publizieren
2. Lighthouse CI (lhci) ausführen — prüft Accessibility-Score ≥ 90

### Manuelle Bereitstellung nach CI

Die Pipeline deployt nicht automatisch (kein CD konfiguriert). Nach einem grünen Build auf `main` kann das Deployment manuell per Docker oder dem Artefakt aus dem CI-Job erfolgen.

---

## 6. Umgebungsvariablen und Konfiguration

Pagebound ist eine rein clientseitige Anwendung ohne Backend — es gibt **keine Umgebungsvariablen** zur Laufzeit. Alle Konfiguration findet beim Build statt:

| Parameter | Wo konfigurieren | Standard |
|---|---|---|
| Blazor-Basis-URL | `<base href="/">` in `index.html` | `/` |
| API-Basis (nicht vorhanden) | n/a — kein Backend | — |
| Tesseract-OCR-Assets | self-hosted: `wwwroot/tesseract/` (Worker + WASM-Core), `wwwroot/tessdata/` (eng/deu) | lokal, kein CDN |

Die OCR-Assets werden **mit ausgeliefert** (Pfade fest in `wwwroot/js/ocr-bridge.ts`). Es gibt **keine externe URL**, die angepasst werden müsste — OCR läuft auch ohne Internetzugang vollständig offline.

---

## 7. TLS / HTTPS

### Docker + nginx

Für TLS wird empfohlen, einen vorgelagerten Reverse-Proxy (Traefik, Caddy, nginx-Proxy-Manager) einzusetzen:

```yaml
# docker-compose.yml mit Traefik
services:
  pagebound:
    build: .
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pagebound.rule=Host(`pagebound.example.com`)"
      - "traefik.http.routers.pagebound.entrypoints=websecure"
      - "traefik.http.routers.pagebound.tls.certresolver=letsencrypt"
```

### Caddy (automatisches HTTPS)

Caddy übernimmt TLS automatisch via Let's Encrypt:

```caddy
pagebound.example.com {
    root * /var/www/pagebound
    encode gzip
    try_files {path} /index.html
    file_server
}
```

---

## 8. Ressourcenbedarf

Pagebound ist eine statische App ohne Backend — der Server liefert lediglich Dateien aus.

| Ressource | Minimum | Empfohlen |
|---|---|---|
| RAM (Container) | 32 MB | 64 MB |
| CPU | 0.1 vCPU | 0.25 vCPU |
| Speicher (Deploy-Image) | ~150 MB | — |
| Erster Seitenaufruf (Download) | ~3 MB (gzip) | — |

---

## 9. Troubleshooting

### Blazor lädt nicht / `dotnet.wasm` 404

Ursache: Der Webserver kennt den MIME-Typ `application/wasm` nicht.  
Lösung: MIME-Typ in der Serverkonfiguration ergänzen (siehe nginx-Config-Abschnitt oben).

### Deep-Links schlagen fehl (404 bei direktem Aufruf)

Ursache: Kein SPA-Fallback konfiguriert.  
Lösung: `try_files $uri $uri/ /index.html;` in nginx; entsprechendes Äquivalent bei anderen Servern.

### Service Worker veralteter Stand nach Update

Ursache: Browser hat `service-worker.js` gecacht.  
Lösung: Cache-Control-Header für `service-worker.js` auf `no-cache` setzen (in der nginx-Config bereits so konfiguriert). Im Browser: DevTools → Application → Service Workers → „Update on reload".

### Tesseract.js lädt Sprachmodelle nicht

Ursache: Die self-hosted OCR-Assets fehlen im Deploy oder werden mit falschem MIME-Typ/Encoding ausgeliefert.  
Lösung: Sicherstellen, dass `wwwroot/tesseract/` (Worker + `*.wasm`/`*.wasm.js`) und `wwwroot/tessdata/` (`eng.traineddata.gz`, `deu.traineddata.gz`) mit ausgeliefert werden. `*.wasm` als `application/wasm` servieren und die `*.traineddata.gz` **nicht** zusätzlich serverseitig gzippen / mit `Content-Encoding: gzip` ausliefern (Tesseract entpackt sie selbst). Die mitgelieferte `nginx.conf` erfüllt das bereits.

### Docker-Build schlägt fehl: „npm: not found"

Ursache: Multi-Stage-Build braucht Node im ersten Stage.  
Lösung: Sicherstellen, dass `Dockerfile` aus dem **Repo-Root** gebaut wird (`docker build -f Dockerfile .`), nicht aus einem Unterverzeichnis.
