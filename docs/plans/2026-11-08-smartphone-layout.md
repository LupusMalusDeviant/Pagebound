# Plan — Smartphone-Layout

**Stand:** 2026-11-08 · **Messgrundlage:** Commit `755fd87`, lokal gefahren
(`dotnet run`, In-App-Browser, Viewport 375×812, Gerät-Emulation „mobile").

## Was gemessen wurde

Jede Route einzeln bei 375×812 geladen und per DOM-Sonde ausgewertet:
waagerechter Überlauf (`documentElement.scrollWidth − innerWidth`), Anteil der
Bedienflächen unter 44 px Kantenlänge, Lage der Seitenleisten, und beim Reader
zusätzlich die senkrechte Aufteilung des Dokumentbereichs.

| Route | Überlauf | Ziele < 44 px | Bemerkung |
|---|---|---|---|
| `/` | 0 | — | in Ordnung, untere Leiste vorhanden |
| `/library` | 0 | 4 / 16 | in Ordnung |
| `/reader` (leer) | 0 | 3 / 22 | in Ordnung |
| `/reader` (Dokument offen) | 0 | 16 / 38 | **Hauptbefund, siehe unten** |
| `/editor` | 0 | 77 / 93 | **Werkzeugleiste**, Schublade funktioniert |
| `/organize` | 0 | 4 / 21 | in Ordnung |
| `/split` | 0 | 5 / 24 | zwei Spalten à 375 px und 182 px |
| `/form-builder` | 0 | 6 / 23 | leerer Zustand gemessen |
| `/batch` | 0 | 4 / 21 | in Ordnung |

**Kein Befund:** waagerechter Überlauf gibt es nirgends, die untere Navigations-
leiste ist da, `pb-segbar` und die Werkzeug-Schublade des Designers
(`DesignerPage.razor:536`, Öffner 40×40 bei 8/77) sind bewusst für kleine
Schirme gebaut und funktionieren. Pinch-Zoom ist nicht gesperrt
(`index.html:6` setzt kein `user-scalable=no`).

**Korrektur gegenüber der ersten Durchsicht:** die Designer-Seitenleiste steht
bei `left: -319px`, ist aber kein Sackgassen-Zustand — der ≡-Knopf fährt sie
ein (nachgemessen: danach `left: 0`, Breite 319). Der erste Verdacht
„unerreichbar" war falsch.

## Befund 1 — Der Reader verschenkt die halbe Seite an Bedienelemente

Bei geöffnetem Dokument misst der Dokumentbereich 1320 px Inhalt bei 743 px
Sichthöhe. Die gerenderte Seite beginnt bei **y = 630**, also nach 48 % des
Inhalts. Auf dem Telefon sieht man beim Öffnen einer PDF **keine einzige Zeile
des Dokuments**, ohne zu scrollen.

Was oberhalb der Seite liegt (gemessene Höhen):

| y | Höhe | Element |
|---|---|---|
| 0 | 63 | `pb-segbar` (Dokument / Werkzeuge) |
| 95 | 70 | Überschrift „Reader" + Beschreibungstext |
| 189 | 106 | Karte „PDF auswählen" — **bleibt stehen, obwohl schon eine PDF offen ist** |
| 311 | 128 | Such-Karte samt zwei Kontrollkästchen |
| 463 | 20 | „Ohne Titel · 1 Seiten" |
| 495 | 94 | Werkzeugleiste: acht Klappmenüs, umgebrochen auf drei Zeilen |
| 630 | 437 | die Seite (309 px breit bei 375 px Schirm) |
| 1186 | 48 | **Tastatur-Legende** („← → Seitenwechsel · Strg+F Suche …") |

Dazu: die Seite wird als `data:image/png;base64,…` eingehängt. Das ist genau
der base64-Rundlauf, vor dem die Leitplanken des Projekts warnen — auf dem
Telefon der ungünstigste Fall für den Speicher.

### Schritte [Claude-prüfbar]

1. Bei `max-width: 640px` Überschrift, Beschreibungstext und die Karte
   „PDF auswählen" ausblenden, sobald ein Dokument offen ist.
2. Die Such-Karte hinter den vorhandenen Werkzeuge-Tab legen statt dauerhaft
   über dem Dokument.
3. Die acht Klappmenüs auf dem Telefon zu einer waagerecht scrollenden Leiste
   oder einem einzigen Menü zusammenfassen.
4. Die Tastatur-Legende unter `(hover: hover) and (pointer: fine)` stellen.
5. ~~Die Seite auf die Schirmbreite einpassen (Standard-Zoom „Breite" statt
   100 %) — 309 px von 375 px sind 18 % verschenkt.~~
   **Diagnose war falsch, am 2026-11-08 nachgemessen.** Der Zoom hat damit
   nichts zu tun: der Canvas trägt `width: min(100%, <Rasterbreite>px)`, und
   auf dem Telefon löst das immer zu 100 % auf. Die Seite ist also längst
   eingepasst. Die 66 px Unterschied sind Innenabstand — 2×16 px am Abschnitt
   (`px-4`), 2×16 px an der Figur (`p-4`), 2×1 px Rahmen. Ein anderer
   Standard-Zoom hätte nur die Rasterauflösung verändert, nicht die Breite.
   Umgesetzt wurde stattdessen: bei offenem Dokument holt die Bühne unter
   640 px den Abstand des Abschnitts über negative Ränder zurück und die Figur
   gibt ihren bis auf 8 px her. Gemessen 357 px statt 309.
6. Gegenprobe: dieselbe Sonde erneut fahren, `chromeHoeheVorSeite` muss unter
   die Sichthöhe fallen. Ein Befund, den diese Prüfung findet: käme die
   Überschrift zurück, stiege der Wert wieder über 743.

### Nicht in diesem Schritt

Den base64-Rundlauf durch `Blob`-URL zu ersetzen ist eine Änderung am
Render-Pfad, kein Layout. Gehört in ein eigenes Bean (Speicher/WASM-OOM hat im
Projekt ohnehin Vorrang vor Layout).

## Befund 2 — Die Designer-Werkzeugleiste ist auf Fingerbedienung nicht ausgelegt

77 von 93 Bedienflächen liegen unter 44 px. Die Leiste belegt rund 250 px der
812 px Schirmhöhe, bevor das Dokument anfängt. Die Farbfelder sind als kleine
Kreise ausgelegt, die Zoom-Auswahl als schmales `select`.

Dazu ein Text-Fehler: der leere Zustand sagt „füge **links** Blöcke hinzu" —
auf dem Telefon gibt es kein Links, sondern den ≡-Knopf.

### Schritte [Claude-prüfbar]

1. `.btn-fmt` und die Farbfelder unter `max-width: 640px` auf mindestens
   44 × 44 px setzen.
2. Die Leiste auf dem Telefon waagerecht scrollen lassen, statt auf vier Zeilen
   umzubrechen.
3. Den leeren Zustand zweisprachig umformulieren, ohne Richtungsangabe
   („Blöcke über ≡ hinzufügen").
4. Gegenprobe: Sonde auf `/editor`, der Anteil unter 44 px muss deutlich
   fallen; die Höhe der Leiste oberhalb des Dokuments ebenfalls.

## Befund 3 — Split-View zeigt zwei Spalten auf einem Telefon

Gemessen: 375 px und 182 px nebeneinander. Zwei PDF-Seiten nebeneinander auf
einem Telefon sind keine nutzbare Ansicht.

### Schritte [Claude-prüfbar]

1. Unter `max-width: 860px` auf eine Spalte mit Umschalter (A / B) stellen,
   statt nebeneinander.
2. Gegenprobe: Sonde auf `/split`, es darf nur noch eine Spalte > 300 px geben.

## Befund 4 — Die Markup-Schicht ist durchgehend für den Schreibtisch geschrieben

| Datei | Zeilen | Responsive-Präfixe (`sm:`/`md:`/`lg:`/`xl:`) |
|---|---|---|
| `ReaderPane.razor` | 4397 | 4 |
| `DesignerPage.razor` | 2635 | 2 |
| `PdfToolsPanel.razor` | 1708 | 8 |
| `MainLayout.razor` | 294 | 0 |

Das Telefon-Verhalten steckt fast vollständig in 13 handgeschriebenen
`@media`-Blöcken in `app.src.css`. Das erklärt, warum die Shell (Startseite,
untere Leiste, `pb-segbar`) sauber ist und die beiden großen Arbeitsflächen
nicht: sie wurden nie angefasst.

### Schritt [braucht Nutzer]

Entscheidung, ob die Arbeitsflächen Telefon-Varianten im Markup bekommen oder
weiter über `app.src.css` bedient werden. Das ist eine Stil-Entscheidung über
die ganze UI-Schicht, keine Einzelkorrektur.

## Prüfliste für den Nutzer

1. Auf einem echten Telefon gegenprüfen — die Messung lief in der Emulation,
   nicht auf Android/iOS. Besonders: Pinch-Zoom im Reader, die sichere Zone
   unten (`viewport-fit=cover`), und ob die untere Leiste die Seiten-Navigation
   verdeckt.
2. Entscheiden, ob der Reader auf dem Telefon beim Öffnen direkt in eine
   Vollbild-Leseansicht springen soll (Bedienelemente erst auf Tippen).
3. Befund 4 beantworten.
