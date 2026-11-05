#!/usr/bin/env bash
# =============================================================================
# Smoke-Test für das ausgelieferte Image (oder jede Kette davor):
#   bash infra/docker/smoke.sh http://localhost:8088
# Prüft, was der Browser tatsächlich bekommt — Kompression, Typen, CSP,
# Landingpages, SPA-Fallback. Bricht beim ersten Fehler mit Begründung ab.
#
# Wichtig: auch MIT „Via"-Header (so kommen Anfragen hinter Caddy an). Mit dem
# nginx-Standard gzip_proxied off wurde dort bisher gar nicht komprimiert.
# =============================================================================
set -euo pipefail
BASE=${1:?Basis-URL fehlt, z. B. http://localhost:8088}
CURL=(curl -sk --max-time 30)
fail() { echo "FEHLER: $*" >&2; exit 1; }
ok() { echo "ok  $*"; }

# Fingerprint-Namen aus dem Asset-Manifest des Service Workers holen.
assets=$("${CURL[@]}" "$BASE/service-worker-assets.js") || fail "service-worker-assets.js nicht abrufbar"
WASM=/$(grep -oE '_framework/dotnet\.native\.[a-z0-9]+\.wasm"' <<<"$assets" | head -1 | tr -d '"')
ICU=/$(grep -oE '_framework/icudt_EFIGS\.[a-z0-9]+\.dat"' <<<"$assets" | head -1 | tr -d '"')
[ "$WASM" != "/" ] || fail "dotnet.native.*.wasm nicht im Manifest"
[ "$ICU" != "/" ] || fail "icudt_EFIGS.*.dat nicht im Manifest"

# probe <pfad> <accept-encoding|-> <via|-> → "<status>|<bytes>|<encoding>|<type>"
probe() {
  local args=(-o /dev/null -w '%{http_code}|%{size_download}|%header{content-encoding}|%header{content-type}')
  [ "$2" != - ] && args+=(-H "Accept-Encoding: $2")
  [ "$3" != - ] && args+=(-H "Via: $3")
  "${CURL[@]}" "${args[@]}" "$BASE$1"
}
expect() { # <pfad> <ae> <via> <erwartetes encoding|identity> <typ-präfix>
  local out status bytes enc type
  out=$(probe "$1" "$2" "$3")
  IFS='|' read -r status bytes enc type <<<"$out"
  [ "$status" = 200 ] || fail "$1 (AE=$2, Via=$3): HTTP $status"
  if [ "$4" = identity ]; then [ -z "$enc" ] || fail "$1 (AE=$2): Encoding '$enc' statt keins"
  else [ "$enc" = "$4" ] || fail "$1 (AE=$2, Via=$3): Encoding '${enc:-keins}' statt '$4'"; fi
  [[ "$type" == "$5"* ]] || fail "$1: Content-Type '$type' statt '$5…'"
  ok "$1  AE=[$2] Via=[$3] → ${4} ${bytes} B ($type)"
}

for via in - "1.1 Caddy"; do
  expect "$WASM" "gzip, deflate, br, zstd" "$via" br application/wasm
  expect "$WASM" "gzip, deflate"           "$via" gzip application/wasm
  expect "$ICU"  "gzip, deflate, br"       "$via" br application/octet-stream
  expect "/"     "gzip, deflate, br"       "$via" br text/html
done
expect "$WASM" - - identity application/wasm

# Vorkomprimiert heißt: deutlich kleiner als roh (fängt z. B. ein leeres .br).
raw=$(probe "$WASM" - - | cut -d'|' -f2); br=$(probe "$WASM" "br" - | cut -d'|' -f2)
[ "$br" -gt 100000 ] && [ "$br" -lt $((raw * 45 / 100)) ] || fail "br-Größe unplausibel: $br B bei $raw B roh"
ok "br $br B vs. roh $raw B"

# Sicherheits-Header am Dokument, SPA-Fallback, Landingpage.
hdr=$("${CURL[@]}" -D - -o /dev/null "$BASE/reader")
grep -qi '^content-security-policy:.*connect-src .self.' <<<"$hdr" || fail "CSP fehlt am Dokument"
ok "CSP am Dokument"
"${CURL[@]}" "$BASE/reader" | grep -q 'id="pb-boot"' || fail "/reader liefert nicht die App-Hülle"
ok "SPA-Fallback /reader"
"${CURL[@]}" "$BASE/pdf-schwaerzen/" | grep -q '<h1>PDF schwärzen</h1>' || fail "Landingpage /pdf-schwaerzen/ fehlt"
ok "Landingpage /pdf-schwaerzen/"
echo "SMOKE OK"
