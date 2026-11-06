# shellcheck shell=bash
# =============================================================================
# script_srcs — liest HTML von stdin und gibt jedes <script src> aus, ein Pfad
# pro Zeile. Wird von smoke.sh eingebunden; Selbsttest: script-srcs.test.sh.
#
# Warum ein Tokenizer statt eines regulären Ausdrucks: Jede einfachere Fassung
# hat hier still daneben gelegen, und jedes Mal meldete der Smoke „ok" für
# eine Datei, die er nie geprüft hatte (alle Fälle stehen im Selbsttest):
#   - nur src="…" in derselben Zeile wie <script (einfache Anführungszeichen,
#     Zeilenumbruch, Großschreibung fielen heraus);
#   - „ src=" im TEXT eines anderen Attributs, „>" in einem Attributwert;
#   - „<!--" in einem Attribut eines anderen Tags, „</scriptlet>" als
#     vermeintliches Script-Ende — beides verschluckte den Rest der Seite.
# Deshalb liest dieser Parser die Seite so, wie der Browser es tut:
#   - JEDES Tag (auch End-Tags) wird mit seinen Attributen gelesen: Name,
#     optional =, Wert in "…", '…' oder ohne Anführungszeichen. Was in einem
#     Wert steht („>", „<!--", „ src="), ist Text;
#   - bei <script> zählt das ERSTE src (doppelte Attribute ignoriert der
#     Browser);
#   - Rohtext-Elemente (script, style, textarea, title, …) laufen bis zu ihrem
#     End-Tag — „</name" gefolgt von Leerraum, „/" oder „>", nicht „</namexyz";
#   - Kommentare werden nur außerhalb von Tags erkannt.
# Alles, was der Browser als „Rest der Seite verschluckt" behandeln würde
# (offener Kommentar, offenes Attribut, Tag ohne „>", Rohtext ohne End-Tag),
# ist hier ein Fehler mit Rückgabewert 1: lieber rot als eine stillschweigend
# kürzere Liste. Ebenso jedes <script>-Tag mit src ohne lesbaren Wert.
#
# STRIKTE TEILMENGE (Entscheidung nach dem dritten Codex-Review): Ein
# vollständiger HTML5-Parser in awk ist nicht das Ziel — jedes Review fand die
# nächste Sonderregel (SVG-<title/>, Attribut „=…"). Was dieser Parser nicht
# sicher so liest wie der Browser, lehnt er ab, statt zu raten:
#   - Fremdinhalt <svg>, <math> (eigene Regeln für Rohtext und „/>");
#   - Attributnamen, die leer sind oder " ' < enthalten (Fehlerkorrektur des
#     Browsers);
#   - <!…> außer <!-- --> und <!DOCTYPE>, <?…>, </ ohne Buchstaben
#     („bogus comments"); Kommentare mit Sonderende <!-->, <!---> oder --!>;
#   - <plaintext> (danach ist der Rest der Seite Text);
#   - „&" in einem script-src oder base-href (Zeichenreferenzen wie &#109;
#     dekodiert der Browser, dieser Parser nicht);
#   - <base> mit einem href außer "/" (smoke.sh fragt Pfade ab "/" ab).
# Braucht index.html eines davon, wird der Smoke rot — dann hier bewusst
# erweitern, mit Selbsttest.
# Zeilenumbrüche, Tabs und Seitenvorschübe werden vorher zu Leerzeichen.
# Läuft unter gawk und mawk (ubuntu-latest).
# =============================================================================
script_srcs() {
  tr '\r\n\t\f' '    ' | awk -v sq="'" '
    function fail(msg) { print "script_srcs: " msg > "/dev/stderr"; failed = 1; exit 1 }

    # Tag-Name ab i (Kleinbuchstaben), endet vor Leerraum, "/" oder ">".
    function tagname(   c, s) {
      s = ""
      while (i <= n) {
        c = substr(low, i, 1)
        if (c == " " || c == "/" || c == ">") break
        s = s c; i++
      }
      return s
    }

    # Attribute ab i bis einschließlich ">". Setzt hassrc/src und
    # hashref/href (jeweils das erste Vorkommen).
    function attrs(what,   c, name, val, q, j) {
      hassrc = 0; src = ""; hashref = 0; href = ""
      while (i <= n) {
        c = substr(html, i, 1)
        if (c == " " || c == "/") { i++; continue }
        if (c == ">") { i++; return }
        name = ""
        while (i <= n) {
          c = substr(html, i, 1)
          if (c == " " || c == "=" || c == ">" || c == "/") break
          name = name c; i++
        }
        if (name == "") fail(what ": Attribut ohne Namen (nicht unterstützt)")
        if (index(name, "\"") || index(name, sq) || index(name, "<"))
          fail(what ": Attributname " name " enthält \" '"'"' oder < (nicht unterstützt)")
        while (substr(html, i, 1) == " ") i++
        val = ""
        if (substr(html, i, 1) == "=") {
          i++
          while (substr(html, i, 1) == " ") i++
          q = substr(html, i, 1)
          if (q == "\"" || q == sq) {
            j = index(substr(html, i + 1), q)
            if (j == 0) fail(what ": Attributwert ohne schließendes " q)
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
        if (tolower(name) == "href" && !hashref) { hashref = 1; href = val }
      }
      fail(what ": Tag ohne schließendes >")
    }

    # Rohtext bis zum passenden End-Tag überspringen und dieses mitlesen.
    function skipraw(name,   j, c) {
      while (1) {
        j = index(substr(low, i), "</" name)
        if (j == 0) fail("<" name "> ohne </" name ">")
        i = i + j - 1 + 2 + length(name)
        c = substr(low, i, 1)
        if (c == " " || c == "/" || c == ">") { attrs("</" name); return }
      }
    }

    { html = html $0 }
    END {
      raw["script"]; raw["style"]; raw["textarea"]; raw["title"]; raw["xmp"]
      raw["iframe"]; raw["noembed"]; raw["noframes"]; raw["noscript"]
      n = length(html); low = tolower(html); i = 1; withsrc = 0; nval = 0
      while (i <= n) {
        if (substr(html, i, 1) != "<") { i++; continue }
        if (substr(html, i, 4) == "<!--") {
          j = index(substr(html, i + 4), "-->")
          if (j == 0) fail("Kommentar ohne -->")
          body = substr(html, i + 4, j - 1)
          if (substr(body, 1, 1) == ">" || substr(body, 1, 2) == "->" || index(body, "--!>"))
            fail("Kommentar mit Sonderende <!-->, <!---> oder --!> (nicht unterstützt)")
          i = i + 4 + j + 2
          continue
        }
        c = substr(low, i + 1, 1)
        if (c == "!") {
          if (substr(low, i, 9) != "<!doctype") fail("<!…> außer Kommentar und DOCTYPE (nicht unterstützt)")
          j = index(substr(html, i), ">")
          if (j == 0) fail("<!DOCTYPE ohne >")
          i = i + j
          continue
        }
        if (c == "?") fail("<?…> (nicht unterstützt)")
        if (c == "/") {
          if (substr(low, i + 2, 1) !~ /[a-z]/) fail("</ ohne Tag-Namen (nicht unterstützt)")
          i += 2; name = tagname(); attrs("</" name)
          continue
        }
        if (c !~ /[a-z]/) { i++; continue }

        i++; name = tagname()
        if (name == "svg" || name == "math") fail("<" name "> (Fremdinhalt, nicht unterstützt)")
        if (name == "plaintext") fail("<plaintext> (Rest der Seite wäre Text, nicht unterstützt)")
        attrs("<" name)
        if ((name == "script" && index(src, "&")) || (name == "base" && index(href, "&")))
          fail("<" name ">: & im Pfad (Zeichenreferenzen werden nicht dekodiert, nicht unterstützt)")
        if (name == "base" && hashref && href != "/")
          fail("<base href=\"" href "\"> — smoke.sh fragt Pfade ab / ab (nicht unterstützt)")
        if (name == "script" && hassrc) {
          withsrc++
          sub(/^\.\//, "", src)
          if (src != "") out[++nval] = src
        }
        if (name in raw) skipraw(name)
      }
      if (nval != withsrc)
        fail(withsrc " <script>-Tags mit src, aber nur " nval " lesbare Werte")
      for (k = 1; k <= nval; k++) print out[k]
    }'
}
