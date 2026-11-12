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

## Das Problem

Eine PDF kann weit mehr mitbringen als Seiten: JavaScript, das beim Öffnen
läuft, eingebettete Dateien, Aktionen an Formularfeldern, Verweise auf fremde
Dokumente. Wer eine PDF weitergibt, gibt das alles mit — und sieht es nicht.

`pdf_set_metadata` gibt es schon, das deckt nur `/Info` ab.

## Was entfernt wird, je Posten abwählbar

| Posten | Vorgabe | Was dahinter steckt |
|---|---|---|
| `javascript` | **an** | `/Names /JavaScript` (Namensbaum), `/OpenAction` mit `/S /JavaScript`, `/AA` am Katalog und an Seiten |
| `embeddedFiles` | **an** | `/Names /EmbeddedFiles`, `/FileAttachment`-Annotationen, `/EF` an Dateianlagen |
| `metadata` | **an** | alle `/Info`-Felder ausser `/Producer`, dazu der XMP-Strom `/Metadata` am Katalog |
| `annotationActions` | **an** | `/A` und `/AA` an Annotationen und Formularfeldern (nicht die Annotation selbst) |
| `launchActions` | **an** | `/Launch`, `/GoToR`, `/SubmitForm`, `/ImportData` — alles, was aus der Datei herausgreift |
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
