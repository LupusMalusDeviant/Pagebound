# shellcheck shell=bash
# =============================================================================
# script_srcs — liest HTML von stdin und gibt jedes <script src> aus, ein Pfad
# pro Zeile. Wird von smoke.sh eingebunden; Selbsttest: script-srcs.test.sh.
#
# Warum ein eigener Parser mit Gegenzählung: Der erste Wurf in smoke.sh fand nur
# src="…" mit doppelten Anführungszeichen in derselben Zeile wie <script. Ein
# Tag mit src='…', mit Zeilenumbruch vor src oder in Großschreibung rutschte
# STILL durch — die Prüfung meldete dann „ok" für eine Datei, die sie nie
# angefasst hatte. Deshalb:
#   - Zeilenumbrüche werden vorher zu Leerzeichen, Groß/klein ist egal;
#   - src="…", src='…' und src=… (ohne Anführungszeichen) werden gelesen;
#   - jedes <script>-Tag, das überhaupt ein src-Attribut trägt, muss genau
#     einen nicht-leeren Wert liefern. Sonst Abbruch mit Rückgabewert 1 —
#     lieber rot als ein Script, das niemand geprüft hat.
# data-src o. Ä. zählt nicht (vor „src" muss Leerraum stehen).
# Grenze: HTML-Kommentare werden nicht entfernt. Ein auskommentiertes
# <script src> wird also mitgeprüft — das scheitert laut, nicht still.
# =============================================================================
script_srcs() {
  local html tags n_open n_src tag value
  local -a values=()
  html=$(tr '\r\n\t' '   ')

  tags=$(grep -oiE '<script([[:space:]][^>]*)?>' <<<"$html" || true)
  n_open=$(grep -oiE '<script([[:space:]]|>)' <<<"$html" | wc -l || true)
  if [ "$(grep -c . <<<"$tags" || true)" -ne "$n_open" ]; then
    echo "script_srcs: $n_open <script-Öffner, aber $(grep -c . <<<"$tags" || true) vollständige Tags" >&2
    return 1
  fi

  n_src=0
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    grep -qiE '[[:space:]]src[[:space:]]*=' <<<"$tag" || continue
    n_src=$((n_src + 1))
    value=$(sed -nE "s/.*[[:space:]]src[[:space:]]*=[[:space:]]*(\"([^\"]*)\"|'([^']*)'|([^[:space:]\"'>]+)).*/\\2\\3\\4/Ip" <<<"$tag")
    value=${value#./}
    [ -n "$value" ] && values+=("$value")
  done <<<"$tags"

  if [ "${#values[@]}" -ne "$n_src" ]; then
    echo "script_srcs: $n_src <script>-Tags mit src, aber nur ${#values[@]} lesbare Werte" >&2
    return 1
  fi
  [ "${#values[@]}" -eq 0 ] || printf '%s\n' "${values[@]}"
}
