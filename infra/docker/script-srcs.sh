# shellcheck shell=bash
# =============================================================================
# script_srcs — liest HTML von stdin und gibt jedes <script src> aus, ein Pfad
# pro Zeile. Wird von smoke.sh eingebunden; Selbsttest: script-srcs.test.sh.
#
# Warum ein Tokenizer statt eines regulären Ausdrucks: Jede Regex-Fassung hat
# hier still daneben gelegen.
#   - Der erste Wurf fand nur src="…" in derselben Zeile wie <script — Tags mit
#     src='…', Zeilenumbruch oder Großschreibung fielen still aus der Prüfung.
#   - Die zweite Fassung las „ src=" auch im TEXT eines anderen Attributs
#     (data-note=" src=js/da.js") und brach Tags an einem „>" in einem
#     Attributwert ab. Dann prüft der Smoke eine andere Datei als die, die der
#     Browser lädt (Codex-Befund, nachgestellt).
# Deshalb liest dieser Parser die Attribute so, wie der Browser es tut:
#   - Name, optional =, Wert in "…", '…' oder ohne Anführungszeichen;
#     ein „>" in einem Wert in Anführungszeichen beendet das Tag nicht;
#   - das ERSTE src zählt (doppelte Attribute ignoriert der Browser);
#   - der Inhalt eines <script> ist Rohtext bis </script — ein „<script src"
#     in einem String darin ist kein Tag; HTML-Kommentare werden übersprungen;
#   - jedes Tag mit src muss einen nicht-leeren Wert liefern, ein Tag ohne
#     schließendes „>" bricht ab. Lieber rot als ein ungeprüftes Script.
# Zeilenumbrüche und Tabs werden vorher zu Leerzeichen (für HTML gleichwertig).
# =============================================================================
script_srcs() {
  tr '\r\n\t\f' '    ' | awk -v sq="'" '
    { html = html $0 }
    END {
      n = length(html); low = tolower(html); i = 1; withsrc = 0; nval = 0
      while (i <= n) {
        if (substr(html, i, 4) == "<!--") {
          j = index(substr(html, i + 4), "-->")
          if (j == 0) break
          i = i + 4 + j + 2
          continue
        }
        c = substr(low, i + 7, 1)
        if (substr(low, i, 7) != "<script" || (c != " " && c != ">" && c != "/")) { i++; continue }

        i += 7; hassrc = 0; src = ""; closed = 0
        while (i <= n) {
          c = substr(html, i, 1)
          if (c == " " || c == "/") { i++; continue }
          if (c == ">") { closed = 1; i++; break }
          name = ""
          while (i <= n) {
            c = substr(html, i, 1)
            if (c == " " || c == "=" || c == ">" || c == "/") break
            name = name c; i++
          }
          while (substr(html, i, 1) == " ") i++
          val = ""
          if (substr(html, i, 1) == "=") {
            i++
            while (substr(html, i, 1) == " ") i++
            q = substr(html, i, 1)
            if (q == "\"" || q == sq) {
              j = index(substr(html, i + 1), q)
              if (j == 0) { i = n + 1; break }
              val = substr(html, i + 1, j - 1); i = i + j + 1
            } else {
              while (i <= n) {
                c = substr(html, i, 1)
                if (c == " " || c == ">") break
                val = val c; i++
              }
            }
          }
          if (tolower(name) == "src" && !hassrc) { hassrc = 1; src = val }
        }
        if (!closed) { print "script_srcs: <script>-Tag ohne schließendes >" > "/dev/stderr"; exit 1 }
        if (hassrc) {
          withsrc++
          sub(/^\.\//, "", src)
          if (src != "") out[++nval] = src
        }
        j = index(substr(low, i), "</script")
        i = (j == 0) ? n + 1 : i + j - 1 + 8
      }
      if (nval != withsrc) {
        printf("script_srcs: %d <script>-Tags mit src, aber nur %d lesbare Werte\n", withsrc, nval) > "/dev/stderr"
        exit 1
      }
      for (k = 1; k <= nval; k++) print out[k]
    }'
}
