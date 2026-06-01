#!/usr/bin/env bash
# =============================================================================
# Pagebound — Deploy/Update auf dem LupusMalus-Host (Infomaniak), neben
# lupusmalus.dev. Idempotent: zieht das aktuelle GHCR-Image, (re)startet den
# Container hinter dem bestehenden Caddy und hängt beim ersten Mal den
# Caddy-Site-Block ein (mit Validierung + Rollback bei Fehler).
#
# Aufruf auf dem Server (Dateien dieses Ordners daneben):
#   bash deploy.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${PAGEBOUND_DIR:-/home/ubuntu/pagebound}"
CADDY_DIR="${CADDY_DIR:-/home/ubuntu/lupusmalus-web}"
CADDY_CONTAINER="${CADDY_CONTAINER:-lupusmalus-web-caddy-1}"
DOMAIN="pagebound.app.lupusmalus.dev"

echo "→ Pagebound-Deploy ($DOMAIN)"

# 1) Compose ablegen + Image ziehen + Container (neu)starten ------------------
mkdir -p "$APP_DIR"
cp "$SCRIPT_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"

echo "→ Image ziehen + Container (neu)starten"
docker compose -f "$APP_DIR/docker-compose.yml" pull
docker compose -f "$APP_DIR/docker-compose.yml" up -d

# 2) Caddy-Site-Block einmalig einhängen (idempotent via Domain-Grep) ----------
if grep -q "$DOMAIN" "$CADDY_DIR/Caddyfile"; then
  echo "→ Caddy-Block für $DOMAIN bereits vorhanden — übersprungen"
else
  echo "→ Caddy-Block anhängen, validieren, neu laden"
  BACKUP="$CADDY_DIR/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$CADDY_DIR/Caddyfile" "$BACKUP"
  printf '\n' >> "$CADDY_DIR/Caddyfile"
  cat "$SCRIPT_DIR/Caddyfile.pagebound" >> "$CADDY_DIR/Caddyfile"
  if docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    echo "→ Caddy neu geladen (Backup: $BACKUP)"
  else
    echo "✗ Caddy-Validierung fehlgeschlagen — Rollback auf $BACKUP"
    cp "$BACKUP" "$CADDY_DIR/Caddyfile"
    exit 1
  fi
fi

echo "✓ Fertig. Beim ersten Mal vergibt Caddy ~10–30 s ein TLS-Zertifikat."
echo "  → https://$DOMAIN"
