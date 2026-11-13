# =============================================================================
# Pagebound — Multi-stage Dockerfile
# ----------------------------------------------------------------------------
# Stage 1: Build CSS (Tailwind) + JS-Interop bridges (esbuild) with Node 24
# Stage 2: dotnet publish Blazor WASM with .NET 10 SDK
# Stage 3: Static hosting via nginx (Alpine-Paket, mit Brotli-Modul)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Node — build CSS and JS bridges
# -----------------------------------------------------------------------------
FROM node:24-alpine AS jsbuild
WORKDIR /web

# Copy lockfile first for layer caching
COPY src/Pagebound.Web/package.json src/Pagebound.Web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the Web project (esbuild.mjs, tsconfig.json, source files)
COPY src/Pagebound.Web/ ./
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: .NET — restore & publish Blazor WASM
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS dotnetbuild
WORKDIR /src

# Copy source projects (Pagebound.Web references Core + Infrastructure)
COPY src/ /src/

# Drop the freshly built CSS + JS bridges into the layout the .csproj expects,
# replacing the git-ignored source-tree outputs. WICHTIG: ALLE Bundles aus dem
# jsbuild-Stage übernehmen — im sauberen CI-Checkout sind die .js nicht
# eingecheckt, sonst fehlen Manipulator/OCR/Files/Split/Workspace/Tweaks und die
# App ist halb tot (kein Theme, keine PDF-Ops, keine OCR …).
COPY --from=jsbuild /web/wwwroot/css/app.css                  /src/Pagebound.Web/wwwroot/css/app.css
# ALLE gebauten JS-Bundles per Glob übernehmen statt einzeln aufzulisten — so
# kann keine neu hinzugefügte Bridge mehr vergessen werden (tts-bridge.js fehlte
# in der Einzelliste und wurde als text/html ausgeliefert). *.js erfasst die
# gebündelten Bridges, nicht die .ts-Quellen oder .map-Dateien; die .mjs-Worker-
# Datei matcht *.js nicht und wird separat kopiert.
COPY --from=jsbuild /web/wwwroot/js/*.js                      /src/Pagebound.Web/wwwroot/js/
COPY --from=jsbuild /web/wwwroot/js/pdf.worker.min.mjs        /src/Pagebound.Web/wwwroot/js/pdf.worker.min.mjs

WORKDIR /src/Pagebound.Web
RUN dotnet restore Pagebound.Web.csproj
RUN dotnet publish Pagebound.Web.csproj \
    --configuration Release \
    --no-restore \
    --output /publish \
    /p:RunAOTCompilation=false

# -----------------------------------------------------------------------------
# Stage 3: nginx — serve the static publish output
# -----------------------------------------------------------------------------
# Alpines eigenes nginx statt nginx:alpine von nginx.org: nur dort gibt es das
# Brotli-Modul passend zur nginx-Version als Paket (nginx-mod-http-brotli, aus
# google/ngx_brotli). Damit liefert nginx die .br-Dateien aus dem Publish direkt
# aus (brotli_static, siehe nginx.conf) — Bean PDF-Tool-br01.
# Fakten aus aports 3.22-stable: das Modul lädt sich selbst über
# /etc/nginx/modules/10_http_brotli.conf; Sites kommen aus /etc/nginx/http.d/*.conf;
# nginx.post-install legt dort default.conf (404-default_server) und /run/nginx an.
# Geprüft wird das Image im CI-Job „Docker image smoke" (ci.yml).
FROM alpine:3.22 AS runtime

# post-install legt /etc/nginx/http.d/default.conf an: ein default_server auf :80,
# der ALLES mit 404 beantwortet und unseren Block aussticht (so im CI-Smoke
# passiert). Entfernen; unser Block ist selbst default_server.
RUN apk add --no-cache nginx nginx-mod-http-brotli \
    && rm -f /etc/nginx/http.d/default.conf \
    && mkdir -p /run/nginx \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log

# Our nginx config for SPA + WASM + PWA (server block inside http {})
COPY infra/docker/nginx.conf /etc/nginx/http.d/pagebound.conf
# Konfiguration schon beim Bauen prüfen (Syntax, doppelte default_server, Module).
RUN nginx -t

# Copy the published static site (inkl. der .br/.gz-Geschwister jeder Datei)
COPY --from=dotnetbuild /publish/wwwroot/ /usr/share/nginx/html/

EXPOSE 80
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
