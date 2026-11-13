# Vertrag: PDF säubern (`pdf_sanitize`)

Status: **Entwurf, Abnahme steht aus** · 2026-11-13 · Bean `PDF-Tool-yr52` ·
betrifft `mcp/src/sanitize.ts` (neu), `mcp/src/index.ts`

Anlass: `docs/findings/WETTBEWERB-2026-11-12-vergleich.md`, Befund 3. BentoPDF
hat „Sanitize PDF"; dem Datenschutz-Produkt fehlt es.

> **Hinweis zur Abnahme.** Dieser Vertrag entstand in einem autonomen Nachtlauf
> auf die Anweisung „erweitere den MCP". Er ist gebaut und geprüft, aber nicht
> abgenommen. Weicht die Absicht ab, wird zuerst dieser Text geändert.
>
> **Nachtrag 1 (bei der Umsetzung, 2026-11-13).** Zwei Dinge stellten sich
> heraus, die der Entwurf nicht vorhergesehen hatte:
>
> 1. **Abhängen reicht nicht, gelöscht werden muss.** Nimmt man nur den
>    Namensbaum aus dem Katalog, bleibt der eingebettete Datenstrom als
>    verwaistes Objekt in der Datei stehen — `strings` findet ihn, jedes
>    Reparaturwerkzeug hängt ihn wieder ein. Dasselbe gilt für den Quelltext
>    der Skripte und den Pfad einer `/Launch`-Aktion. Für ein Werkzeug, dessen
>    ganzer Zweck „das ist jetzt raus" ist, wäre das die falsche Art von
>    Sauberkeit. **Festlegung: die Objekte selbst werden aus dem Dokument
>    gelöscht, nicht nur ihre Verweise.** Der Selbsttest weist das im Klartext
>    nach (`notiz.txt`, `app.alert`, `calc.exe`).
>
> 2. **PDF.js taugt beim Anhang nicht als Zeuge.** `getAttachments()` liefert
>    für eine PDF, die pdf-lib mit `attach()` geschrieben hat, ein leeres
>    Objekt — gemessen auch ohne Objektströme und ohne jedes Zutun von uns.
>    Ein „nachher keine Anhänge" über PDF.js wäre damit eine Prüfung, die bei
>    jeder Eingabe besteht und den Fehler strukturell nicht sehen kann. Für
>    diesen einen Posten tritt deshalb eine Klartextprüfung an seine Stelle:
>    unkomprimiert aufschreiben und nachsehen. Schwächer als ein zweiter
>    Parser, aber unabhängig von `sanitize.ts` — und sie **kann** fehlschlagen,
>    was Schritt 1 der Gegenprobe jedes Mal zeigt. Für JavaScript bleibt
>    PDF.js der Zeuge; dort findet es die Skripte zuverlässig.

> **Nachtrag 2 (nach der dritten Codex-Runde, 2026-11-13).** Fünf der acht
> Befunde trafen diesen Vertrag. Alle fünf waren Fälle, in denen der Code
> weniger tat, als hier steht — nicht Fälle, in denen der Vertrag falsch war.
> Festgehalten, weil die Zusage jetzt weiter reicht als die erste Umsetzung:
>
> 1. **Die `/Next`-Kette wird immer geprüft, nicht nur bis zum ersten Treffer.**
>    Eine Aktion, die aus eigenem Recht bleiben darf, kann einen Nachfolger
>    haben, der es nicht darf. `externalLinks` steht per Vorgabe AUS — ein
>    `/URI` mit JavaScript im `/Next` ging deshalb **im Normalbetrieb** durch,
>    und jeder Posten meldete dabei 0. Ein `/Next`, das im Kreis zeigt, ist
>    erlaubt und endete vorher im Stapelüberlauf; die Kette hat jetzt ein
>    Gedächtnis.
> 2. **Formularfelder und Lesezeichen gehören zum Umfang.** Die Tabelle nennt
>    „Aktionen an Formularfeldern" seit dem Entwurf, besucht wurden aber nur
>    Katalog, Seiten und Seiten-Annotationen. Ein Feld mit Kindern steht nur
>    unter `/AcroForm /Fields`, nicht in `/Annots` — sein `/AA /K` blieb aktiv.
>    Lesezeichen (`/Outlines`) standen überhaupt nicht im Vertrag; ein
>    Lesezeichen mit `/Launch` startet beim Klick ein Programm. **Festlegung:**
>    beide Bäume werden begangen. An einem Lesezeichen fällt nur, was aus
>    eigenem Recht fällt — ein `/GoTo` ist das, wofür Lesezeichen da sind.
> 3. **Nachtrag 1, Punkt 1 reicht tiefer, als er beschrieben war.** Gelöscht
>    wurde das Aktionsobjekt und der Strom unter `/EF`. Ein `/JS` als
>    indirekter **Strom**, die Objekte einer `/Next`-Kette und der XMP-Strom am
>    Katalog blieben als Klartext stehen. Gelöscht wird jetzt entlang der
>    Schlüssel `/JS`, `/Next`, `/F`, `/UF`, `/D`, `/Win` und `/EF`.
> 4. **`/Info` heisst alle Schlüssel, nicht eine Liste.** Die Umsetzung hatte
>    acht feste Feldnamen. `/Customer`, `/Matter`, `/SAP_DocID` sind erlaubte
>    eigene Felder — sie blieben stehen und wurden mit 0 gemeldet. Gelaufen
>    wird jetzt über die tatsächlichen Schlüssel.
> 5. **Gezählt wird je Aktion, nicht je Träger.** Ein `/AA`-Bündel mit drei
>    Skripten meldete `javascript: 1`. Eine Zahl, die nicht zählt, verfehlt
>    den erklärten Zweck des Berichts. Damit fällt auch die frühere
>    Festlegung „entfernt wird das ganze Bündel, sobald einer davon fällt":
>    **jeder Auslöser wird einzeln geprüft, einzeln entfernt und einzeln
>    gezählt.** Harmlose Auslöser an Katalog und Seite bleiben stehen. Ein
>    Widget, das in `/Annots` UND in `/AcroForm /Fields` steht, zählt einmal.

> **Nachtrag 3 (nach der vierten Codex-Runde, 2026-11-13).** Die Runde prüfte
> die Korrekturen aus Nachtrag 2 und fand drei Rückschläge — alle drei in
> derselben Entscheidung: **Löschen entlang einer Liste bekannter
> Nutzlast-Schlüssel.** Diese Entscheidung wird zurückgenommen.
>
> Sie war in beide Richtungen falsch. Sie **riss zu viel mit**: das Ziel einer
> `/GoTo`-Aktion steht unter `/D` und ist eine **Seite** — eine `/GoTo`-Aktion
> mit JavaScript im `/Next` löschte damit die Seite aus dem Dokument (gemessen:
> PDF.js meldete danach zwei Seiten ohne Text). Dasselbe traf ein
> Aktionsobjekt, das sich zwei Stellen teilen: der `/Next`-Nachfolger einer
> entfernten Aktion verschwand auch dort, wo er bleiben durfte, und liess einen
> toten Verweis zurück. Und sie **übersah zugleich**: `/EF` kennt neben `/F`
> und `/UF` auch `/DOS`, `/Mac` und `/Unix` — ein Anhang darunter blieb im
> Klartext stehen, obwohl der Bericht ihn als entfernt meldete.
>
> **Festlegung: der Durchlauf hängt nur ab, gelöscht wird danach durch Fegen.**
> Nach dem Abhängen wird von den Wurzeln des Dokuments aus markiert, und jedes
> indirekte Objekt, das niemand mehr erreicht, verlässt die Datei. Das trifft
> die Nutzlast ohne Vorannahme darüber, wo eine PDF sie ablegt, und es lässt
> alles stehen, was noch jemandem gehört. **Verwaiste Objekte, die schon beim
> Laden niemandem gehörten, gehen mit** — für ein Säuberungswerkzeug ist das
> kein Nebeneffekt: ein verwaistes Objekt kann eine frühere Fassung des
> Seiteninhalts enthalten.
>
> Zwei Folgefestlegungen:
>
> 1. **Zählen heisst zählen, auch in der Kette.** Zwei verkettete Skripte
>    verschwanden beide, gemeldet wurde `1`. Eine gemischte Kette
>    (`/URI` → JavaScript → `/Launch`) meldete `javascript: 1,
>    launchActions: 0`. Gezählt wird jetzt **jede verbotene Aktion der Kette
>    unter ihrer eigenen Kategorie**, jedes Aktionsobjekt genau einmal. Eine
>    Aktion, die nur als Vorspann mitfällt (der `/URI` oben), wird nicht
>    gezählt: gezählt werden die Funde, nicht die Kollateralschäden.
> 2. **`/AF` gehört dazu.** Eine Dateianlage hängt oft an zwei Stellen: im
>    Namensbaum `/EmbeddedFiles` **und** in `/AF` (associated files) am
>    Katalog oder an einer Seite — pdf-lib selbst schreibt beides. Wer nur den
>    Namensbaum abhängt, lässt die Anlage über `/AF` erreichbar; wer das Objekt
>    stattdessen löscht, lässt in `/AF` einen toten Verweis zurück (das tat die
>    Fassung aus Nachtrag 2, unbemerkt). Beide Wege werden abgeräumt, die
>    Anlage zählt dabei **einmal**.

## Das Problem

Eine PDF kann weit mehr mitbringen als Seiten: JavaScript, das beim Öffnen
läuft, eingebettete Dateien, Aktionen an Formularfeldern, Verweise auf fremde
Dokumente. Wer eine PDF weitergibt, gibt das alles mit — und sieht es nicht.

`pdf_set_metadata` gibt es schon, das deckt nur `/Info` ab.

## Was entfernt wird, je Posten abwählbar

| Posten | Vorgabe | Was dahinter steckt |
|---|---|---|
| `javascript` | **an** | `/Names /JavaScript` (Namensbaum), `/OpenAction` mit `/S /JavaScript`, `/AA` am Katalog, an Seiten, an Annotationen und an Formularfeldern |
| `embeddedFiles` | **an** | `/Names /EmbeddedFiles`, `/AF` (associated files) am Katalog und an Seiten, `/FileAttachment`-Annotationen, `/EF` an Dateianlagen (auch `/DOS`, `/Mac`, `/Unix`) |
| `metadata` | **an** | **alle** `/Info`-Schlüssel ausser `/Producer` (auch eigene wie `/Customer`), dazu der XMP-Strom `/Metadata` am Katalog |
| `annotationActions` | **an** | `/A` und `/AA` an Annotationen und Formularfeldern, ausser `/GoTo` und `/URI` (nicht die Annotation selbst) |
| `launchActions` | **an** | `/Launch`, `/GoToR`, `/SubmitForm`, `/ImportData` — alles, was aus der Datei herausgreift, auch an Lesezeichen |
| `externalLinks` | **aus** | `/URI`-Aktionen. Bewusst standardmässig AUS: ein Link ist meist gewollter Inhalt, kein Angriff |

**Was ausdrücklich bleibt:** der Seiteninhalt, die Annotationen selbst (nur
ihre Aktionen gehen), Formularfelder und ihre Werte, Lesezeichen, die
Seitenreihenfolge. Säubern ist kein Flachklopfen.

## Die Rückmeldung ist eine Zahl je Posten, kein „fertig"

```ts
interface SanitizeReport {
  javascript: number;
  embeddedFiles: number;
  metadata: number;
  annotationActions: number;
  launchActions: number;
  externalLinks: number;
}
```

Wer zwölf Anhänge vermutet und drei entfernt bekommt, muss das sehen. Ein
blosses „gesäubert" wäre an dieser Stelle wertlos — es ist nicht nachprüfbar,
ohne die Datei selbst zu zerlegen.

## Reproduzierbarkeit

Gleiche Eingabe → byte-gleiche Ausgabe (MCP-Zusage seit 2.0.0). Kein Zugriff
auf die Systemuhr, keine Zufalls-Ids, `updateMetadata: false` beim Laden.

`/Producer` bleibt stehen, auch wenn `metadata` an ist: pdf-lib schreibt es
beim Speichern ohnehin, und ein Feld zu entfernen, das gleich wieder entsteht,
wäre eine Lüge in der Zahl.

## Fehlerkennungen

Wie alle Werkzeuge dieses Pakets: `PDF_CORRUPT`, `PDF_ENCRYPTED`,
`PAGE_LIMIT`, `INVALID_INPUT`. Der Wächter `pdf.assertLoadable` geht voran.

## Gegenprobe — ohne sie gilt der Vertrag als nicht erfüllt

Die gelernte Regel: prüfe mit einem Signal, das den Fehler auch finden könnte.
Der eigene Entferner ist kein Nachweis dafür, dass nichts mehr da ist.

1. **Fremder Leser, nicht der eigene.** Die gesäuberte Datei wird mit **PDF.js**
   gelesen, nicht mit pdf-lib: `getJSActions()` muss leer sein. Beim Anhang
   tritt die Klartextprüfung an diese Stelle (Nachtrag 1, Punkt 2).
2. **Erst an einem bekannt schlechten Eingang scheitern lassen.** Dieselbe
   Prüfung läuft vor der Säuberung gegen dieselbe Datei und muss dort
   JavaScript und Anhang **finden**. Eine Prüfung, die auch auf der
   schmutzigen Datei „sauber" meldet, ist kein Nachweis.
3. **Abwählbarkeit wirklich prüfen.** Mit `javascript: false` muss das Skript
   nachweisbar noch da sein — sonst entfernt der Code mehr, als er darf.
4. **Der Inhalt bleibt.** Seitenzahl und extrahierter Text sind vorher und
   nachher gleich.
5. **Reproduzierbarkeit.** Zweimal säubern mit Abstand, Bytes vergleichen.

## Was dieser Vertrag nicht berührt

Die Datenschutzzusage (lokale Dateiarbeit, kein Netzaufruf), den Krypto-Layer
und die Interface-First-DI-Struktur. Das Werkzeug-Panel im Reader ist **nicht**
Teil dieses Vertrags — hier geht es um das MCP-Werkzeug; die Oberfläche folgt
als eigener Schritt (Bean `PDF-Tool-yr52`).
