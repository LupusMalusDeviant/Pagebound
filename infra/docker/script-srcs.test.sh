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

# Codex-Befunde zur Regex-Fassung: Text in einem anderen Attribut ist kein src,
# ein „>" in einem Attributwert beendet das Tag nicht. Dazu: Inhalt eines
# <script> und HTML-Kommentare sind keine Tags, das erste src gewinnt.
html='<script src="js/fehlt.js" data-note=" src=js/da.js"></script>
<script data-note=">" src="js/nach-gt.js"></script>
<script>var s = "<script src=js/im-string.js>";</script>
<!-- <script src="js/auskommentiert.js"></script> -->
<script src="js/erstes.js" src="js/zweites.js"></script>'
expected='js/fehlt.js
js/nach-gt.js
js/erstes.js'
got=$(script_srcs <<<"$html") || fail "script_srcs brach bei gültigem HTML ab (Attribut-Fälle)"
[ "$got" = "$expected" ] || fail "falsche Liste bei Attribut-Fällen:
--- erwartet
$expected
--- bekommen
$got"
echo "ok  src im Text eines anderen Attributs, > im Wert, Script-Inhalt, Kommentar, doppeltes src"

# Zweites Codex-Review: „<!--" im Attribut eines anderen Tags ist kein
# Kommentar, „</scriptlet>" beendet kein Script, und Rohtext in <style> ist
# kein Markup. Jeder dieser Fälle verschluckte vorher den Rest der Seite.
html='<script src="js/gut.js"></script>
<div title="<!--"></div>
<script src="js/nach-div.js"></script>
<script>const s = "</scriptlet><!--";</script>
<script src="js/nach-scriptlet.js"></script>
<style>a[title="<!--"] { color: red }</style>
<script src="js/nach-style.js"></script>
<SCRIPT SRC="js/ende-gross.js"></SCRIPT >'
expected='js/gut.js
js/nach-div.js
js/nach-scriptlet.js
js/nach-style.js
js/ende-gross.js'
got=$(script_srcs <<<"$html") || fail "script_srcs brach bei gültigem HTML ab (Kommentar-/End-Tag-Fälle)"
[ "$got" = "$expected" ] || fail "falsche Liste bei Kommentar-/End-Tag-Fällen:
--- erwartet
$expected
--- bekommen
$got"
echo "ok  <!-- im Attribut, </scriptlet>, <style>-Rohtext, End-Tag mit Leerraum"

# Was der Browser als Rest-der-Seite-verschluckt behandeln würde, ist für den
# Smoke ein Fehler: lieber rot als eine stillschweigend kürzere Liste.
for bad in '<script src="js/a.js"></script><!-- offen' \
           '<script src="js/a.js"></script><div title="offen></div>' \
           '<script src="js/a.js"></script><script>kein Ende'; do
  if script_srcs <<<"$bad" >/dev/null 2>&1; then
    fail "unvollständiges HTML wurde still akzeptiert: $bad"
  fi
done
echo "ok  offener Kommentar, offenes Attribut, Script ohne Ende führen zum Abbruch"

# Ein Tag ohne schließendes > darf nicht still verschwinden.
if script_srcs <<<'<script src="js/a.js"></script><script src="js/b.js"' >/dev/null 2>&1; then
  fail "Tag ohne > wurde still übergangen"
fi
echo "ok  Tag ohne > führt zum Abbruch"

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
