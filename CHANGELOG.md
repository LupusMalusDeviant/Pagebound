# Changelog

Alle nennenswerten Änderungen an Pagebound werden in dieser Datei dokumentiert.
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.17.0-beta] — 2026-11-13

Anmerkungs-Release: Eine Anmerkung in Pagebound ist ab jetzt eine echte
PDF-Annotation, kein eingebrannter Seiteninhalt mehr — sie lässt sich in jedem
anderen Betrachter öffnen, verschieben und löschen, und eine fremde PDF bringt
ihre Anmerkungen mit herein. Dazu zwei Arbeiten an Stellen, die das Projekt
selbst als seine Schwachpunkte benennt: die Seitenbilder des Readers liegen
nicht mehr als wachsende Sammlung im WASM-Speicher, sondern als Fenster um das
Sichtbare, und das Telefon-Layout ist nachgemessen statt behauptet. Neu im
MCP-Paket: `pdf_sanitize`, das 33. Werkzeug.

Der Säuberer hat **sechs** Codex-Runden gebraucht, bis eine davon nichts mehr
fand — die Runden 3 bis 6 korrigierten jeweils die Runde davor. Das steht hier,
weil es die Sorte Fehler war, die keine der vorhandenen Prüfungen sehen konnte:
dreimal hielt der Code eine Zusage, die die Prüfung gar nicht abfragte.

### Hinzugefügt
- **Anmerkungen als echte PDF-Annotationen (`/Annots`).** Geschrieben und gelesen: Hervorhebung, Notiz, Freitext und Zeichnung werden als `/Highlight`, `/Text`, `/FreeText` und `/Ink` in die Datei gelegt, mit `/NM` als Identität und `/M` als Zeitpunkt, und beim Öffnen einer fremden PDF wieder eingesammelt. Vorher brannte Pagebound sie in den Seiteninhalt — in Acrobat war die Hervorhebung danach ein farbiges Rechteck, das niemand mehr anfassen konnte. Das Einbrennen bleibt als eigener Weg erhalten (Ausgabe für Empfänger, die nichts bearbeiten sollen). Vertrag: `docs/contracts/annotationen-als-pdf-annots.md`
- **`pdf_sanitize` — das 33. MCP-Werkzeug.** Entfernt aus einer PDF, was nicht Seiteninhalt ist: JavaScript (`/Names /JavaScript`, `/OpenAction`, `/AA` an Katalog, Seiten, Annotationen und Formularfeldern), eingebettete Dateien (Namensbaum, `/AF`, `/FileAttachment`), Metadaten (alle `/Info`-Schlüssel ausser `/Producer`, dazu XMP), Aktionen an Annotationen und Feldern, und alles, was aus der Datei herausgreift (`/Launch`, `/GoToR`, `/SubmitForm`, `/ImportData`). Jeder Posten ist einzeln abwählbar; `externalLinks` steht per Vorgabe **aus**, weil ein Link meist gewollter Inhalt ist. Zurück kommt **eine Zahl je Posten**, kein „fertig": wer zwölf Anhänge vermutet und drei entfernt bekommt, soll das sehen. Der Seiteninhalt bleibt — Annotationen, Formularfelder und Lesezeichen überleben, nur ihre Aktionen gehen. Vertrag: `docs/contracts/pdf-saeubern.md` (Abnahme steht aus). Anlass: `docs/findings/WETTBEWERB-2026-11-12-vergleich.md`, Befund 3 — BentoPDF hat das, dem Datenschutz-Produkt fehlte es
- **Die UI-Schicht wird auf dem Telefon gemessen, nicht beschrieben.** `MobileTouchTargetTests` (14 Tests über sieben Routen: keine waagerechte Überlaufkante, jedes sichtbare Bedienelement mindestens 40 px) und `MobilePageGapTests` (der Abstand zwischen zwei Blättern muss die Kopfleiste tragen). Beide messen mit `getBoundingClientRect`, nicht mit `getComputedStyle` — der Designer passt eine A4-Seite per `zoom` auf 375 px ein (gemessen 0,442), und `getComputedStyle` meldet dabei brav die 44 px der CSS-Regel, während das Element 18 px breit ist. `zoom` ist aus CSS nicht auslesbar, deshalb schreibt `applyZoom` denselben Wert zusätzlich als `--pb-zoom`

### Geändert
- **Seitenbilder liegen als Fenster um das Sichtbare, nicht als wachsende Sammlung.** Die fortlaufende Ansicht und der Vorschaustreifen halten nur Bilder in einem Fenster um die sichtbaren Seiten; was hinausfällt, wird freigegeben. Vorher wuchs `_continuousPages` über das ganze Dokument — die erste Qualitätspriorität des Projekts (WASM-OOM) stand damit bei jeder grösseren PDF auf dem Spiel. Das Raster bleibt in JS, der Transport läuft über Blob-URLs statt base64. Vertrag: `docs/contracts/seitenbilder-speicher.md`
- **MCP-Paket auf 2.2.0**, mit neun von zehn Laufzeit-Schwachstellen behoben (`npm audit fix`, nichts Brechendes: `@hono/node-server`, `@modelcontextprotocol/sdk`, `body-parser`, `fast-uri` und ihre Zulieferer). Offen bleibt **eine**: `zod < 4.6.6` (Speicherverbrauch bei übergrossen Sammlungen) — der Sprung auf 4.6.7 ist laut npm brechend und gehört zur Entscheidung über die offenen Dependabot-PRs, nicht in diesen Release
- **Telefon-Layout** für Designer-Werkzeugleiste, Split-View und Seiten-Kopfleiste: eine Zeile statt Umbruch, Fingermass statt Mausmass, eine Pane statt zwei auf schmalen Schirmen. Es bleibt in `app.src.css` als `@media`-Block plus Zustandsklasse am Wurzelelement — Entscheidung des Nutzers, begründet in `docs/plans/2026-11-08-smartphone-layout.md`

### Behoben
- **Das `/DA` einer Annotation ist eine Anweisung, kein Text.** Als `PDFHexString` geschrieben (UTF-16BE mit BOM) las PDF.js Schriftgrösse 10, Schriftname `""` und Schwarz, statt 24, `Helv` und Rot. Es ist Inhaltsstrom-Syntax und gehört als `PDFString` in die Datei. Die erste Korrektur schoss über das Ziel hinaus und schrieb alles als Hex; die Gegenprüfung lief danach gegen einen bekannt schlechten Eingang, bevor sie als bestanden galt
- **Der Schreibvorgang baute erst, nachdem er gelöscht hatte.** Eine nicht baubare Ersatz-Annotation löschte damit das Original und schrieb nichts zurück. Jetzt wird gebaut, dann ersetzt
- **Ein abgebrochenes Interop-Warten stoppt das JS-Rendern nicht.** Der .NET-Teil gab auf, die JS-Seite rechnete fertig und meldete eine Blob-URL an, die niemandem mehr gehörte. Statt eines `CancellationToken` an der Interop-Grenze entscheidet jetzt ein Generationszähler, ob ein fertiges Bild noch jemandem gehört; was nicht mehr passt, wird freigegeben. Auch jeder Dokumentwechsel dreht beide Zähler weiter und leert beide Fenster — sonst legte eine laufende Schleife ihre Bilder in ein gerade geräumtes Verzeichnis zurück
- **Das Löschen einer Anmerkung traf das falsche Dokument.** Seit die Identität aus dem `/NM`-Feld der PDF kommt, sind Ids nicht mehr dokumentübergreifend eindeutig — zwei offene PDFs mit `note1` darin, und das Löschen im einen entfernte die Anmerkung im anderen, inklusive Persistenz. `IAnnotationService.DeleteAsync` nennt jetzt die `PdfId`
- **Die Telefon-Regel für den Blattabstand war wirkungslos.** `print-document.css` steht in `index.html` nach `app.css` und setzt dort `.pb-zoom { gap: 40px }` — gleiche Spezifität, späteres Blatt, also gewinnt es; eine Medienabfrage zählt für die Spezifität nicht mit. Gemessen blieben 17,7 Schirm-Pixel zwischen zwei Blättern bei einer 44 px hohen Kopfleiste. Die Touch-Target-Prüfung konnte das strukturell nicht sehen: sie misst Kantenlängen, keine Abstände
- **Das Seitenfenster konnte unbegrenzt wachsen.** `PageWindow.Compute` spannte über alle sichtbaren Seiten; bei weit auseinanderliegenden Treffern war das Fenster beliebig breit. Es verankert jetzt auf einer Seite

### Sicherheit
- **Säubern heisst löschen, nicht abhängen.** Nimmt man nur den Namensbaum aus dem Katalog, bleibt der eingebettete Datenstrom als verwaistes Objekt in der Datei — `strings` findet ihn, jedes Reparaturwerkzeug hängt ihn wieder ein. Dasselbe gilt für den Quelltext eines Skripts und den Programmpfad einer `/Launch`-Aktion. Der Säuberer **hängt ab und fegt danach**: nach dem Durchlauf wird von den Wurzeln des Dokuments aus markiert, und jedes indirekte Objekt, das niemand mehr erreicht, verlässt die Datei. Der Umweg über eine Liste bekannter Nutzlast-Schlüssel wurde versucht und wieder verworfen — er folgte dem Ziel einer `/GoTo`-Aktion bis in den Seitenbaum und löschte die Seite, und er übersah zugleich die Ströme unter `/EF /DOS`, `/Mac` und `/Unix`
- **Ein `/URI` mit JavaScript im `/Next` ging im Normalbetrieb durch.** `externalLinks` steht per Vorgabe aus, also blieb der Link stehen — und mit ihm sein Nachfolger. Jeder Posten meldete dabei 0. Die `/Next`-Kette wird jetzt immer ganz durchlaufen, mit Gedächtnis gegen Zyklen (ein `/Next` im Kreis ist erlaubt und lief vorher in den Stapelüberlauf)
- **Formularfelder mit Kindern und Lesezeichen wurden nie besucht.** Ein Feld mit Kindern steht nur unter `/AcroForm /Fields`, nicht in `/Annots` — sein `/AA /K` blieb aktiv. Ein Lesezeichen mit `/Launch` startet beim Klick ein Programm. Beide Bäume werden jetzt begangen
- **Eine Dateianlage hängt an mehreren Stellen.** Namensbaum, `/FileAttachment`-Annotation und `/AF` — am Katalog, an einer Seite, an einem Struktur-Element, an einer Annotation, an einem XObject. pdf-lib selbst schreibt Namensbaum **und** Katalog-`/AF`. Wer nur eine Stelle abhängt, lässt die Anlage über die anderen erreichbar; wer stattdessen das Objekt löscht, lässt einen toten Verweis zurück. Ein Popup zeigt über `/Parent` auf seine Annotation zurück und hielt sie ebenfalls am Leben, deshalb wird `/FS` am Objekt gelöst
- **Das Fegen ist nur so gut wie das Markieren.** Ein Objekt, das pdf-lib nicht zerlegen konnte (`PDFInvalidObject`, etwa ein Strom mit einem `/Length`, das auf ein fehlendes Objekt zeigt — vom Format erlaubt), war für den Markierer eine Blackbox; was seine Verweise hielten, fegte der Durchgang fort. Seine Rohbytes werden jetzt nach `N M R` abgesucht, getrennt durch PDF-Zwischenraum **oder Kommentar** (§ 7.2.2/7.2.3 — beides deckt das `\s` einer JavaScript-Regex nicht ab)
- Jede dieser Prüfungen wurde zuerst an einem bekannt schlechten Eingang scheitern gelassen. Eine Prüfung, die auch auf der schmutzigen Datei „sauber" meldet, ist kein Nachweis — das ist in diesem Release zweimal passiert und beide Male aufgefallen: PDF.js' `getAttachments()` liefert für eine mit pdf-lib geschriebene Anlage ein leeres Objekt, also hätte „nachher keine Anhänge" bei **jeder** Eingabe bestanden; und eine Reproduzierbarkeitsprüfung, die zweimal in derselben Sekunde schreibt, kann ein wanderndes `/ModDate` nicht sehen

## [0.16.0-beta] — 2026-11-08

Eintritts-Release: Eine PDF kommt jetzt auch von außerhalb des Browsers in
Pagebound — „Öffnen mit" unter Windows und „Teilen → Pagebound" unter Android,
beide durch dieselbe Prüfung wie die Drop-Zone, sortiert nach Inhalt statt nach
Endung. Dazu das Vorlesen in der Sprache des Dokuments und die Voraussetzungen
für Microsoft Store und Google Play. Zwei Datenschutzbefunde sind mit drin, die
beide keine Prüfung des Projekts strukturell sehen konnte: das Vorlesen schickte
Text an Google, und `/share-target` nahm Dateien von fremden Seiten an.

### Hinzugefügt
- **PDF-Dateihandler und Teilen-Ziel — ein Eintritt für Dateien.** „Öffnen mit Pagebound" unter Windows (`file_handlers`) und „Teilen → Pagebound" unter Android (`share_target`). Beide Wege laufen durch dieselbe Prüfung wie Drop-Zone und Dateiauswahl, und sortiert wird nach **Inhalt**, nicht nach Endung oder Route: `%PDF-` öffnet, gültiges JSON wird zum Designer-Entwurf, alles andere wird mit derselben Meldung verworfen wie eine abgelehnte Drop-Datei. `boot.js` ist die einzige Stelle, die `window.launchQueue` entgegennimmt — der nimmt genau **einen** Empfänger, ein zweiter in `wysiwyg-editor.ts` hätte ihn still überschrieben, und welcher gewinnt, hätte die Ladereihenfolge der Bundles entschieden. Bei einem Dateihandler und erst recht bei einer Freigabe ist der MIME-Typ eine Behauptung des Betriebssystems (Android meldet für eine PDF regelmäßig `application/octet-stream`), deshalb bekommt die Prüfung den **geprüften** Typ statt des behaupteten; ohne das ist das Teilen auf Android schlicht kaputt. Eine Freigabe parkt der Service Worker im Cache `pb-share` und leitet auf `/reader?share=<Kennung>` um; `pb-share` trägt bewusst nicht das Präfix des Offline-Caches, deshalb übersteht eine Freigabe einen Fassungswechsel. Die Kennung wird **gezogen, nicht gezählt** (`crypto.randomUUID()`, Rückfall 16 Zufallsbytes als Hex): eine laufende Nummer fing nach jeder Abholung wieder bei 1 an, und weil Nummern vergleichbar sind, löschte ein Verweis auf `?share=999` jede Freigabe mit kleinerer Nummer. Ein liegengebliebener Eintrag wird nur gelöscht, wenn er **älter als fünf Minuten** ist — das Manifest hat kein `launch_handler`, also öffnet jede Freigabe ihren eigenen Client, und vorher räumte ein Start ohne Kennung alles weg, auch die Freigabe, auf die ein anderes Fenster gerade wartete. Ein Entwurf wird nur auf der Designer-Route geparkt und hat seine eigene Grenze (5 MB, weil er als Zeichenkette gelesen und als zweite Kopie nach .NET gereicht wird), PDFs 100 MB. Geprüft mit zwei Prüfständen, die es vorher nicht gab — `boot.js` und der Service Worker waren beide ungetestet: `boot.test.mjs` (47 Prüfungen), `service-worker.test.mjs` (26), `manifest.test.mjs` (Manifest gegen den Code, damit Pagebound nicht im Teilen-Menü steht und die Freigabe ins Leere läuft) und drei E2E-Tests mit echter Formular-Navigation auf `/share-target`
- **Vorlesen in der Sprache des Dokuments.** `loadPdf` liest `/Lang` aus dem Dokumentkatalog (PDF.js nennt es `info.Language`) und gibt es als `LoadResult.language` weiter; `PdfDocumentHandle` und `LoadDto` bekommen das Feld zusätzlich und optional, der Reader gibt es als `langHint` an `speak()`. Vorher gab es nur zwei Rateverfahren: die App-Sprache (eine deutsche Stimme las ein englisches PDF, und `u.lang` behauptete dabei Falsches) oder die Vorgabe der Plattform. Fehlt `/Lang` — der häufigere Fall —, bleibt es bei der Plattform-Vorgabe, jetzt als begründete Rückfallebene statt als Zufall. Belegt gegen **echtes** PDF.js an einem echten PDF mit eingetragenem `/Lang` (`pdfjs-bridge.test.mjs`); eine Attrappe hätte nur geprüft, dass die Brücke dasselbe Feld liest, das der Test hineingeschrieben hat
- **Store-Voraussetzungen**: maskierbares Icon, Screenshots in den von Google Play und dem Microsoft Store verlangten Formaten und die generierten Datenschutzseiten (DE/EN). Das Seitenverhältnis der Screenshots prüft `manifest.test.mjs` — der schmale Screenshot war 780×1688, also 2,16:1, und die Play Console nimmt höchstens 2:1; das wäre sonst erst bei der Einreichung aufgefallen. Die Screenshots liegen außerdem nicht mehr im Offline-Cache: rund 1,5 MB, die bei jeder Installation geladen wurden und die App nie zeigt

### Behoben
- **Das ausgelieferte Abbild war unvollständig.** `boot.js` (Boot-Bildschirm mit Drop-Zone) und `js/lazy-bridges.js` (Nachladen der großen Bridges) sind handgeschrieben und haben keine `.ts`-Quelle; `.dockerignore` schloss `wwwroot/js/*.js` aber pauschal aus, mit der Begründung, alle `.js` dort seien Build-Ergebnisse. Beide Dateien fehlten deshalb im Image. Weil nginx jede unbekannte Route per SPA-Fallback beantwortet, kam für beide `<script>`-Tags `index.html` als `text/html` mit **HTTP 200** zurück — kein 404, also auch keine Fehlermeldung. Eine aus diesem Image ausgelieferte App wäre ohne Boot-Bildschirm und ohne Lazy-Loader gestartet. Nachgewiesen am lokal gebauten Image. Live war der Fehler nie: dort lief noch ein Stand von Ende August, dessen `index.html` beide Dateien gar nicht einbindet (eine erste Meldung „auch live" beruhte auf `/js/boot.js` → `text/html` — das war nur der SPA-Fallback für eine Datei, die es dort nie gab)
- **Service Worker: umgeleitete Antworten landeten im Cache.** `cache.add()` legt die Antwort ab, wie sie kommt — auch nach einem Redirect. Eine umgeleitete Antwort darf laut Spezifikation keine Navigation beantworten, und weil `onFetch` jede Navigation genau aus diesem Cache-Eintrag (`index.html`) bedient, wäre die App für **wiederkehrende** Besucher dauerhaft tot, sobald der Server `/index.html` umleitet. Der Body wird jetzt vor dem Cachen in eine frische `Response` kopiert; die Integritätsprüfung bleibt erhalten

### Geändert
- **Kein Python mehr im Projekt:** `tools/gen-landing.py` ist durch `tools/gen-landing.mjs` ersetzt (Node, nur Builtins, wie `privacy-check.mjs`). Die Ausgabe ist byte-gleich — alle 11 erzeugten Dateien (8 Landingpages, `sitemap.xml`, `robots.txt`, `llms.txt`) stimmen mit dem eingecheckten Stand überein. Neu: die CI erzeugt sie bei jedem Lauf neu und wird rot, wenn das Eingecheckte davon abweicht — in beiden Richtungen, also auch bei einer eingecheckten Seite, die der Generator nicht mehr schreibt (umbenannter Slug: die alte Seite bliebe sonst liegen und würde weiter ausgeliefert). Fehlende oder falsch geschriebene Texte brechen den Generator ab, statt als Wort „undefined" auf der Seite zu landen; im JSON-LD wird `<` zu `<` maskiert
- **CI-E2E läuft gegen das echte Auslieferungs-Image** statt gegen `npx serve`. `serve` leitet `/index.html` per 301 auf `/index` um („cleanUrls") — zusammen mit dem gecachten Redirect oben scheiterten die Browser-Tests mit `net::ERR_FAILED`, der Job war auf `main` dauerhaft rot, ohne dass im Produktpfad etwas kaputt war. Umgekehrt hat der Wegwerf-Server den echten Fehler oben verdeckt: im Runner-Publish lagen `boot.js` und `lazy-bridges.js`, im Image nicht. Der Job baut jetzt das Image, prüft es mit `infra/docker/smoke.sh` und testet dann im Browser
- **`infra/docker/smoke.sh` prüft jedes `<script src>` aus `index.html`** darauf, dass es als JavaScript ausgeliefert wird (14 Dateien). Das fängt die ganze Fehlerklasse: der SPA-Fallback macht eine fehlende Datei als HTTP 200 unsichtbar, und Kompressions-, CSP- und Routen-Prüfungen konnten sie strukturell nicht sehen
- **E2E-Suite skippt in der CI nicht mehr still weg**: mit `PAGEBOUND_REQUIRE_SERVER=1` wird ein nicht erreichbarer Server oder Browser zum harten Fehler statt zu 14 übersprungenen Tests bei grünem Job. Lokal bleibt das Skip-Verhalten. Das gilt auch für Bedingungen innerhalb eines Tests (kein Service Worker, Dev-Build): `WebAppFixture.RequireOrSkip` statt `Skip.If`
- **Script-Prüfung in `smoke.sh` liest jede Schreibweise** (`infra/docker/script-srcs.sh`): `src='…'`, Zeilenumbruch vor `src`, Großschreibung, ohne Anführungszeichen. Ein kleiner Tokenizer liest jedes Tag mit seinen Attributen wie der Browser: „ src=" oder `<!--` im Text eines Attributs zählt nicht, ein `>` in einem Attributwert beendet das Tag nicht, Rohtext-Elemente (`script`, `style`, …) enden erst an ihrem echten End-Tag (nicht an `</scriptlet>`), Kommentare gibt es nur außerhalb von Tags. Offene Kommentare, Attribute oder Rohtext-Elemente sind ein Fehler statt einer kürzeren Liste. Der Parser deckt bewusst nur eine **strikte Teilmenge** von HTML ab: `<svg>`, `<math>`, leere oder kaputte Attributnamen, `<!…>` außer Kommentar/DOCTYPE, Kommentare mit Sonderende (`<!-->`, `<!--->`, `--!>`), `<?…>`, `<plaintext>`, `<!--` im Inhalt eines `<script>`, `&` in einem `src` und ein `<base>` mit anderem `href` als `/` lehnt er ab, statt zu raten Jedes `<script>`-Tag mit `src` muss einen lesbaren Wert liefern, sonst bricht der Smoke ab — vorher fielen solche Tags still aus der Prüfung oder es wurde eine andere Datei geprüft als die geladene. Eigener Selbsttest (`script-srcs.test.sh`) in der CI; beide Regex-Fassungen scheitern daran
- **Regressionstest für die Redirect-Härtung im Service Worker** (`RedirectingServerTests`): die CI startet neben dem Image einen zweiten Container mit einem absichtlich umleitenden server-Block (`redirect-adversary.nginx.conf`, jedes `…/index.html` → 301) und prüft, dass `index.html` nicht als umgeleitete Antwort im Cache liegt und eine Navigation **offline** über den Service Worker funktioniert (online würde nginx sie auch ohne Cache beantworten). Gegen ein Image mit dem alten Service Worker und gegen eines, dessen Service Worker nie aus dem Cache antwortet, schlägt der Test fehl
- **Datenschutzzusagen richtiggestellt**, wo sie zu absolut waren. Statt „ohne weitere Verbindung" nennt die Erklärung jetzt die Anfragen an die **eigene** Herkunft (der Service Worker prüft bei jedem Start auf eine neue Fassung, `resources/{lang}.json` kommt netz-zuerst); die Liste des Gespeicherten nennt den Cache Storage, in dem die App selbst und kurz eine geteilte Datei liegen, samt dem, was mit einer Freigabe passiert, deren Start nicht zustande kam; `SECURITY.md` sagt „keine Anfrage an Dritte" statt „kein ausgehender Request" und führt das Teilen-Ziel im Threat Model; die Datenschutzseiten nennen den Hoster als Auftragsverarbeiter. Die Seiten sind Erzeugnisse von `tools/gen-landing.mjs` — die CI erzeugt sie bei jedem Lauf neu und wird rot, wenn das Eingecheckte abweicht, also kann die Zusage dem Code nicht mehr davonlaufen

### Sicherheit
- **Das Vorlesen schickte Text an Google.** `speechSynthesis` bot alle Stimmen an, ohne auf `localService` zu filtern; in Chrome sind die „Google …"-Stimmen serverseitig, der vorgelesene Text verließ damit das Gerät. Die CSP greift dagegen nicht — die Verbindung baut der Browser, nicht die Seite —, und `privacy-check.mjs` sieht es auch nicht, weil im Quelltext keine fremde Adresse steht. Der Dateikopf von `tts-bridge.ts` behauptete dabei „100 % lokal, kein Netz". Jetzt werden ausschließlich Stimmen mit `localService === true` angeboten **und** benutzt, `u.voice` wird immer gesetzt (die Vorgabe der Engine kann eine Netz-Stimme sein), und ohne lokale Stimme wird nicht vorgelesen
- **`/share-target` nahm Dateien von fremden Seiten an.** Eine beliebige Website konnte dorthin ein Formular absenden und eine Datei mit einem Namen ihrer Wahl in das Pagebound des Nutzers schieben. Angenommen wird jetzt nur, was keinen Verweis trägt (so kommt eine echte Freigabe), `about:client`, die eigene Herkunft über http(s) oder `android-app:` — Letzteres, weil Chrome der Android-Fassung `android-app://<paket>/` mitgibt, dessen `URL.origin` die Zeichenkette `"null"` ist; eine Prüfung auf „fremde Origin" allein wies in genau der Play-Fassung **jede** Freigabe ab. Bekannte Restlücke: `referrerpolicy="no-referrer"` unterdrückt den Verweis, dann gilt die Freigabe als Freigabe des Geräts. Sie steht samt dem, was die Prüfung nicht fängt, in `SECURITY.md`; die Rückfrage vor dem Öffnen wäre eine Bedienungsentscheidung und ist offen

## [0.15.0-beta] — 2026-11-07

Ladezeit-Release: Vom ersten Aufruf bis zur bedienbaren App braucht Pagebound
bei 4G und kaltem Cache jetzt ~3,9 s und ~3,3 MB statt 12,2 s und 12,4 MB
(Messreihe: `docs/findings/MESSUNG-2026-11-05-kaltstart.md`). Dazu ein echter
Offline-Start.

### Geändert
- **Brotli-Auslieferung**: nginx liefert die vom Publish vorkomprimierten `.br`/`.gz` direkt aus (`brotli_static`/`gzip_static`). Beim Kaltstart kommen statt 11,09 MB (zstd, bisher von Caddy on-the-fly) 8,21 MB Framework an (−26 %), Blazor ist bei 4G nach 9,7 s statt ~12 s bereit. Laufzeit-Image dafür auf `alpine:3.22` mit `nginx-mod-http-brotli` umgestellt
- **Trimming (`partial`)**: statt 205 werden 49 Framework-Assemblies ausgeliefert — u. a. `System.Private.Xml` und `System.Data.Common`, die nichts in Pagebound benutzt. Kaltstart 9,45 → 4,19 MB, Blazor bereit bei 4G 10,2 → 5,0 s. Eigene Assemblies bleiben ungekürzt; neue E2E-Tests sichern die JSON-Pfade (Sprachdateien, Sidecar, IndexedDB, Designer) gegen den veröffentlichten Build ab
- **Große JS-Bridges bei Bedarf**: `pdf-manipulator`, `sign` und `pdfjs` (≈ 890 KB br, 94 % der Bridge-Bytes) lädt `js/lazy-bridges.js` erst beim ersten Aufruf und nach dem Start im Leerlauf vor — C#-Aufrufe unverändert. Blazor bei 4G nach 3,9 statt 4,9 s bereit
- **Ohne ICU** (`InvariantGlobalization`): 144–249 KB weniger beim Start, je nach Browsersprache. Library-Sortierung und Dateigrößen hängen dafür nicht mehr an der Browserkultur: Umlaute sortieren beim Grundbuchstaben (DIN 5007), Größen folgen der App-Sprache („1,5 MB“)
- **CI**: neuer Job „Docker image smoke" baut das echte Image und prüft Kompression, Header und Routen (`infra/docker/smoke.sh`)

### Behoben
- nginx hat hinter Caddy **nie** komprimiert (`gzip_proxied off` + `Via`-Header); Caddy musste jede Antwort selbst packen, `icudt_EFIGS.dat` kam sogar unkomprimiert. Jetzt `gzip_proxied any`
- woff/woff2 nicht mehr on-the-fly ge-gzipt (wurden dadurch größer)
- Werkzeugleiste über einer Markierung im oberen Seitenbereich saß bei deutsch eingestelltem Browser falsch (CSS-Wert mit Dezimalkomma)
- **Docker-Image**: Alpines nginx-Paket legt per post-install einen eigenen `default_server` an, der alles mit 404 beantwortet — im ersten Alpine-Image lieferte nginx deshalb gar nichts aus (vom neuen CI-Smoke gefunden, bevor es deployt wurde). Datei wird entfernt, unser Block ist `default_server`, `nginx -t` läuft beim Build
- **Offline-Start**: Die App zeigte offline rohe Lokalisierungsschlüssel statt Text und lud keine Schriften — der Service Worker cachte weder `resources/*.json` (der vorgesehene Offline-Rückfall wurde nie befüllt) noch `.woff2`. Jetzt beides; Sprachdateien bleiben online „Netz zuerst"

## [0.14.0-beta] — 2026-11-05

Anlass war ein ehrlicher Vergleich mit einem kleinen reinen JS-Werkzeug
(Seiten löschen, Bild-Unterschrift): Es ist sofort bedienbar, wird über Suchen
gefunden und kann Unterschriften tippen — und hatte denselben Positionsfehler
auf gedrehten Seiten wie Pagebound. Daraus vier Arbeitspakete. Dazu kommen die
seit 0.13.0 aufgelaufenen Änderungen am MCP-Server (**2.1.0**).

### Hinzugefügt
- **Unterschrift tippen**: Das Signatur-Modal hat neben „Zeichnen" einen Tab „Tippen" — Name in einer von drei Schreibschriften (Caveat, Dancing Script, Great Vibes; OFL 1.1, self-hosted), Farbe Schwarz/Blau, vorbelegt mit dem hinterlegten Unterzeichner. Ergebnis ist ein PNG, das wie eine gezeichnete Signatur platziert wird. Lädt die Schrift nicht, gibt es eine Fehlermeldung statt still eine Ersatzschrift im PNG
- **Boot-Bildschirm mit Drop-Zone**: Bis die WASM-Laufzeit geladen ist, zeigt der Start echten Ladefortschritt und nimmt schon eine PDF entgegen (Ablegen oder Auswählen, geprüft per MIME + `%PDF-`-Signatur). Sie öffnet sich im Reader, sobald er bereit ist. Bedienbar nach ~0,2 s statt 5–12 s (gemessen, siehe `docs/findings/MESSUNG-2026-11-05-kaltstart.md`)
- **Aufgaben-Landingpages** ohne WASM-Boot lesbar: `/pdf-seiten-loeschen/`, `/pdf-unterschreiben/`, `/pdf-schwaerzen/`, `/pdf-zusammenfuegen/` — mit Anleitung, FAQ, strukturierten Daten und Link ins Werkzeug; dazu `sitemap.xml` und `robots.txt`. Erzeugt von `tools/gen-landing.py`
- **MCP `pdf_ocr`**: gescannte PDFs kopflos lesen (Tesseract im Node-Prozess, ohne Canvas); fehlende Schriften im Container-Abbild ergänzt
- **Tests für die UI-Schicht**: erste bUnit-Tests in `Pagebound.Web.Tests` (Signatur-Modal), Node-Tests für die JS-Bridges (`npm test`, jetzt in der CI), E2E-Tests für den Boot-Bildschirm. `WebAppFixture` akzeptiert `PAGEBOUND_CHROMIUM` (vorhandener Browser statt Download)
- **CI**: Typecheck der JS-Bridges (`tsc --noEmit`) vor dem Bundle-Build

### Geändert
- **Designer-Renderer (MCP)**: kein Seitenumbruch direkt nach einem Tabellenkopf oder einer Überschrift mehr; Geometrie-Tests prüfen Positionen statt nur Text; Datenbindung im C#-Modell
- Ausführlichere Beschreibung und Open-Graph-Angaben in `index.html`
- nginx: `absolute_redirect off` (relative Umleitung `/pfad` → `/pfad/` hinter Caddy)

### Behoben
- **Einbrennen auf gedrehten oder beschnittenen Seiten**: Signaturen, Highlights, Notizen, Stift, Formen, Freitext, „Text bearbeiten", Stempel/Seitenzahlen und Formularfelder aus dem Formular-Builder landeten auf Seiten mit `/Rotate` 90/180/270 oder versetzter CropBox an der falschen Stelle und standen quer. Gezeichnet wird jetzt im angezeigten Raum (CropBox ∩ MediaBox, gedreht wie im Reader); 44 Tests messen die Position mit PDF.js nach
- **Service Worker** lieferte für Unterseiten mit eigenem `index.html` die App-Hülle aus („404 — Nicht gefunden" nach dem ersten Besuch); jetzt die Seite selbst, auch offline
- **MCP**: WASM-Pruning für tesseract.js zurückgenommen — es hatte `pdf_ocr` im Container zerlegt
- Versionsanzeige stand nach dem 0.13-Release noch auf 0.12

### Sicherheit
- **pdfjs-dist 6.2.108** (GHSA-hq66-cqwq-w95j, „Arbitrary JavaScript execution upon opening a malicious PDF") — betraf den tokenlosen MCP-Endpunkt und die PWA

## [0.13.0-beta] — 2026-08-27

MCP-Server **2.0.0**. Anlass war ein Anforderungskatalog aus einem
Kundenmanagementsystem, das Pagebound als Dokumentendienst einbindet:
E-Rechnungen erzeugen, signieren und in eine Hash-Kette hängen.

**Major**, weil sich bei gleichem Aufruf Verhalten ändert: andere Signaturbytes,
byte-gleich reproduzierbare Ausgabe, neue Fehlerform, neuer SubFilter.

### Hinzugefügt
- **`design_render_pdf`** — Design direkt als PDF rendern, **serverseitig und ohne Browser**: eigener pdf-lib-Renderer mit Textumbruch, Blocksatz, Listen, Tabellen (Seitenumbruch **mit wiederholter Kopfzeile**), Bildern, Formen, Mindmaps und gedrehten Overlays. Schriften (Liberation) subsetted eingebettet
- **`design_merge_data`** — Vorlage mit einem JSON-Objekt füllen: `{{pfad.zum.wert}}`, bedingte Blöcke (`when`/`unless`) und Wiederholungen (`repeat`). Fehlende Werte bleiben **nicht** still leer, sondern brechen ab oder werden mit Fundort gemeldet; Werte werden HTML-maskiert
- **Rechnungsvorlage `invoice-data`** mit allen Pflichtangaben nach § 14 UStG und **beiden** Umsatzsteuer-Fällen in *einem* Dokument (Kleinunternehmer § 19 vs. Regelbesteuerung, über bedingte Blöcke)
- **PDF/A-3b mit eingebetteten Dateien** in `pdf_to_pdfa` (`part`, `attachments`, `facturX`): EmbeddedFile-Stream, Filespec mit `/AFRelationship`, Eintrag in `/Names /EmbeddedFiles` **und** im `/AF`-Array, ZUGFeRD/Factur-X-Kennzeichnung im XMP samt Extension-Schema — die Grundlage für E-Rechnungen
- **`signingCertificateV2`** (RFC 5035) in der Zertifikatssignatur, mit `certHash` und `issuerSerial`; SubFilter jetzt **`ETSI.CAdES.detached`** (PAdES-B-B)
- **Erneutes Signieren** hängt ein **inkrementelles Update** an, statt abzulehnen — die bestehende Signatur bleibt gültig
- **Fehlervertrag**: jeder Fehler trägt eine stabile Kennung (`code`) in `structuredContent` und im Text, damit Aufrufer „Nutzer fragen" von „Eingabe korrigieren" von „Betrieb alarmieren" trennen können, ohne deutsche Fehlertexte zu parsen
- **`tools/cms-verify`** — unabhängige Gegenprobe zur PDF-Signatur mit .NET statt node-forge; prüft jede Signatur einer Datei zweimal: über die empfangenen Bytes und über die **neu nach DER kodierten** Attribute

### Geändert
- **Reproduzierbare Ausgabe**: derselbe Aufruf mit denselben Daten erzeugt dasselbe PDF, Byte für Byte. pdf-lib schrieb bei **jedem** Laden ungefragt `/ModDate` und `/Producer` mit der Systemuhr ins Info-Dict — das ist abgeschaltet; die Trailer-`/ID` wird aus dem Inhalt abgeleitet statt gewürfelt; kein Datum wird mehr erfunden (`documentDate` als Parameter); der DOCX-Export nutzt eine feste ZIP-Zeit. Bewusste Ausnahmen: `pdf_encrypt` und `pdf_sign`, beide kryptographisch bedingt
- **Serverversion** kommt aus der `package.json` statt aus einem zweiten Literal im Code (die Zahlen waren auf 1.6.0/1.5.0 auseinandergelaufen); `/healthz` meldet sie mit
- **HTTP-Body-Limit** wird aus `MCP_MAX_PDF_BYTES` abgeleitet statt separat gepflegt; ein zu großer Body ergibt sauber `413` mit `INPUT_TOO_LARGE` statt einer Express-Standardseite

### Behoben
- **Signierte CMS-Attribute standen nicht in DER-Reihenfolge.** RFC 5652 §5.4 bildet den Digest über die DER-Kodierung der signierten Attribute, und DER verlangt ein sortiertes `SET`. Adobe prüft über die empfangenen Bytes und merkt nichts davon — Prüfer, die vor dem Vergleich neu kodieren (BouncyCastle, eIDAS-Validatoren), lehnten die Signatur ab. Betraf jede bisher erzeugte Signatur, in der PWA wie im MCP-Server
- **Overlays im PDF-Renderer** landeten auf der letzten Seite eines umgebrochenen Blockflusses statt auf der ersten

## [0.12.0-beta] — 2026-07-04

Sammelrelease seit 0.11.0: fünf neue „Killer"-Werkzeuge (ohne Telemetrie, ohne
Server), aufgeräumte Reader-Bedienung und eine ganze Runde Härtung aus dem
Code-Review.

### Hinzugefügt
- **Office-Export komplett**: PDF → **XLSX** und **PPTX** (OOXML von Hand gebaut, ohne neue Abhängigkeit) — zusätzlich zum bestehenden DOCX
- **Muster-Schwärzung**: Regex/Presets (E-Mail, IBAN, Telefon …) finden Treffer automatisch und legen echte Schwärzungen an
- **Vorlesen (TTS)** im Reader über die Web-Speech-API; bei Scans ohne Textebene ausgegraut mit Hinweis auf „Text erkennen", danach wird der OCR-Text vorgelesen
- **Signatur zeichnen**: freihändige Unterschrift auf Canvas → PNG (abgegrenzt von der zertifikatsbasierten P12-Signatur)
- **Seiten-Organizer** (`/organize`): Seiten per Drag & Drop neu ordnen, drehen, löschen
- **Inline „Text bearbeiten"** im Reader: bestehende Textzeile anklicken, überdecken und neu setzen
- **Formular-Builder „Leeres Dokument"** mit Formatauswahl und „Seite hinzufügen"
- **MCP**: `pdf_to_docx` und `pdf_edit_text` (Parität zu DOCX-Export und Text-Bearbeiten)
- **Designer-Mindmap direkt editierbar**: Doppelklick auf einen Knoten benennt ihn um, ＋/× am gewählten Knoten legen Unterknoten an bzw. löschen; Zoom/Pan und zugeklappte Äste bleiben beim Bearbeiten erhalten (inkrementelles D3-Update statt Neuaufbau)

### Geändert
- **Reader-Werkzeugleiste in Kategorie-Menüs** (Zoom · Auswählen · Bearbeiten · Hinzufügen · Zeichnen · Signatur · Ansicht · Export) mit klareren Dropdowns statt gestapelter Leisten
- **Startseite verschlankt** und ruhiger im Ton
- Seitennavigation als Sticky-Bottom-Bar; aktive Toolbar-Buttons in Akzentfarben

### Behoben
- **Absturz beim Speichern** durch Endlos-Rekursion in `ReplaceAnnotation`/`RemoveAnnotation`
- Toter `<link>` auf ein nie erzeugtes Scoped-CSS-Bundle (404 → falscher MIME-Typ)
- Ghost-Drag bei schnellem Klick, Datum-Format aus i18n abgesichert, unbekannte Annotationstypen werden gemeldet statt still verworfen (aus dem Code-Review F-01…F-21)
- **Designer**: Overlay-Selektion bleibt nicht mehr auf einer entfernten/anderen Seite hängen; Einzelfolien-Ansicht kehrt nach dem Export sofort zurück; dieselbe Vorlage lässt sich erneut anwenden

### Sicherheit
- **HTML-Import gehärtet**: keine Nachlade-Requests an fremde Hosts mehr (100 % offline) und der Import-iframe führt keine Skripte aus fremden Dateien mehr aus (`allow-same-origin` ohne `allow-scripts`, Mindmap-Daten ohne `eval`) — kein Skript-Ausführungs-Pfad im App-Origin

### Infrastruktur
- **Wächter gegen externe Requests** (`tools/privacy-check`) überwacht die Web-Abhängigkeiten
- `deploy.sh` löst die GHCR-Authentifizierung selbst auf (kein manuelles `DOCKER_CONFIG`-Prefix mehr)
- `npm run typecheck` grün (0 statt 25 TS-Fehler)

## [0.11.0-beta] — 2026-06-25

Sammelrelease seit 0.9.0: neue Werkzeuge (Formular-Builder, P12-Signatur,
PDF/A & PDF/UA), Designer-HTML/Mindmaps, eine drastisch verbesserte Handy-UX
und die Bündelung der PDF-Werkzeuge in Desktop-typische Kategorie-Tabs.

### Hinzugefügt
- **Formular-Builder** als eigene Seite (`/form-builder`) sowie Anlegen von Formularfeldern (Text/Checkbox) in den Werkzeugen
- **PDF/A** (Best Effort) inkl. Liberation-Font-Einbettung und ehrlichem Warnbericht
- **PDF/UA-Kennzeichnung** (MarkInfo/Lang/DisplayDocTitle/XMP) mit Lücken-Bericht
- **Zertifikatsbasierte Signatur (P12/PFX)** — `adbe.pkcs7.detached`, abgegrenzt von der optischen Bild-Signatur
- **Designer**: HTML-Import mit Stil-Hybrid, editierbare D3-Mindmaps, interaktiver HTML-Export
- **MCP**: Mindmap-Unterstützung + interaktiver HTML-Render im Designer-MCP (jetzt 24 Tools)

### Geändert
- **Werkzeuge in Kategorie-Tabs gruppiert** (Seiten / Export / Stempel / Sicherheit / Standards) — statt ~12 gestapelter Leisten ist nur noch eine Kategorie gleichzeitig sichtbar (Desktop-App-Bedienung)
- **Drastisch verbesserte Handy-UX**: Bottom-Navigation, größere Touch-Targets, Reader und Werkzeuge final zusammengeführt

### Infrastruktur
- `deploy.sh` räumt verwaiste Docker-Images nach dem Deploy automatisch auf (`docker image prune -f`)

## [0.9.0-beta] — 2026-06-11

Pagebound ist im Alltag voll nutzbar und live unter
[pagebound.app.lupusmalus.dev](https://pagebound.app.lupusmalus.dev) (App +
gehosteter MCP-Server). Ein offizieller `1.0`-Release-Tag steht noch aus. Diese
Liste fasst den aktuellen Funktionsumfang zusammen.

### Reader & Annotation
- Viewer mit Seitennavigation, Zoom, Volltext-Suche, Outline, Thumbnails
- Nachtmodus + fortlaufende Leseansicht
- Split-View für zwei PDFs (eigene Navigation/Suche je Pane, optionales Sync-Scrollen, Text-Vergleich beider PDFs)
- Annotationen: Highlights (5 Farben), Sticky Notes mit Markdown, Stift, Formen (Rechteck/Pfeil/Linie)
- Annotationen einbrennen (Flatten) und echte Schwärzung/Redaktion (Inhalt wird physisch entfernt) — mit optionalem Audit-Report (SHA-256 vorher/nachher + Resttext-Prüfung)
- PNG-Signatur mit Hash-Integritäts-Badge

### Werkzeuge
- Seiten-Operationen: Merge, Split, Reorder, Delete, Rotate, JPEG-Komprimierung
- AcroForms ausfüllen + Formularfelder anlegen (Text/Checkbox) + Dokument-Metadaten setzen (alles in /tools), Stempeln (Wasserzeichen / Bates-Seitenzahlen)
- Bilder → PDF, Konvertierung PDF → PNG/JPG/Text/HTML/CSV (Best-Effort-Tabellen-Extraktion), Stapelverarbeitung (ZIP) mit gespeicherten Regeln
- AES-256-Verschlüsselung (WebCrypto, gegen PDF.js verifiziert)
- OCR (Tesseract.js, 100 % self-hosted — kein CDN)
- PDF-Vergleich / Text-Diff unter `/compare` und direkt in der Split-View

### Library & Export
- Automatisch erfasste Library mit Tags, Suche, drei Ansichten (Liste/Tabelle/Raster), zentralem Sidecar-Workspace
- JSON-Sidecar Export/Import, Markdown-Export (Obsidian-kompatibel, YAML-Frontmatter)

### Designer
- WYSIWYG-Block-Editor unter `/editor`: mehrseitig, Vorlagen (Rechnung § 19, DIN-5008-Brief, Flyer, 16:9-Folie), Text-/Hintergrundfarben, Seiten-Hintergrundbilder, Export als PDF/HTML/JSON
- **Design-Themes**: 6 eingebaute Presets (Klassik/Modern/Editorial/Dunkel/Frisch/Elegant) mit dokumentweiten Schriften (selbst gehostete Fonts) und Farben (Überschrift/Text/Akzent/Seite), frei anpassbar, Export/Import als JSON-Theme-Datei
- **Hintergrund-Grafiken**: Deckkraft, Ausrichtung (oben/mittig/unten), Kacheln für Muster, „auf alle Seiten übernehmen"; WebP zusätzlich zu PNG/JPG
- **Flyer-Formate**: DIN lang hoch (105 × 210 mm) und DIN A6 quer (Postkarte)
- **Undo/Redo** für Struktur-Änderungen (Blöcke/Seiten/Theme/Layout, bis 50 Schritte)
- **JSON-Import** (Roundtrip zum JSON-Export) mit DOM-basiertem HTML-Sanitizer und Werte-Validierung (nur Hex-Farben/`data:image`-URLs)
- **Überlauf-Warnung** pro Seite, wenn Inhalt das Papierformat sprengt (würde im PDF abgeschnitten)
- Schriftgröße pro Block (pt), gefüllte Rechtecke (Farbflächen); Fix: Tabellenkopf-Hintergrund griff im Editor/Druck nie (`thead`-Selektor ohne `thead`-Element)
- **Design-Ordner auf dem Ausführungssystem** (File-System-Access-API, Chromium): frei wählbarer Ordner für Designs als `*.pbdesign.json`, Handle überlebt Sessions (IndexedDB); Designs sind **Schablonen** — „Verwenden" lädt eine Kopie und lässt die Datei unangetastet, nur der explizite Modus **„Template bearbeiten"** schreibt zurück
- **5 Standard-Designs** zum Ablegen in den Ordner (Event-Flyer DIN lang, Party-Flyer dunkel, Postkarte A6, Speisekarte, Vereins-Flyer) — vorhandene Dateien werden beim Ablegen nie überschrieben
- **UI-Redesign der Bedienflächen**: alle Emojis durch stroke-basierte Inline-SVG-Icons ersetzt (folgen `currentColor`/Theme), konsistente Button-Höhen, Hover-/Fokus-/Disabled-Zustände
- **Mobile-Tauglichkeit**: Werkzeug-Seitenleiste als einblendbarer Drawer (mit Backdrop), Zoom der Seiten-Leinwand mit **Auto-Fit** (Seite passt sich der Viewport-Breite an; Druck bleibt unverändert in Originalgröße), kompaktere Bühne auf kleinen Screens
- **Drag & Drop**: Blöcke per Grip-Handle umsortieren (auch seitenübergreifend, mit Einfüge-Indikator), Seiten in der Seitenliste per Drag sortieren, Bilder direkt auf die Leinwand ziehen (werden Bild-Blöcke auf der Zielseite), JSON-/Design-Dateien per Drop importieren
- **Frei platzierbare Overlays** (Text/Bild/Fläche): Position/Größe in % der Seite, Pointer-Drag & -Resize (Maus, **Touch**, Stift), Drehung, Deckkraft, Stapel-Reihenfolge, Ellipsen — Flyer-Gestaltung über dem Block-Fluss
- **Spalten-Block** (2–4 Rich-Text-Spalten, Abstand einstellbar) und **QR-Code-Block** (lokal generiert, kein Netz)
- **Bild-Werkzeuge**: Eckenradius, Rahmen, Schatten; Bilder werden beim Einbetten automatisch komprimiert (max. 2000 px, JPEG-Re-Encode — kleinere Entwürfe/Sidecars)
- **Tastatur-Shortcuts**: Strg+S (Entwurf speichern), Strg+Z/Y (Struktur-Undo/Redo außerhalb der Textbearbeitung), Entf (Block/Overlay löschen)
- **Serie aus CSV**: Platzhalter wie `{{name}}` werden je CSV-Zeile ersetzt (Kopfzeile = Feldnamen, `,`/`;` automatisch erkannt, Werte HTML-encodiert) — Serienbriefe/-flyer als ein Mehrseiten-Dokument
- **PWA-File-Handler**: `.pbdesign.json`-Dateien lassen sich per Doppelklick direkt im Designer öffnen (installierte PWA, Chromium)

### Werkzeuge (neu)
- **Formular-Builder** (`/form-builder`): Felder (Text/Checkbox) per Klick auf gerenderten PDF-Seiten platzieren, per Pointer ziehen/skalieren (Maus/Touch/Stift), Namen editieren — Export als echtes AcroForm-PDF (ausfüllbar in jedem Reader); schließt die Roadmap-Lücke „visuelles Drag-Platzieren" (D1)
- **PDF → PDF/A (Best Effort)**: XMP-Metadaten (pdfaid 2/B), sRGB-OutputIntent (eingebettetes CC0-ICC-Profil), Entfernen von OpenAction/JavaScript/AA, optionales Formular-Flatten, Trailer-ID; **nicht eingebettete Schriften werden als Warnung gemeldet, nicht repariert** — keine Konformitätsgarantie, extern prüfen (z. B. veraPDF). In den PDF-Werkzeugen und als MCP-Tool `pdf_to_pdfa` (22 Tools)

- **PDF/A-Härtung**: Nicht eingebettete Standard-14-Schriften (Helvetica/Times/Courier) werden jetzt optional durch metrisch kompatible **Liberation-Fonts** ersetzt und eingebettet (SIL OFL 1.1, self-hosted, PWA lädt sie nur bei Bedarf) — die häufigste PDF/A-Warnung verschwindet damit; Symbol/ZapfDingbats und Sonder-Encodings bleiben ehrliche Warnungen
- **PDF/UA (Kennzeichnung + Bericht)**: setzt MarkInfo/Lang/DisplayDocTitle + XMP `pdfuaid`, prüft und meldet Tagging-Status (StructTreeRoot), Titel, Alt-Texte und ToUnicode — explizit ohne Konformitätsgarantie, echtes Tagging bleibt außerhalb des Scopes. In den PDF-Werkzeugen und als MCP-Tool `pdf_ua_prepare`
- **Zertifikatsbasierte PDF-Signatur (P12/PFX)**: klassische PDF-32000-Signatur (`adbe.pkcs7.detached`, SHA-256, CMS mit signierten Attributen) — in Adobe/Foxit prüfbar; Zertifikat und Passwort verlassen den Browser nie. In den PDF-Werkzeugen und als MCP-Tool `pdf_sign`. Ehrliche Grenzen: kein PAdES-B-T (kein Zeitstempel-Server — offline-first), kein LTV, ohne signingCertificateV2; bereits signierte PDFs werden abgelehnt
- **Vergleichsmodus startet automatisch**, sobald in der Split-View beide PDFs geladen sind (`/split?compare=1`)
- **Werkzeug-Ergebnisse zurück in den Reader**: Nach einer Aktion im „Werkzeuge"-Tab bietet ein Banner „Im Reader öffnen" an — das Ergebnis ersetzt das geöffnete Dokument ohne Datei-Dialog
- **Touch-Umsortieren von Blöcken** im Designer (Pointer-Drag am Grip-Handle mit Ziel-Markierung; Maus nutzt weiter natives Drag & Drop)
- **Bild-Zuschnitt** im Designer: vier Kanten-Regler mit Live-Vorschau (clip-path), „Anwenden" backt den Zuschnitt per Canvas ein (Undo-fähig)

### Mobile-UX (drastische Überarbeitung)
- **Daumenfreundliche Bottom-Navigation** auf dem Handy (≤940px): fixierte untere Leiste mit Start · Reader · Designer · Library · Mehr; „Mehr" öffnet die Schiene für Sekundäres (Split, Formular-Builder, Stapel) und zuletzt geöffnete Dateien — die Topbar-Hamburger entfällt dort
- **Tap-Flächen** durchgehend auf ≥40–44 px vergrößert (Buttons, Formularfelder, Nav-Einträge, Reader-/Werkzeug-Bedienflächen) — vorher waren ~70 % der interaktiven Elemente zu klein
- **Reader & Werkzeuge endgültig zusammengelegt**: `/tools` leitet auf `/reader?tab=tools` um, der standalone-Navigationseintrag entfällt — die Werkzeuge haben jetzt genau einen Ort (Reader-Subtab); die Umschaltung „Dokument | Werkzeuge" ist ein segmentierter Schalter (volle Breite auf dem Handy)
- Safe-Area-Insets (Notch/Home-Indikator) berücksichtigt

### UI-Konsolidierung
- **Split-View & Vergleich zusammengeführt**: `/compare` leitet auf die Split-View im Vergleichsmodus um (`/split?compare=1`); eine gemeinsame Diff-Engine/-Anzeige statt zweier Implementierungen, ein Navigationseintrag statt zwei
- **PDF-Werkzeuge im Reader**: Tab-Leiste „Dokument | Werkzeuge" direkt im Reader-Fenster — das geöffnete PDF wird in die Werkzeuge übernommen (kein erneutes Laden); `/tools` leitet dorthin um (Werkzeuge an einem Ort)

### MCP-Server
- Tokenloser MCP-Server für LLM-Agenten (stdio + Streamable HTTP), 24 Tools (inkl. `pdf_sign`, `pdf_to_pdfa`, `pdf_ua_prepare`), gehostet unter `…/mcp` mit Größen-/Seiten-Limits
- **Designer-Tools** (`design_catalog`, `design_create`, `design_validate`, `design_render_html`): Pagebound-Designs im PWA-kompatiblen Format (`*.pbdesign.json`) auflisten, aus Vorlagen erzeugen (Titel/Theme/Layout überschreibbar), validieren/normalisieren und als druckbares Standalone-HTML rendern

### Plattform
- Blazor WebAssembly (.NET 10), „Warm Ink"-Design (8 Akzentfarben, Hell/Dunkel, Dichte/Schriftgröße/Bewegung), DE/EN
- Offline-PWA mit sanftem Update-Hinweis (neuer Service-Worker → „Neu laden"-Banner statt stillem Stale-Cache), keine Telemetrie, keine externen Requests (CSP `connect-src 'self'`), self-hosted Fonts
- Docker + nginx Deployment, CI: Build, Unit-Tests, E2E (Playwright), Lighthouse-A11y
