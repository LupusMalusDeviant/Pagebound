#!/usr/bin/env bash
# =============================================================================
# Pagebound — Deploy/Update auf dem LupusMalus-Host (Infomaniak), neben
# lupusmalus.dev. Idempotent: zieht die aktuellen GHCR-Images (App + MCP),
# (re)startet die Container hinter dem bestehenden Caddy und SYNCHRONISIERT
# den Caddy-Site-Block (inkl. /mcp-Route) — mit Validierung + Rollback.
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

# 0) GHCR-Auth sicherstellen ---------------------------------------------------
# Der Deploy läuft (via ServerWatch/SSH) meist als root — root hat aber KEINEN
# GHCR-Login, nur der ubuntu-User (~/.docker/config.json). Ohne dessen Credentials
# scheitert `docker compose pull` an den privaten Images mit
# "error from registry: unauthorized" (und bei detachter Ausführung sogar STILL).
# Ist DOCKER_CONFIG nicht schon vom Aufrufer gesetzt und hat der aktuelle User
# keinen eigenen ghcr.io-Login, aber ubuntu schon, nutze ubuntus Docker-Config.
# Überschreibbar per DOCKER_CONFIG bzw. GHCR_DOCKER_CONFIG.
has_ghcr_auth() { [ -f "$1/config.json" ] && grep -q 'ghcr\.io' "$1/config.json" 2>/dev/null; }
if [ -z "${DOCKER_CONFIG:-}" ]; then
  FALLBACK_DOCKER_CONFIG="${GHCR_DOCKER_CONFIG:-/home/ubuntu/.docker}"
  if has_ghcr_auth "${HOME:-/root}/.docker"; then
    :  # eigener Login vorhanden → Docker-Default (~/.docker) reicht
  elif has_ghcr_auth "$FALLBACK_DOCKER_CONFIG"; then
    export DOCKER_CONFIG="$FALLBACK_DOCKER_CONFIG"
    echo "→ GHCR-Auth: nutze $DOCKER_CONFIG (aktueller User hat keinen eigenen ghcr.io-Login)"
  else
    echo "⚠ Kein ghcr.io-Login gefunden (weder in ${HOME:-/root}/.docker noch $FALLBACK_DOCKER_CONFIG)."
    echo "  Der Pull privater Images wird vermutlich mit 'unauthorized' scheitern."
    echo "  Fix: als ubuntu 'docker login ghcr.io' ausführen oder DOCKER_CONFIG setzen."
  fi
fi

# 1) Compose ablegen + Images ziehen + Container (neu)starten ------------------
mkdir -p "$APP_DIR"
# Liegt deploy.sh selbst schon im APP_DIR (SCRIPT_DIR == APP_DIR), ist Quelle ==
# Ziel — ein cp auf dieselbe Datei bräche unter `set -e` ab. Nur kopieren, wenn
# es wirklich zwei verschiedene Dateien sind (-ef vergleicht Geräte-/Inode-Paar).
if ! [ "$SCRIPT_DIR/docker-compose.yml" -ef "$APP_DIR/docker-compose.yml" ]; then
  cp "$SCRIPT_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
fi

echo "→ Images ziehen + Container (neu)starten (pagebound + pagebound-mcp)"
docker compose -f "$APP_DIR/docker-compose.yml" pull
docker compose -f "$APP_DIR/docker-compose.yml" up -d

# Verwaiste (dangling) Images aufräumen — beim `pull` ersetzte alte Layer bleiben
# sonst liegen und füllen die Platte. `|| true`, damit ein Prune-Fehler (z. B.
# paralleler Build) den Deploy unter `set -e` nicht abbricht.
echo "→ Verwaiste Docker-Images aufräumen"
docker image prune -f || true

# 2) Caddy-Site-Block synchronisieren -----------------------------------------
# Entfernt einen evtl. vorhandenen Block der Domain (brace-aware, egal ob
# zusätzliche handle{}-Unterblöcke enthalten sind) und hängt den frischen Block
# aus Caddyfile.pagebound an. So greift auch die neue /mcp-Route bei Re-Runs.
#
# WICHTIG: Die Caddyfile ist als EINZELNE Datei in den Caddy-Container gemountet.
# Schreibe immer IN-PLACE (`>`/`>>`/sed -i), NIEMALS per `mv neu Caddyfile` — ein
# Rename tauscht den Inode, der Bind-Mount zeigt dann weiter auf den alten Inhalt
# und `caddy reload` lädt eine veraltete Config (Route fehlt). In-place-Schreiben
# behält den Inode, der Container sieht die Änderung sofort.
echo "→ Caddy-Block synchronisieren, validieren, neu laden"
BACKUP="$CADDY_DIR/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"
cp "$CADDY_DIR/Caddyfile" "$BACKUP"

TMP="$(mktemp)"
awk -v dom="$DOMAIN" '
  BEGIN { inside=0; depth=0 }
  {
    if (inside==0 && index($0, dom " {")==1) {
      inside=1; depth=0
      for (i=1;i<=length($0);i++){ c=substr($0,i,1); if(c=="{")depth++; else if(c=="}")depth-- }
      next
    }
    if (inside==1) {
      for (i=1;i<=length($0);i++){ c=substr($0,i,1); if(c=="{")depth++; else if(c=="}")depth-- }
      if (depth<=0) inside=0
      next
    }
    print
  }
' "$CADDY_DIR/Caddyfile" > "$TMP"

# Trailing-Leerzeilen kappen, genau eine Leerzeile als Trenner, dann Block dran.
sed -e :a -e '/^\n*$/{$d;N;ba}' "$TMP" > "$CADDY_DIR/Caddyfile" || cp "$TMP" "$CADDY_DIR/Caddyfile"
rm -f "$TMP"
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

echo "✓ Fertig."
echo "  → App: https://$DOMAIN"
echo "  → MCP: https://$DOMAIN/mcp   (Health intern: pagebound-mcp:3000/healthz)"
