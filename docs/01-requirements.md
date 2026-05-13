# Anforderungsdokument: Pagebound

| Feld | Wert |
|---|---|
| Projekt | **Pagebound** (Arbeitstitel) |
| Dokumenttyp | Anforderungsdokument (Requirements) |
| Version | 0.1 (Entwurf) |
| Stand | 2026-05-13 |
| Status | Zur Abstimmung |
| Autor | Projektinitiator (Solo-Entwickler) |

---

## 1. Einleitung

### 1.1 Zweck des Dokuments
Dieses Dokument beschreibt die fachlichen und technischen Anforderungen an **Pagebound**, eine quelloffene Anwendung zum Lesen, Bearbeiten und Verwalten von PDF-Dokumenten. Es bildet die Grundlage für das spätere Lastenheft (was zu liefern ist) und Pflichtenheft (wie es umgesetzt wird).

### 1.2 Vision
Pagebound soll der **datenschutzfreundliche, schlanke und moderne Ersatz** für Adobe Acrobat Reader sein. Es bietet alle Funktionen, die Acrobat Reader DC und Acrobat Pro standardmäßig liefern – kostenlos, ohne Cloud-Zwang, ohne Telemetrie und ohne veraltete Bedien-Paradigmen – und erweitert sie um Knowledge-Worker-Funktionen wie Sidecar-basierte Annotationsdaten, integritätsgesicherte Signaturen und Markdown-Integration für Zettelkasten-Workflows.

### 1.3 Anwendungsdomäne
PDF ist das de-facto Format für formale Dokumente: wissenschaftliche Veröffentlichungen, Verwaltungsformulare, Bücher, Berichte, Verträge. Bestehende Tools (Acrobat Reader, Foxit, Sumatra) decken Teile des Spektrums ab, lassen aber je nach Tool wichtige Funktionen vermissen oder hinter Paywalls. Pagebound zielt auf die Schnittmenge aus *Reader* (Sumatra-Schlank) + *Editor* (Acrobat-Pro-Features) + *Knowledge-App* (Zotero/Obsidian-Workflows).

---

## 2. Stakeholder

| Stakeholder | Rolle | Interessen |
|---|---|---|
| Projektinitiator | Auftraggeber & Auftragnehmer (Solo) | Eigene tägliche Acrobat-Ablösung, Lernziel Blazor, mittelfristige Community-Sichtbarkeit (>1000 GitHub-Stars) |
| Endnutzer (privat) | Anwender | Schlanke, schnelle, datenschutzfreundliche PDF-App ohne Lizenzkosten |
| Endnutzer (wissenschaftlich) | Anwender | PDF-Lesen, Annotieren, Highlight-Export nach Markdown für Zettelkasten |
| Endnutzer (Büro/Verwaltung) | Anwender | Formulare ausfüllen, signieren, kleinere Edits |
| Open-Source-Mitwirkende | Beitragende | Klarer Code, gute Doku, ADRs zum Verstehen der Architektur-Entscheidungen |

**Nicht-Stakeholder (explizit):** Adobe Inc., Enterprise-Kunden mit DRM-Anforderungen, Regulatorik-Behörden für qualifizierte elektronische Signaturen (eIDAS QES).

---

## 3. Ausgangslage und Motivation

### 3.1 Schwächen bestehender Lösungen

| Tool | Stärke | Schwäche |
|---|---|---|
| Adobe Acrobat Reader DC | Industriestandard, breite PDF-Kompatibilität | Aufgebläht, langsam, Cloud-Zwang, viele Funktionen hinter Pro-Paywall, veraltete UI |
| Adobe Acrobat Pro | Vollumfänglich | Teures Abo, Datenschutzbedenken, schlechte Barrierefreiheit |
| Foxit | Schlanker als Adobe | Kostenpflichtig für Pro-Features, ähnliche UI-Probleme |
| Sumatra PDF | Sehr schlank, schnell | Kein Annotieren/Editieren, nur Reader |
| pdf.js (Browser-default) | Im Browser eingebaut | Kein Annotieren, keine Library, keine Edits |
| Okular (Linux) | Open Source, viele Features | Plattform-gebunden, keine Web-Variante |

### 3.2 Konkrete Schmerzpunkte (Auftraggeber-Sicht)
1. Acrobat ist aufgebläht, langsam, ressourcenfressend.
2. Wichtige Funktionen (PDF zusammenfügen/splitten, OCR, Komprimieren, Konvertieren) sind hinter Pro-Paywall.
3. Datenschutz: Cloud-Zwang, Telemetrie, Login-Aufforderungen, unklare Datennutzung.
4. UI-Bedienung erfordert viele Klicks für einfache Operationen; nicht tastatur-/power-user-freundlich.

### 3.3 Lösungsansatz
Eine **Progressive Web App** auf Basis von Blazor WebAssembly, die im Browser läuft (keine Installation nötig), offline-fähig ist (Service-Worker-Caching), keinerlei Daten ohne expliziten Nutzerwillen nach außen sendet und alle relevanten Acrobat-Pro-Funktionen quelloffen unter Apache 2.0 anbietet.

---

## 4. Zielsetzung

### 4.1 Geschäftsziele (Auftraggeber)
- **Z1**: Pagebound ersetzt im Alltag des Projektinitiators den Adobe Acrobat Reader vollständig.
- **Z2**: Pagebound findet eine Open-Source-Community (Richtgröße: >1000 GitHub-Stars langfristig).
- **Z3**: Der Quellcode ist sauber, dokumentiert und für andere Entwickler verständlich und erweiterbar.
- **Z4**: Der Projektinitiator vertieft Kenntnisse in Blazor WebAssembly, PDF-Internals und PWA-Patterns.

### 4.2 Produktziele
- **P1**: Vollständige funktionale Parität zu Adobe Acrobat Reader DC.
- **P2**: Erschließung paywalled-Pro-Funktionen (Seitenoperationen, Komprimierung, OCR, Konvertierung) als Standard.
- **P3**: Drei klare Differenzierungs-Features (USP): integritätsgesicherte PNG-Signatur, Sidecar-basierte Library mit Markdown-Export, Multi-PDF-Split-View.
- **P4**: Modernes Bedienkonzept (Library + Tabs, Inline-Annotation-Toolbar, Markdown-Notizen, mehrere Themes).
- **P5**: Datenschutz-First (keine Telemetrie by default, alles client-side, optional Sync-Backend self-hostable).

---

## 5. Geltungsbereich

### 5.1 In Scope (Was Pagebound *ist*)
- PDF-Viewer mit Zoom, Suche, Outline, Thumbnails, mehrseitiger Navigation
- Vollständiges Annotations-Set: Highlight, Sticky Notes, Stift, Formen, PNG-Signatur+Hash
- Seitenoperationen (zusammenfügen, splitten, drehen, neu sortieren, löschen)
- PDF aus Bildern erzeugen, PDF-Komprimierung, PDF↔Bild/Text/HTML-Export
- Formulare ausfüllen (AcroForms), digitale Signatur (X.509/PAdES) später
- OCR (Tesseract.js, spät in Roadmap)
- Stapelverarbeitung mit verkettbaren Regeln (spät in Roadmap)
- Library-Verwaltung mit Tags und drei View-Modi
- Markdown-Export für Highlights/Notizen mit Obsidian-Kompatibilität
- Multi-PDF Split-View
- Mehrsprachig (DE/EN ab MVP, i18n-ready)
- Themes (Light, Dark, Sepia, Custom)
- Web als PWA, später Desktop/Mobile via .NET MAUI Blazor Hybrid

### 5.2 Out of Scope (Was Pagebound *nicht* ist)
- **KI-Funktionen** (Zusammenfassung, Q&A, Übersetzung, semantischer HTML-Export) – aufgeschoben in v2
- **Cloud-Hosting der Nutzerdaten** durch Pagebound-Betreiber – Daten bleiben beim Nutzer, optionales Sync-Backend ist self-hostable
- **DRM-Unterstützung** (Adobe LiveCycle, Microsoft Information Protection) – aus politischen und technischen Gründen
- **Qualifizierte elektronische Signatur nach eIDAS** – Pagebound bietet keine rechtlich qualifizierte Signaturlösung; das eigene PNG+Hash-Schema ist eine Integritäts-Prüfung, nicht eine rechtsgültige eQES
- **Echte 3D-PDF-Inhalte**, Multimedia-Embedded-Video, JavaScript-in-PDF-Execution
- **PDF-Erstellung aus Text-Editor** (Pagebound ist kein Textverarbeitungs-Tool; Bild→PDF und Seitenoperationen sind enthalten, aber kein Word-Ersatz)
- **Server-seitige Verarbeitung großer PDFs** – alles läuft client-side; Größenlimits ergeben sich aus Browser-RAM
- **Native Mobile-/Desktop-Apps im MVP** – kommt über PWA hinaus erst nach 1.0 via MAUI

---

## 6. Funktionale Anforderungen (FA)

Die Anforderungen sind eindeutig adressierbar und werden im Lastenheft (Priorität) und Pflichtenheft (Realisierung) referenziert.

### 6.1 Viewer & Navigation

| ID | Anforderung |
|---|---|
| **FA-001** | Der Nutzer kann eine PDF-Datei per Drag-and-Drop, Datei-Dialog oder File-System-Access-API öffnen. |
| **FA-002** | Der Nutzer kann mehrere PDFs gleichzeitig in Tabs geöffnet haben. |
| **FA-003** | Der Nutzer kann zwischen Seiten navigieren (vor/zurück, direkte Seitenzahl, Scrollen). |
| **FA-004** | Der Nutzer kann zoomen (rein, raus, fit-to-page, fit-to-width, Custom-Prozent). |
| **FA-005** | Der Nutzer kann nach Text im PDF suchen (inkl. Highlight aller Treffer und Sprung zu Treffer). |
| **FA-006** | Der Nutzer kann das Inhaltsverzeichnis (Outline) als Seitenleiste sehen und nutzen. |
| **FA-007** | Der Nutzer kann Seiten-Thumbnails als Seitenleiste sehen und nutzen. |
| **FA-008** | Die Anwendung unterstützt PDF-Versionen 1.4 bis 2.0 (inkl. verschlüsselter PDFs mit Passwort-Eingabe). |

### 6.2 Annotationen

| ID | Anforderung |
|---|---|
| **FA-010** | Der Nutzer kann Textstellen farbig hervorheben (Highlight) mit wählbaren Farben. |
| **FA-011** | Der Nutzer kann Sticky Notes (gelbe Klebezettel) an beliebigen Stellen platzieren. |
| **FA-012** | Notizen unterstützen Markdown-Formatierung mit Live-Preview. |
| **FA-013** | Der Nutzer kann freihändig zeichnen (Stift), inkl. Farb- und Stärken-Auswahl. |
| **FA-014** | Der Nutzer kann geometrische Formen einfügen (Rechteck, Pfeil, Linie). |
| **FA-015** | Der Nutzer kann ein PNG-Bild (z.B. handschriftliche Signatur) als Annotation einfügen, an beliebiger Position skalieren. |
| **FA-016** | Beim Einfügen einer PNG-Signatur wird optional ein SHA-256-Hash des gesamten signierten PDFs erzeugt und sowohl im PDF-Metadaten-Feld als auch in der Sidecar-Datei abgelegt (Hybrid-Integritätsprüfung). |
| **FA-017** | Beim Öffnen eines PDF mit Hash-Stempel prüft Pagebound automatisch die Integrität und zeigt das Ergebnis visuell an (grünes Häkchen / rotes Warndreieck). |
| **FA-018** | Die Annotation-Toolbar erscheint inline bei Text-Selektion (Notion/Medium-Stil); Modus-Toggle (Stift/Form/Stempel) ist über eine reduzierte fixe Toolbar erreichbar. |

### 6.3 PDF-Manipulation

| ID | Anforderung |
|---|---|
| **FA-020** | Der Nutzer kann Seiten in einem PDF neu anordnen (Drag-Reorder). |
| **FA-021** | Der Nutzer kann Seiten löschen. |
| **FA-022** | Der Nutzer kann Seiten drehen (90°-Schritte). |
| **FA-023** | Der Nutzer kann zwei oder mehr PDFs zu einer Datei zusammenfügen (Merge). |
| **FA-024** | Der Nutzer kann ein PDF an beliebigen Seiten-Trennpunkten in mehrere Dateien aufteilen (Split). |
| **FA-025** | Der Nutzer kann aus einer oder mehreren Bilddateien (PNG, JPG) eine PDF erzeugen. |
| **FA-026** | Der Nutzer kann ein PDF komprimieren (Bild-Neukompression mit wählbarer Qualität). |
| **FA-027** | Der Nutzer kann ein PDF passwort-verschlüsseln (AES-256). |

### 6.4 Formate & Konvertierung

| ID | Anforderung |
|---|---|
| **FA-030** | Der Nutzer kann ein PDF (oder einzelne Seiten) als PNG/JPG exportieren. |
| **FA-031** | Der Nutzer kann ein PDF (oder einzelne Seiten) als reinen Text (.txt) exportieren. |
| **FA-032** | Der Nutzer kann ein PDF als HTML mit pixel-genauer visueller Treue exportieren (Pre-rendered Layout). |

### 6.5 Formulare & Signaturen

| ID | Anforderung |
|---|---|
| **FA-040** | Der Nutzer kann interaktive PDF-Formularfelder (AcroForms) ausfüllen. |
| **FA-041** | Der Nutzer kann Formulardaten speichern (im PDF eingebettet). |
| **FA-042** | Der Nutzer kann eine PNG-basierte handschriftliche Signatur platzieren (siehe FA-015). |
| **FA-043** | Der Nutzer kann ein PDF mit einer zertifikatbasierten X.509-Signatur versehen (PAdES) – verschoben in Roadmap-Phase 0.8+. |

### 6.6 OCR & Stapelverarbeitung

| ID | Anforderung |
|---|---|
| **FA-050** | Der Nutzer kann auf gescannte PDFs eine OCR-Texterkennung (Tesseract.js) anwenden, wobei Text als unsichtbarer Layer ins PDF zurückgeschrieben wird (PDF/A-Text). |
| **FA-051** | Der Nutzer kann mehrere PDFs gleichzeitig auswählen und eine Operationskette ausführen (z.B. OCR → Komprimieren → Umbenennen-nach-Schema). |
| **FA-052** | Der Nutzer kann Stapelverarbeitungs-Regeln speichern und wiederverwenden. |

### 6.7 Library-Verwaltung

| ID | Anforderung |
|---|---|
| **FA-060** | Pagebound verwaltet eine persistente Bibliothek aller importierten PDFs mit Metadaten (Titel, Tags, Datum, Größe, Lesefortschritt). |
| **FA-061** | Der Nutzer kann zwischen drei Library-Ansichten umschalten: Tabelle (dicht), Grid mit Thumbnails (Cover-Style), Liste (Inbox-Style). |
| **FA-062** | Der Nutzer kann PDFs mit beliebigen Tags versehen und nach Tags filtern. |
| **FA-063** | Der Nutzer kann die Library volltext-durchsuchen (Inhalte + Metadaten + eigene Notizen). |
| **FA-064** | Die Library ist über eine permanent sichtbare Sidebar erreichbar; im Lesemodus auto-kollabiert sie. |

### 6.8 Sidecar-Datenmodell

| ID | Anforderung |
|---|---|
| **FA-070** | Annotation-Daten, Tags, Notizen, Highlights und Integritäts-Hashes werden als JSON-Sidecar-Datei neben dem PDF abgelegt (Default: `<filename>.pdf.pagebound.json`). |
| **FA-071** | Das Sidecar-Schema ist versioniert (Feld `schemaVersion`), um Forward-Compatibility zu ermöglichen. |
| **FA-072** | Alternativ kann der Nutzer einen zentralen Workspace-Ordner für Sidecars festlegen (entkoppelt von PDF-Speicherort). |
| **FA-073** | Beim Öffnen eines PDF erkennt Pagebound automatisch die zugehörige Sidecar-Datei in beiden Orten. |
| **FA-074** | Sidecar-Dateien können optional vom Nutzer mit Passwort verschlüsselt werden (AES-256-GCM). |

### 6.9 Markdown-Export & Obsidian-Integration

| ID | Anforderung |
|---|---|
| **FA-080** | Der Nutzer kann alle Highlights und Notizen eines PDFs als Markdown-Datei exportieren. |
| **FA-081** | Der Export enthält Seitennummern, Highlight-Zitate (mit Wikilinks zur Ursprungs-PDF), Notizen und YAML-Frontmatter mit Metadaten. |
| **FA-082** | Der Export folgt einem Obsidian-kompatiblen Format (kann direkt im Obsidian-Vault verwendet werden). |

### 6.10 Multi-PDF Split-View

| ID | Anforderung |
|---|---|
| **FA-090** | Der Nutzer kann zwei oder mehr PDFs nebeneinander oder übereinander darstellen (geteilter Hauptbereich). |
| **FA-091** | Beide Ansichten unterstützen unabhängige Navigation, Annotation und Suche. |
| **FA-092** | Optional: synchronisiertes Scrollen zwischen zwei Ansichten. |

### 6.11 Themes & Lokalisierung

| ID | Anforderung |
|---|---|
| **FA-100** | Pagebound unterstützt vier Themes: Light, Dark, Sepia, sowie ein benutzerdefiniertes (Custom) Theme mit konfigurierbaren CSS-Variablen. |
| **FA-101** | Theme-Wechsel folgt OS-Einstellung (Auto), kann manuell überschrieben werden, und wird persistent gespeichert. |
| **FA-102** | UI-Sprachen Deutsch und Englisch werden ab MVP unterstützt; das i18n-System erlaubt einfache Erweiterung um weitere Sprachen über JSON-Ressourcen. |

---

## 7. Nicht-funktionale Anforderungen (NFA)

### 7.1 Performance & Skalierbarkeit

| ID | Anforderung |
|---|---|
| **NFA-001** | PDFs bis 10 MB öffnen in unter 2 Sekunden (Cold-Load, schnelles Internet, Standard-Hardware). |
| **NFA-002** | PDFs bis 100 MB öffnen in unter 10 Sekunden mit Progressiv-Loading (Erste Seite sichtbar < 3 s). |
| **NFA-003** | PDFs zwischen 100 MB und 1 GB werden unterstützt; UI bleibt während des Ladens responsiv durch Web-Worker und virtuelles Scrolling. |
| **NFA-004** | Die Library skaliert auf mindestens 5000 PDF-Einträge ohne UI-Verzögerung (>10 fps Scroll). |
| **NFA-005** | Annotation-Operationen (Highlight setzen, Notiz schreiben) sind unter 100 ms latency-freundlich. |

### 7.2 Verfügbarkeit & Robustheit

| ID | Anforderung |
|---|---|
| **NFA-010** | Pagebound ist nach erstem Laden vollständig offline-fähig (Service-Worker-Caching). |
| **NFA-011** | Auto-Save: jede Annotation-Änderung wird sofort in IndexedDB und Sidecar persistiert (keine ungesicherten Zustände). |
| **NFA-012** | Bei Browser-Crash oder Tab-Schließung gehen keine Annotationsdaten verloren. |
| **NFA-013** | Bei korrupter Sidecar-Datei zeigt Pagebound eine Fehlerbeschreibung mit Recovery-Optionen (Backup, neu erstellen, ignorieren). |

### 7.3 Sicherheit & Datenschutz

| ID | Anforderung |
|---|---|
| **NFA-020** | Pagebound sendet **keinerlei Daten** an Pagebound-Betreiber-Server. (Optionale Crash-Reports sind explizit opt-in und anonymisiert.) |
| **NFA-021** | Pagebound enthält keinerlei Tracker, Analytics-Pixel, Third-Party-Werbe-Skripte. |
| **NFA-022** | Verschlüsselte PDFs (AES-128, AES-256) können mit Passwort geöffnet und gespeichert werden. |
| **NFA-023** | Sidecar-Dateien können optional mit AES-256-GCM verschlüsselt werden; Passwort wird ausschließlich im Memory gehalten und nie persistiert. |
| **NFA-024** | Integritäts-Hash (FA-016) verwendet SHA-256 nach NIST-Standard. |
| **NFA-025** | Alle JS-Interop-Aufrufe sind gegen XSS abgesichert (kein `innerHTML` mit ungesäubertem Input). |

### 7.4 Barrierefreiheit (a11y)

| ID | Anforderung |
|---|---|
| **NFA-030** | Pagebound erfüllt WCAG 2.1 Level AA für die App-UI (PDF-Inhalte selbst hängen vom PDF ab). |
| **NFA-031** | Alle Aktionen sind per Tastatur erreichbar (vollständige Tastatur-Navigation). |
| **NFA-032** | Screen-Reader-Support (ARIA-Labels, semantische HTML-Struktur, Live-Regions für Statusmeldungen). |
| **NFA-033** | Mindestkontrast 4.5:1 für Texte, 3:1 für UI-Elemente. |
| **NFA-034** | Lighthouse Accessibility Score ≥ 90 wird als Quality-Gate vor jedem Release geprüft. |

### 7.5 Lizenz & Open-Source

| ID | Anforderung |
|---|---|
| **NFA-040** | Pagebound wird unter Apache License 2.0 veröffentlicht. |
| **NFA-041** | Alle eingesetzten Third-Party-Bibliotheken müssen kompatible Lizenzen aufweisen (Apache 2.0, MIT, BSD; **nicht** GPL/AGPL ohne explizite Prüfung; **nicht** kommerziell-only). |
| **NFA-042** | Der Quellcode ist auf GitHub öffentlich; alle Architektur-Entscheidungen werden als ADR dokumentiert. |

### 7.6 Internationalisierung

| ID | Anforderung |
|---|---|
| **NFA-050** | UI-Texte sind aus dem Code extrahiert und in Ressourcen-Dateien (JSON) abgelegt. |
| **NFA-051** | Datums-, Zahlen-, Listen-Formatierung folgt der gewählten UI-Sprache. |
| **NFA-052** | Mindestens Deutsch und Englisch sind ab MVP komplett übersetzt. |

### 7.7 Browser- & Plattform-Kompatibilität

| ID | Anforderung |
|---|---|
| **NFA-060** | Pagebound läuft in den jeweils letzten zwei Versionen von Chrome, Edge, Firefox, Safari. |
| **NFA-061** | Touch-Bedienung ist vollwertig (Mobile-Browser, Tablet, Stylus). |
| **NFA-062** | File System Access API wird genutzt, wo verfügbar (Chromium); auf Firefox/Safari fällt das Sidecar-Handling auf einen Upload/Download-Workflow zurück. |

### 7.8 Wartbarkeit & Code-Qualität

| ID | Anforderung |
|---|---|
| **NFA-070** | Alle Services sind interface-basiert (`IXxxService` → `XxxService`), Dependency Injection nur gegen Interfaces. |
| **NFA-071** | Code-Coverage Unit-Tests (bUnit + xUnit) ≥ 60 % für `Application`- und `Domain`-Schichten. |
| **NFA-072** | Kern-Workflows (PDF öffnen, Annotation setzen, Speichern, Signatur+Hash) werden durch Playwright E2E-Tests abgedeckt. |
| **NFA-073** | Alle architektur-relevanten Entscheidungen werden als ADR (Architecture Decision Record) im Repo dokumentiert. |

---

## 8. Annahmen

| ID | Annahme |
|---|---|
| **A-001** | Endnutzer nutzen einen modernen Browser (Evergreen-Versionen). |
| **A-002** | Endnutzer haben mindestens 4 GB RAM für mittlere PDFs, 8 GB für große (>100 MB). |
| **A-003** | Endnutzer in Chromium-basierten Browsern erlauben die File System Access API für komfortables Sidecar-Handling. |
| **A-004** | PDF.js als de-facto Standard für browser-basiertes PDF-Rendering bleibt verfügbar und Apache-2.0-lizenziert. |
| **A-005** | Der Projektinitiator bringt grundlegende C#-/Blazor-Kenntnisse mit; spezifische Blazor-WASM-Tiefe wird im Projekt aufgebaut. |

---

## 9. Constraints / Einschränkungen

| ID | Constraint |
|---|---|
| **C-001** | Solo-Entwicklung — keine festen Liefertermine, keine Parallelisierung über Personen. |
| **C-002** | Kein Hosting-Budget – statisches Hosting (eigene Domain mit CNAME auf GitHub/Cloudflare Pages). |
| **C-003** | Apache-2.0-Lizenz schließt GPL-/AGPL-/kommerziell-only-Bibliotheken aus (z.B. iText, QuestPDF kommerziell). |
| **C-004** | Blazor-WASM-Bundle-Größe: trotz AOT-Optimierung initial > 2 MB realistisch – muss durch Pre-rendering der Landing-Page und aggressives Caching kompensiert werden. |
| **C-005** | Browser-Sandbox: kein direkter Datei-System-Zugriff außerhalb File System Access API – schränkt Sidecar-Workflows auf Chromium ein (Firefox/Safari brauchen Upload/Download-Fallback). |
| **C-006** | PDF/A-konforme Archivierung wird nicht garantiert (würde umfangreiche Spec-Compliance benötigen). |

---

## 10. Erfolgsktiterien

Pagebound gilt als erfolgreich, wenn (alle Kriterien gleichzeitig erfüllt):

1. **K1**: Der Projektinitiator nutzt Pagebound im Alltag täglich anstelle von Adobe Acrobat Reader (Selbst-Adoption).
2. **K2**: Mindestens 1000 GitHub-Stars langfristig (Community-Adoption).
3. **K3**: Die letzten drei Releases vor 1.0 erreichen je einen Lighthouse-Accessibility-Score ≥ 90 (Quality-Gate-Compliance).
4. **K4**: Die Testabdeckung (Unit + E2E) erreicht für Kern-Workflows ≥ 60 % (Code-Qualität).
5. **K5**: Alle Architektur-Entscheidungen sind als ADR dokumentiert; das Onboarding eines fiktiven neuen Mitwirkenden dauert in einem reflektierten Trockenlauf < 1 Tag (Doku-Qualität).

---

## 11. Abnahmekriterien pro Release-Meilenstein

Jeder Release-Meilenstein (0.1 → 1.0, siehe Pflichtenheft Abschnitt 7) wird abgenommen, wenn:

1. **Funktional**: alle für diesen Meilenstein zugeordneten FA-IDs sind implementiert und manuell verifiziert.
2. **Test**: alle bUnit/xUnit-Tests grün, Playwright-Smoke-Tests grün.
3. **A11y**: Lighthouse-Accessibility-Score ≥ 90.
4. **UAT**: der Projektinitiator hat die Release-Version mindestens 1 Woche im echten Workflow genutzt, ohne Show-Stopper-Bugs zu finden.
5. **Doku**: das CHANGELOG ist aktuell, neue ADRs sind verfasst, die README spiegelt den aktuellen Feature-Stand.

---

## 12. Risiken (auf Anforderungsebene)

Detaillierte Risiken im Pflichtenheft. Auf Anforderungsebene relevant:

| ID | Risiko | Mitigation |
|---|---|---|
| **R-001** | PDF.js entwickelt sich rückwärts oder ändert Lizenz | Versions-Pinning, Fork als Option |
| **R-002** | Bundle-Größe Blazor WASM > 5 MB schreckt Erstnutzer ab | AOT-Compilation, Lazy-Loading von Modulen, Loading-Splash |
| **R-003** | Solo-Entwicklung verliert über Monate Momentum | Strenger Meilenstein-Schnitt, jede Version selbst nutzbar |
| **R-004** | PDF→Word-/Excel-Konvertierung wird nachgefragt, ist aber ohne KI nicht in guter Qualität machbar | Explizit als v2-Feature kommuniziert, KI-Phase eingeplant |
| **R-005** | File System Access API nur in Chromium – Firefox/Safari-Nutzer haben schlechtere UX | Fallback-Upload/Download-Workflow dokumentieren, langfristig auf OPFS umstellen wenn breit verfügbar |

---

## 13. Glossar

| Begriff | Bedeutung |
|---|---|
| **MVP** | Minimum Viable Product – kleinste nutzbare Version |
| **PWA** | Progressive Web App – Web-Anwendung mit App-ähnlichen Eigenschaften (Offline, Installierbar) |
| **WASM** | WebAssembly – Maschinen-Code im Browser |
| **Sidecar-Datei** | Begleitdatei neben einer Hauptdatei (hier: `.pagebound.json` neben `.pdf`) |
| **AcroForm** | Interaktives Formular in einer PDF-Datei (Adobe-Standard) |
| **PAdES** | PDF Advanced Electronic Signatures – ISO-Standard für PDF-Signaturen |
| **eIDAS** | EU-Verordnung über elektronische Identifizierung und Vertrauensdienste |
| **OPFS** | Origin Private File System – Browser-API für app-eigenes Dateisystem |
| **ADR** | Architecture Decision Record – kurzes Dokument über eine Architektur-Entscheidung |
| **AOT** | Ahead-of-Time-Compilation – Vorab-Kompilierung von WASM/IL |
| **i18n** | Internationalisierung – Vorbereitung des Codes für Übersetzungen |
| **a11y** | Accessibility / Barrierefreiheit |
| **USP** | Unique Selling Proposition – Alleinstellungsmerkmal |

---

## 14. Dokument-Historie

| Version | Datum | Änderung | Autor |
|---|---|---|---|
| 0.1 | 2026-05-13 | Erstentwurf nach Anforderungs-Workshop (6 Phasen) | Projektinitiator |
