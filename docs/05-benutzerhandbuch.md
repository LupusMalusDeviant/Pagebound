# Pagebound — Benutzerhandbuch

Pagebound ist ein schlanker, datenschutzfreundlicher PDF-Reader und -Editor, der
**vollständig in deinem Browser** läuft. Es gibt keinen Server, keine Konten und
keine Telemetrie: Deine Dokumente verlassen dein Gerät nicht. Dieses Handbuch
beschreibt alle Funktionen von Version 1.0.

> **Kurzfassung:** PDF öffnen → lesen, suchen, annotieren → Seiten bearbeiten,
> konvertieren, verschlüsseln → alles bleibt lokal. Annotationen werden
> automatisch in einer **Sidecar-Datei** neben dem PDF gespeichert.

## Inhalt

1. [Erste Schritte](#1-erste-schritte)
2. [Lesen (Reader)](#2-lesen-reader)
3. [Suche & OCR](#3-suche--ocr)
4. [Annotationen](#4-annotationen)
5. [Formulare](#5-formulare)
6. [Bibliothek](#6-bibliothek)
7. [Split-Ansicht](#7-split-ansicht)
8. [Werkzeuge: Seiten bearbeiten](#8-werkzeuge-seiten-bearbeiten)
9. [Bilder → PDF](#9-bilder--pdf)
10. [Konvertieren](#10-konvertieren)
11. [Verschlüsselung](#11-verschlüsselung)
12. [Stapelverarbeitung](#12-stapelverarbeitung)
13. [Workspace & Sidecar-Dateien](#13-workspace--sidecar-dateien)
14. [Darstellung & Einstellungen](#14-darstellung--einstellungen)
15. [Tastaturkürzel](#15-tastaturkürzel)
16. [Datenschutz & Sicherheit](#16-datenschutz--sicherheit)
17. [Browser-Unterstützung & Grenzen](#17-browser-unterstützung--grenzen)

---

## 1. Erste Schritte

Pagebound ist eine **PWA** (Progressive Web App). Du rufst sie im Browser auf und
kannst sie optional über das Browser-Menü „Installieren" als App-Fenster
ablegen — sie funktioniert danach auch offline.

**Ein PDF öffnen:**

- Auf der Startseite **„Reader öffnen"** wählen oder oben in der Schiene den
  Eintrag **02 · Reader**.
- Im Reader auf **„PDF öffnen"** klicken und eine Datei wählen.

In Chromium-Browsern (Chrome, Edge, Brave, …) merkt sich Pagebound die Datei-
Referenz, sodass sie später aus der **Bibliothek** mit höchstens einer kurzen
Rückfrage wieder geöffnet werden kann — ohne erneuten Datei-Dialog. In Firefox
und Safari wird die Datei klassisch geladen.

Alle weiteren Funktionen erreichst du über die nummerierte Schiene links:

| Nr. | Bereich   | Inhalt |
|-----|-----------|--------|
| 01  | Start     | Übersicht & Einstieg |
| 02  | Reader    | Lesen, Suchen, Annotieren |
| 03  | Werkzeuge | Seiten bearbeiten, Konvertieren, Verschlüsseln, Bilder→PDF |
| 04  | Split     | Zwei PDFs nebeneinander |
| 05  | Stapel    | Mehrere PDFs auf einmal verarbeiten |

Im Lesemodus klappt die Schiene automatisch ein, damit du mehr Platz hast; der
**☰**-Knopf oben links blendet sie jederzeit wieder ein.

---

## 2. Lesen (Reader)

Der Reader zeigt das PDF seitenweise. Über der Seite findest du die Steuerung:

- **Blättern:** Knöpfe „Zurück" / „Weiter" oder die [Tastaturkürzel](#15-tastaturkürzel).
- **Zoom:** feste Stufen (50–200 %) oder per Tastatur (`Strg` + `+` / `-` / `0`).
- **Gliederung (Outline):** zeigt das PDF-Inhaltsverzeichnis, sofern vorhanden —
  Klick auf einen Eintrag springt zur Seite.
- **Miniaturen (Thumbnails):** Seitenübersicht zum schnellen Springen.

Der Text liegt als unsichtbarer, exakt positionierter **Text-Layer** über dem
Seitenbild. Dadurch kannst du Text mit der Maus markieren, kopieren und der
Browser/​die Suche findet ihn.

---

## 3. Suche & OCR

- **Volltextsuche:** Suchfeld öffnen (`Strg`+`F`), Begriff eingeben — Treffer
  erscheinen als Liste mit Textausschnitt; ein Klick springt zur Fundstelle.
- Optionen **„Groß-/Kleinschreibung"** und **„Ganzes Wort"** verfeinern die Suche.
- **`Esc`** leert die Suche wieder.

**Kein Text-Layer?** Manche PDFs (z. B. Scans oder rein vektorisierte Design-PDFs)
enthalten keinen durchsuchbaren Text. Dann bietet Pagebound **OCR** (Texterkennung
per Tesseract.js) an. Beim ersten OCR-Klick wird einmalig ein Sprachmodell aus dem
Netz nachgeladen (siehe [Datenschutz](#16-datenschutz--sicherheit)); danach ist die
Seite durchsuchbar.

---

## 4. Annotationen

Annotationen werden **sofort automatisch gespeichert** — in einer Sidecar-Datei
bzw. lokal im Browser (siehe [Sidecar](#13-workspace--sidecar-dateien)). Das
Original-PDF bleibt unangetastet.

| Werkzeug | Beschreibung |
|----------|--------------|
| **Markierung (Highlight)** | Text im Dokument markieren → wird farbig hinterlegt. |
| **Notizzettel (Sticky Note)** | Punkt auf der Seite setzen, Notiz schreiben. Unterstützt **Markdown** (fett, kursiv, Listen, Links). |
| **Stift** | Freihand-Zeichnung mit der Maus/​dem Stift. |
| **Formen** | Rechteck, Pfeil oder gerade Linie aufziehen. |
| **Signatur** | Ein PNG-Bild (z. B. deine Unterschrift) auf der Seite platzieren, verschieben und in der Größe ändern. |

Für Stift und Formen lassen sich **Farbe** und **Strichstärke** wählen. Ausgewählte
Annotationen kannst du bearbeiten oder löschen. Notizen sind über die Notizliste
auffindbar und lassen sich per [Markdown-Export](#13-workspace--sidecar-dateien)
zusammen exportieren (Obsidian-freundlich).

---

## 5. Formulare

Enthält ein PDF interaktive Formularfelder (Text, Kontrollkästchen, Optionsfelder,
Auswahl-/Listenfelder), zeigt der Reader ein **Formular-Panel**:

- Felder ausfüllen — ein Klick auf den Feldnamen springt zur zugehörigen Seite.
- **Speichern** erzeugt ein neues PDF mit deinen Eingaben.
- Optional **„abflachen" (flatten)**: Die Felder werden fest ins Dokument
  eingebrannt und sind danach nicht mehr editierbar.

---

## 6. Bibliothek

Die Bibliothek sammelt deine geöffneten PDFs mit Tags, Lesefortschritt und
Metadaten. Drei Ansichten stehen bereit:

- **Liste** — kompakt, mit voller Tag-Bearbeitung.
- **Tabelle** — Spalten für Titel, Seiten, Größe, Tags, Hinzugefügt, Zuletzt geöffnet.
- **Raster** — Karten mit Vorschau-Platzhalter.

Du kannst **suchen** (Titel, Dateiname, Autor, Tags), nach **Tags filtern** und
nach *Zuletzt geöffnet*, *Hinzugefügt* oder *Titel* **sortieren**. Die zuletzt
geöffneten Dokumente erscheinen auch links in der Schiene unter „Sammlung".

Einträge werden lokal (IndexedDB) gehalten; das Identitätsmerkmal eines Dokuments
ist sein **SHA-256-Hash** — dasselbe PDF wird wiedererkannt, auch wenn die Datei
umbenannt wurde.

---

## 7. Split-Ansicht

Unter **04 · Split** öffnest du **zwei PDFs nebeneinander** — praktisch zum
Vergleichen oder für Quelle + Notizdokument.

- Die **Trennlinie** in der Mitte lässt sich mit Maus/​Touch verschieben (15–85 %).
- Der Schalter **„Synchron scrollen"** spiegelt die Scroll-Position proportional
  zwischen beiden Seiten — auch bei unterschiedlich langen Dokumenten.

---

## 8. Werkzeuge: Seiten bearbeiten

Unter **03 · Werkzeuge** ein PDF wählen → es erscheint eine Seitenübersicht. Damit
kannst du:

- Seiten **auswählen** (einzeln oder „Alle"/„Keine").
- Ausgewählte Seiten **drehen** (±90°) oder **löschen**.
- Eine andere PDF **anhängen** (zusammenführen).
- Seiten per **Drag & Drop neu anordnen**.
- **Teilungspunkte** setzen, um das PDF in mehrere Dateien zu splitten.
- Mit **Speichern** das bearbeitete PDF herunterladen.

Alle Operationen laufen lokal über pdf-lib im Browser; das Original wird nicht
verändert, du erhältst eine neue Datei.

---

## 9. Bilder → PDF

Die Karte **„Bilder → PDF"** erstellt aus PNG/JPG-Bildern ein PDF — je Bild eine
Seite. Reihenfolge per **Drag & Drop**, Seitengröße wählbar (Bildgröße / A4 /
Letter, Bild wird eingepasst). Ergebnis: `bilder.pdf`.

---

## 10. Konvertieren

Die Leiste **„Konvertieren"** wandelt das geladene PDF um:

| Format | Ergebnis |
|--------|----------|
| **PNG** | je Seite ein Bild, gepackt als ZIP |
| **JPG** | je Seite ein Bild, gepackt als ZIP |
| **Text (.txt)** | reiner Text, Seiten durch Seitenumbruch getrennt |
| **HTML** | jede Seite als eingebettetes Bild → pixelgenau, offline öffenbar |

Die Konvertierung erfolgt vollständig im Browser; nichts wird hochgeladen.

---

## 11. Verschlüsselung

Auf **03 · Werkzeuge** ein Passwort eingeben und das PDF verschlüsseln. Pagebound
nutzt **AES-256** nach ISO 32000-2 (`/V 5 /R 6`) über die hardware-beschleunigte
WebCrypto-API des Browsers. Das Ergebnis (`<name>.encrypted.pdf`) lässt sich in
jedem standardkonformen PDF-Reader mit dem Passwort öffnen.

> **Wichtig:**
> - Alle Schlüssel- und Zufallswerte stammen aus dem kryptographisch sicheren
>   Zufallsgenerator des Browsers.
> - Verschlüsselt werden die **Seiteninhalts-Ströme**. String-Objekte (z. B.
>   Titel, Lesezeichen) bleiben in dieser Version im Klartext.
> - Passwörter werden nicht SASLprep-normalisiert — bei nicht-ASCII-Passwörtern
>   kann es Interop-Nuancen mit anderen Readern geben. Verwende für maximale
>   Kompatibilität ein ASCII-Passwort.
> - **Es gibt keine Passwort-Wiederherstellung.** Vergisst du das Passwort, ist
>   das Dokument nicht mehr zu öffnen.

---

## 12. Stapelverarbeitung

Unter **05 · Stapel** mehrere PDFs auf einmal wählen und **eine Operation**
anwenden:

- **Komprimieren**
- **Verschlüsseln** (ein Passwort für alle Dateien)
- **Komprimieren + Verschlüsseln** (verkettet)
- **→ Text** (jede PDF als `.txt`)

Alle Ergebnisse landen gebündelt in einer ZIP-Datei (`pagebound-batch.zip`, eine
Ausgabe je Eingabe). Auch das passiert komplett lokal.

---

## 13. Workspace & Sidecar-Dateien

**Sidecar-Dateien** sind das Herz von Pagebounds Datenmodell: Annotationen,
Tags, Lesefortschritt und Metadaten liegen **nicht im PDF**, sondern in einer
begleitenden JSON-Datei. Das PDF bleibt damit unverändert und portabel.

- **Export/Import:** Eine Sidecar lässt sich exportieren und woanders wieder
  einlesen — so nimmst du deine Annotationen mit.
- **Markdown-Export:** Notizen lassen sich als Markdown ausgeben
  (Obsidian-Integration, FA-080).

**Zentraler Workspace (optional, Chromium-Browser):** Über **„Ordner wählen"** in
der Bibliothek bestimmst du *einen* Ordner, in dem alle Sidecars zentral liegen
(`{hash}.pagebound.json`), unabhängig vom Speicherort der PDFs. Öffnest du ein
PDF, prüft Pagebound diesen Ordner automatisch und führt vorhandene Annotationen
zusammen (Duplikate werden anhand ihrer Id vermieden). Der gewählte Ordner bleibt
über Neustarts erhalten (mit höchstens einer dezenten Browser-Rückfrage pro
Sitzung).

In Browsern ohne File-System-Access-API (Firefox, Safari) ist die Workspace-Leiste
ausgeblendet; dort nutzt du den Export/Import-Weg.

---

## 14. Darstellung & Einstellungen

Über das **Zahnrad** oben rechts öffnest du die Einstellungen („Tweaks"):

- **Darstellung:** Theme **Hell** / **Dunkel**.
- **Akzentfarbe:** teal, jade, aqua oder coral.
- **Lesbarkeit:** **Schriftgröße** (Schieberegler) und **Dichte** (kompakt /
  normal / luftig).
- **Bewegung:** Animationen ein-/ausschalten.

Alle Einstellungen wirken sofort und werden lokal gespeichert. Hat dein System
„Reduzierte Bewegung" aktiviert, respektiert Pagebound das automatisch. Das Theme
lässt sich auch direkt über **Hell/Dunkel** in der oberen Leiste wechseln, die
Sprache (Deutsch/Englisch) über das Kürzel daneben.

---

## 15. Tastaturkürzel

Im Reader aktiv:

| Taste | Wirkung |
|-------|---------|
| `←` / `Bild ↑` | vorherige Seite |
| `→` / `Bild ↓` | nächste Seite |
| `Pos 1` (Home) | erste Seite |
| `Ende` (End) | letzte Seite |
| `Strg` + `F` | Suche fokussieren (überschreibt die Browser-Suche) |
| `Esc` | Suche leeren |
| `Strg` + `+` / `=` | hineinzoomen |
| `Strg` + `-` | herauszoomen |
| `Strg` + `0` | Zoom zurücksetzen |

Während du in einem Eingabefeld tippst, sind nur `Esc` und `Strg`+`F` aktiv —
alle anderen Tasten bleiben dem Feld überlassen.

---

## 16. Datenschutz & Sicherheit

Pagebound ist **konsequent lokal**:

- **Kein Backend, keine Konten, keine Cookies, keine Telemetrie.** Es gibt nichts,
  wohin Daten gesendet werden könnten.
- **Schriften sind selbst gehostet** — kein Google-Fonts-Request beim Laden.
- **Einzige Ausnahme:** Beim ausdrücklichen Klick auf **OCR** wird ein Tesseract-
  Sprachmodell aus dem Netz geladen. Ohne OCR-Klick gibt es keinen externen
  Request.
- Deine Dokumente, Annotationen und Einstellungen liegen im **Browser-Speicher**
  (IndexedDB / localStorage) und optional als **lokale Dateien** (Sidecar,
  Workspace), die du selbst kontrollierst.

**Sicherheit:**

- PDFs werden ohne Code-Ausführung verarbeitet (PDF.js mit deaktiviertem `eval`).
- Notiz-Markdown wird HTML-frei gerendert (kein Stored-XSS).
- Verschlüsselung über AES-256/WebCrypto (siehe [Abschnitt 11](#11-verschlüsselung)).
- Optionale Integritäts-Prüfung über SHA-256-Hash der Datei.

Details: siehe [`SECURITY.md`](../SECURITY.md).

---

## 17. Browser-Unterstützung & Grenzen

- **Empfohlen:** aktueller Chromium-Browser (Chrome, Edge, Brave) — dort sind
  *alle* Funktionen verfügbar, inkl. Datei-Handles und zentralem Workspace
  (File-System-Access-API).
- **Firefox / Safari:** Lesen, Annotieren, Werkzeuge, Konvertieren, Stapel und
  Verschlüsselung funktionieren; Datei-Handle-Persistenz und der zentrale
  Workspace stehen nicht zur Verfügung — stattdessen Download/Upload bzw.
  Sidecar-Export/Import.

**Bekannte Grenzen in 1.0:**

- Verschlüsselung deckt Seiteninhalts-Ströme ab, nicht String-Objekte (Titel/
  Lesezeichen); kein SASLprep für nicht-ASCII-Passwörter.
- Volltextsuche arbeitet auf dem Text-Layer bzw. OCR-Ergebnis, nicht über die
  gesamte Bibliothek hinweg.
- Gespeicherte Stapel-Regeln (Presets) sind noch nicht enthalten.

---

*Pagebound ist freie Software (Apache-2.0). Fragen, Fehler und Wünsche bitte als
Issue im Projekt-Repository.*
