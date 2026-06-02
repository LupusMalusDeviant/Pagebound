# =============================================================================
# pagebound-pdf-mcp-server — Node image for the HOSTED (Streamable HTTP) build.
# Tokenless endpoint with size/page limits (set via env in compose). Two stages:
# build (full deps + tsc) → runtime (prod deps only, non-root). No native deps.
# =============================================================================

# --- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Defaults für den gehosteten Betrieb — in compose überschreibbar.
ENV MCP_TRANSPORT=http \
    PORT=3000 \
    MCP_MAX_PDF_BYTES=26214400 \
    MCP_MAX_PAGES=1000

# Healthcheck gegen den HTTP-Endpunkt (kein curl im alpine-Node-Image → node).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
