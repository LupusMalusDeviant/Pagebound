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
# (|| true: ohne Treffer soll die eigene Meldung kommen, nicht ein stiller pipefail-Abbruch)
WASM=/$( (grep -oE '_framework/dotnet\.native\.[a-z0-9]+\.wasm"' <<<"$assets" || true) | head -1 | tr -d '"')
RUNTIME=/$( (grep -oE '_framework/dotnet\.runtime\.[a-z0-9]+\.js"' <<<"$assets" || true) | head -1 | tr -d '"')
[ "$WASM" != "/" ] || fail "dotnet.native.*.wasm nicht im Manifest"
[ "$RUNTIME" != "/" ] || fail "dotnet.runtime.*.js nicht im Manifest"

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
  expect "$RUNTIME" "gzip, deflate, br"    "$via" br application/javascript
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
# Body erst einlesen, dann prüfen: "curl | grep -q" bricht mit pipefail sporadisch
# (grep beendet früh → curl bekommt SIGPIPE → Exit 23), so in der CI geschehen.
reader=$("${CURL[@]}" "$BASE/reader")
grep -q 'id="pb-boot"' <<<"$reader" || fail "/reader liefert nicht die App-Hülle"
ok "SPA-Fallback /reader"
landing=$("${CURL[@]}" "$BASE/pdf-schwaerzen/")
grep -q '<h1>PDF schwärzen</h1>' <<<"$landing" || fail "Landingpage /pdf-schwaerzen/ fehlt"
ok "Landingpage /pdf-schwaerzen/"

# Die Datenschutzseiten sind die URL, die den Stores genannt wird (Google Play
# und Microsoft Store verlangen sie). Fehlen sie im Abbild, liefert der
# SPA-Fallback die App mit HTTP 200 — der Prüfer sähe statt der Erklärung den
# Reader. Darum auf die Überschrift prüfen, nicht auf den Status.
for pfad in /datenschutz/ /en/privacy/; do
  seite=$("${CURL[@]}" "$BASE$pfad")
  grep -qE '<h1>(Datenschutz|Privacy)</h1>' <<<"$seite" || fail "Datenschutzseite $pfad fehlt (SPA-Fallback liefert die App)"
  ok "Datenschutzseite $pfad"
done

# Der Service Worker: Quelle ist service-worker.published.js, ausgeliefert wird
# sie beim Veröffentlichen als /service-worker.js. Genau diese Umbenennung macht
# einen Irrtum unsichtbar — wer auf /service-worker.published.js prüft, bekommt
# 404 bzw. den Fallback und hält das für „fehlt". Fällt der SW aus dem Abbild
# oder landet eine alte Fassung darin, läuft die App weiter (nur ohne Offline
# und ohne Teilen-Ziel), und nichts wird rot.
expect "/service-worker.js" - - identity application/javascript
sw=$("${CURL[@]}" "$BASE/service-worker.js")
grep -q "share-target" <<<"$sw" || fail "/service-worker.js kennt kein Teilen-Ziel — alte Fassung im Abbild"
grep -q "pb-share" <<<"$sw" || fail "/service-worker.js kennt den Freigabe-Parkplatz nicht"
ok "/service-worker.js mit Teilen-Ziel"

# ---------------------------------------------------------------------------
# Jedes <script src> aus index.html muss auch JavaScript sein.
#
# Warum als eigene Prüfung: der SPA-Fallback (try_files … /index.html) macht
# eine FEHLENDE Datei unsichtbar — sie kommt als HTTP 200 mit index.html und
# text/html zurück, nicht als 404. Genau so sind boot.js und lazy-bridges.js
# aus dem Image gefallen (pauschaler .dockerignore-Ausschluss), und weder die
# Kompressions- noch die CSP- noch die Routen-Prüfung oben hat das gesehen:
# eine App aus diesem Image wäre ohne Boot-Bildschirm und Lazy-Loader gestartet.
# Diese Prüfung fängt die ganze Klasse — jede im Image fehlende Script-Datei.
# ---------------------------------------------------------------------------
# Der Parser (script-srcs.sh) liest jede Schreibweise und zählt gegen: ein
# <script>-Tag mit src, dessen Wert er nicht lesen kann, bricht hier ab statt
# still aus der Liste zu fallen.
. "$(dirname "$0")/script-srcs.sh"
index=$("${CURL[@]}" "$BASE/") || fail "index.html nicht abrufbar"
scripts=$(script_srcs <<<"$index") || fail "<script src> in index.html nicht vollständig lesbar (siehe oben)"
[ -n "$scripts" ] || fail "keine <script src> in index.html gefunden — Parser oder Seite kaputt"
count=0
while IFS= read -r s; do
  case "$s" in http*|//*) fail "externes Script in index.html: $s (Datenschutzzusage: alles self-hosted)" ;; esac
  out=$(probe "/${s#/}" - -)
  IFS='|' read -r status bytes _enc type <<<"$out"
  [ "$status" = 200 ] || fail "/${s#/} (aus index.html): HTTP $status"
  case "$type" in
    *javascript*) ;;
    *) fail "/${s#/} (aus index.html): Content-Type '$type' statt JavaScript — Datei fehlt im Image, der SPA-Fallback liefert index.html" ;;
  esac
  count=$((count + 1))
done <<<"$scripts"
ok "$count <script src> aus index.html werden als JavaScript ausgeliefert"

# ---------------------------------------------------------------------------
# Icons und Screenshots aus dem Manifest müssen als Bild ankommen.
#
# Dieselbe Fehlerklasse wie oben, nur für die Store-Dateien: fehlt ein Icon im
# Abbild, liefert der SPA-Fallback index.html mit HTTP 200 — Android zeigt dann
# ein leeres Icon, und der Store lehnt die Einreichung ab, ohne dass hier je
# etwas rot geworden wäre. manifest.test.mjs prüft dieselben Dateien im Repo;
# diese Prüfung ist die am ausgelieferten Abbild.
#
# JSON wird hier mit einem regulären Ausdruck gelesen, anders als das HTML oben:
# in JSON kann ein Zeichenkettenwert kein unmaskiertes " enthalten, der Wert
# endet also immer am nächsten Anführungszeichen. Gegengezählt wird trotzdem.
# ---------------------------------------------------------------------------
out=$(probe "/manifest.webmanifest" - -)
IFS='|' read -r status _bytes _enc type <<<"$out"
[ "$status" = 200 ] || fail "/manifest.webmanifest: HTTP $status"
case "$type" in
  *json*) ;;
  *) fail "/manifest.webmanifest: Content-Type '$type' statt JSON — Datei fehlt im Image" ;;
esac
mf=$("${CURL[@]}" "$BASE/manifest.webmanifest") || fail "manifest.webmanifest nicht abrufbar"
keys=$( (grep -oE '"src"[[:space:]]*:' <<<"$mf" || true) | grep -c . )
srcs=$( (grep -oE '"src"[[:space:]]*:[[:space:]]*"[^"]*"' <<<"$mf" || true) | sed -E 's/.*"([^"]*)"$/\1/' )
found=$( (grep -c . <<<"$srcs") || true )
[ "$keys" -gt 0 ] || fail "manifest.webmanifest enthält kein \"src\" — Datei kaputt oder leer"
[ "$found" -eq "$keys" ] || fail "manifest.webmanifest: $keys \"src\"-Felder, aber $found lesbare Werte"
shots=0
while IFS= read -r s; do
  [ -n "$s" ] || continue
  case "$s" in http*|//*) fail "externes Bild im Manifest: $s (Datenschutzzusage: alles self-hosted)" ;; esac
  out=$(probe "/${s#/}" - -)
  IFS='|' read -r status bytes _enc type <<<"$out"
  [ "$status" = 200 ] || fail "/${s#/} (aus manifest.webmanifest): HTTP $status"
  case "$type" in
    image/*) ;;
    *) fail "/${s#/} (aus manifest.webmanifest): Content-Type '$type' statt Bild — Datei fehlt im Image" ;;
  esac
  [ "$bytes" -gt 1000 ] || fail "/${s#/}: nur $bytes B — kaputtes oder leeres Bild"
  shots=$((shots + 1))
done <<<"$srcs"
ok "$shots Icons/Screenshots aus manifest.webmanifest werden als Bild ausgeliefert"
echo "SMOKE OK"
