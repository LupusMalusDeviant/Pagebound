#!/usr/bin/env bash
# =============================================================================
# Selbsttest für script_srcs (script-srcs.sh): bash infra/docker/script-srcs.test.sh
# Läuft in der CI vor dem Image-Smoke. Prüft genau die Schreibweisen, an denen
# der erste Parser in smoke.sh still vorbeisah, und dass ein unlesbares src
# zum Abbruch führt statt zu einer kürzeren Liste.
# =============================================================================
set -euo pipefail
. "$(dirname "$0")/script-srcs.sh"
fail() { echo "FEHLER: $*" >&2; exit 1; }

html='<!DOCTYPE html>
<html><head>
<script type="importmap"></script>
<script>window.inline = 1;</script>
<script src="js/doppelt.js"></script>
<script src='"'"'js/einfach.js'"'"'></script>
<script
    src="js/umbruch.js"></script>
<script defer src="js/attribut-davor.js"></script>
<SCRIPT SRC="js/gross.js"></SCRIPT>
<script src=js/ohne-anfuehrung.js></script>
<script src = "./js/leerraum.js"></script>
<script data-src="js/kein-src.js"></script>
</head></html>'

expected='js/doppelt.js
js/einfach.js
js/umbruch.js
js/attribut-davor.js
js/gross.js
js/ohne-anfuehrung.js
js/leerraum.js'

got=$(script_srcs <<<"$html") || fail "script_srcs brach bei gültigem HTML ab"
[ "$got" = "$expected" ] || fail "falsche Liste:
--- erwartet
$expected
--- bekommen
$got"
echo "ok  7 Schreibweisen von <script src> erkannt, inline/importmap/data-src ignoriert"

# Ein src-Attribut ohne lesbaren Wert darf die Liste nicht still verkürzen.
if script_srcs <<<'<script src="js/a.js"></script><script src=""></script>' >/dev/null 2>&1; then
  fail "leeres src wurde still übergangen"
fi
echo "ok  leeres src führt zum Abbruch"

# Ohne ein einziges <script src> kommt eine leere Liste — smoke.sh fängt das ab.
got=$(script_srcs <<<'<html><script>1</script></html>') || fail "Abbruch bei Seite ohne src"
[ -z "$got" ] || fail "Seite ohne src lieferte: $got"
echo "ok  Seite ohne <script src> liefert leere Liste"

echo "SCRIPT-SRCS OK"
