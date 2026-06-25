# =============================================================================
# Pagebound — Multi-stage Dockerfile
# ----------------------------------------------------------------------------
# Stage 1: Build CSS (Tailwind) + JS-Interop bridges (esbuild) with Node 24
# Stage 2: dotnet publish Blazor WASM with .NET 10 SDK
# Stage 3: Static hosting via nginx:alpine
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
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnetbuild
WORKDIR /src

# Copy source projects (Pagebound.Web references Core + Infrastructure)
COPY src/ /src/

# Drop the freshly built CSS + JS bridges into the layout the .csproj expects,
# replacing the git-ignored source-tree outputs. WICHTIG: ALLE Bundles aus dem
# jsbuild-Stage übernehmen — im sauberen CI-Checkout sind die .js nicht
# eingecheckt, sonst fehlen Manipulator/OCR/Files/Split/Workspace/Tweaks und die
# App ist halb tot (kein Theme, keine PDF-Ops, keine OCR …).
COPY --from=jsbuild /web/wwwroot/css/app.css                  /src/Pagebound.Web/wwwroot/css/app.css
COPY --from=jsbuild /web/wwwroot/js/pdfjs-bridge.js           /src/Pagebound.Web/wwwroot/js/pdfjs-bridge.js
COPY --from=jsbuild /web/wwwroot/js/shortcuts-bridge.js       /src/Pagebound.Web/wwwroot/js/shortcuts-bridge.js
COPY --from=jsbuild /web/wwwroot/js/storage-bridge.js         /src/Pagebound.Web/wwwroot/js/storage-bridge.js
COPY --from=jsbuild /web/wwwroot/js/pdf-manipulator-bridge.js /src/Pagebound.Web/wwwroot/js/pdf-manipulator-bridge.js
COPY --from=jsbuild /web/wwwroot/js/ocr-bridge.js             /src/Pagebound.Web/wwwroot/js/ocr-bridge.js
COPY --from=jsbuild /web/wwwroot/js/file-handle-bridge.js     /src/Pagebound.Web/wwwroot/js/file-handle-bridge.js
COPY --from=jsbuild /web/wwwroot/js/split-bridge.js           /src/Pagebound.Web/wwwroot/js/split-bridge.js
COPY --from=jsbuild /web/wwwroot/js/workspace-bridge.js       /src/Pagebound.Web/wwwroot/js/workspace-bridge.js
COPY --from=jsbuild /web/wwwroot/js/tweaks-bridge.js          /src/Pagebound.Web/wwwroot/js/tweaks-bridge.js
COPY --from=jsbuild /web/wwwroot/js/wysiwyg-editor.js         /src/Pagebound.Web/wwwroot/js/wysiwyg-editor.js
COPY --from=jsbuild /web/wwwroot/js/mind-bridge.js            /src/Pagebound.Web/wwwroot/js/mind-bridge.js
COPY --from=jsbuild /web/wwwroot/js/designs-bridge.js         /src/Pagebound.Web/wwwroot/js/designs-bridge.js
COPY --from=jsbuild /web/wwwroot/js/sign-bridge.js            /src/Pagebound.Web/wwwroot/js/sign-bridge.js
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
FROM nginx:alpine AS runtime

# Drop nginx's default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx config for SPA + WASM + PWA
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the published static site
COPY --from=dotnetbuild /publish/wwwroot/ /usr/share/nginx/html/

EXPOSE 80

# nginx:alpine already has a default CMD; we keep it.
