# Lastenheft: Pagebound

| Feld | Wert |
|---|---|
| Projekt | **Pagebound** (Arbeitstitel) |
| Dokumenttyp | Lastenheft |
| Version | 0.1 (Entwurf) |
| Stand | 2026-05-13 |
| Status | Zur Abstimmung |
| Bezug | Anforderungsdokument `01-requirements.md` (Version 0.1) |
| Auftraggeber | Projektinitiator (Solo-Entwickler) |
| Auftragnehmer | Projektinitiator (Solo-Entwickler) |

> **Hinweis zur Doppelrolle:** Da Pagebound ein Solo-Projekt ist, fallen Auftraggeber- und Auftragnehmer-Rolle in einer Person zusammen. Das Lastenheft bleibt dennoch in Auftraggeber-Sprache („Das System muss…") formuliert, um die Abnahmedisziplin zu wahren.

---

## 1. Ausgangssituation

Der Auftraggeber ist Anwender klassischer PDF-Tools (Adobe Acrobat Reader, gelegentlich Acrobat Pro). Folgende Schmerzpunkte motivieren die Eigenentwicklung:

- Acrobat ist aufgebläht, langsam und ressourcenfressend.
- Wichtige Funktionen (Seitenoperationen, OCR, Komprimieren, Konvertieren) sind hinter einer kostenpflichtigen Pro-Lizenz.
- Datenschutz: Cloud-Zwang, Telemetrie und unklare Datennutzung lassen sich nicht deaktivieren.
- Die UI ist veraltet, mausklick-lastig und nicht tastatur-freundlich.

Bestehende Open-Source-Alternativen decken jeweils nur Teilbereiche ab. Es fehlt eine moderne, plattform-unabhängige, datenschutzfreundliche Komplettlösung mit Knowledge-Worker-Features.

## 2. Zielsetzung

Es soll eine Anwendung **Pagebound** geschaffen werden, die:

1. den Adobe Acrobat Reader DC im Alltag des Auftraggebers vollständig ersetzt;
2. zusätzlich die paywalled Pro-Features (Seitenoperationen, Komprimierung, OCR, Konvertierungen) als Standardfunktion bietet;
3. drei Alleinstellungsmerkmale gegenüber Acrobat etabliert: PNG-Signatur mit Hash-Integrität, Sidecar-basierte Library mit Markdown-Export, Multi-PDF Split-View;
4. unter Apache License 2.0 als quelloffenes Projekt verfügbar ist und mittelfristig eine Community erreicht.

## 3. Leistungsumfang im Überblick

### 3.1 Was geliefert wird
- Eine als Progressive Web App auslieferbare Anwendung
- Quellcode-Repository auf GitHub mit Apache-2.0-Lizenz
- README + Setup-Anleitung
- Architecture Decision Records (ADRs)
- Anwender-Handbuch (User-Doku)
- Entwickler-Handbuch (Contributor-Doku)
- Hosting unter eigener Domain (statisches Hosting, CDN-fähig)

### 3.2 Was **nicht** geliefert wird
- KI-Funktionen (Zusammenfassung, Q&A, Übersetzung, semantischer HTML-Export) – verschoben in v2
- Cloud-Hosting der Nutzerdaten durch Pagebound
- Native Apps (Win/Mac/iOS/Android) im MVP – kommen nach 1.0 via .NET MAUI
- Server-seitige PDF-Verarbeitung
- DRM-Unterstützung (Adobe LiveCycle, Microsoft Information Protection)
- Qualifizierte elektronische Signatur (eIDAS QES)
- Echte 3D-PDF-/Multimedia-Embedded-Inhalte

## 4. Anforderungen mit MoSCoW-Priorisierung

Notation: **M** = Muss · **S** = Soll · **K** = Kann · Referenz auf FA-/NFA-IDs aus dem Requirements-Dokument.

### 4.1 Funktionale Anforderungen

#### 4.1.1 Viewer & Navigation
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-001 | PDF öffnen (Drag-Drop, Dialog, File System Access) | **M** |
| FA-002 | Mehrere PDFs gleichzeitig in Tabs | **M** |
| FA-003 | Seiten-Navigation (Scroll, vor/zurück, direkte Seitenzahl) | **M** |
| FA-004 | Zoom (rein, raus, fit-to-page, fit-to-width, Custom-%) | **M** |
| FA-005 | Volltext-Suche im PDF | **M** |
| FA-006 | Inhaltsverzeichnis als Seitenleiste | **M** |
| FA-007 | Seiten-Thumbnails als Seitenleiste | **S** |
| FA-008 | Unterstützung PDF 1.4 bis 2.0 inkl. verschlüsselter PDFs | **M** |

#### 4.1.2 Annotationen
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-010 | Text-Highlight mit wählbarer Farbe | **M** |
| FA-011 | Sticky Notes / Kommentar-Annotation | **M** |
| FA-012 | Markdown-Notizen mit Live-Preview | **S** |
| FA-013 | Freihand-Stift (Mouse/Stylus) | **S** |
| FA-014 | Geometrische Formen (Rechteck, Pfeil, Linie) | **S** |
| FA-015 | PNG-Signatur als Annotation platzieren | **M** *(USP)* |
| FA-016 | Hash-Integrität: SHA-256 in PDF-Metadata + Sidecar | **M** *(USP)* |
| FA-017 | Hash-Prüfung beim Öffnen mit visueller Anzeige | **M** *(USP)* |
| FA-018 | Inline-Annotation-Toolbar bei Text-Selektion | **S** |

#### 4.1.3 PDF-Manipulation
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-020 | Seiten neu anordnen (Drag-Reorder) | **M** |
| FA-021 | Seiten löschen | **M** |
| FA-022 | Seiten drehen (90°-Schritte) | **M** |
| FA-023 | PDFs zusammenfügen (Merge) | **M** |
| FA-024 | PDF aufteilen (Split) | **M** |
| FA-025 | Bild → PDF erzeugen | **S** |
| FA-026 | PDF komprimieren (Bild-Neukompression) | **S** |
| FA-027 | PDF passwort-verschlüsseln (AES-256) | **S** |

#### 4.1.4 Formate & Konvertierung
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-030 | PDF → PNG/JPG Export (ganze PDF oder Einzelseiten) | **S** |
| FA-031 | PDF → reiner Text (.txt) | **S** |
| FA-032 | PDF → HTML mit pixel-genauer visueller Treue | **K** |

#### 4.1.5 Formulare & Signaturen
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-040 | AcroForms ausfüllen | **S** |
| FA-041 | Formulardaten in PDF speichern | **S** |
| FA-043 | X.509-/PAdES-Signatur | **K** *(verschoben in Roadmap-Phase 0.8+)* |

#### 4.1.6 OCR & Stapelverarbeitung
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-050 | OCR via Tesseract.js, Text als unsichtbarer Layer ins PDF | **S** |
| FA-051 | Stapelverarbeitung mit verkettbaren Operationen | **S** |
| FA-052 | Speichern und Wiederverwenden von Stapel-Regeln | **K** |

#### 4.1.7 Library-Verwaltung
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-060 | Persistente Bibliothek mit Metadaten | **M** *(USP)* |
| FA-061 | Drei Ansichten (Tabelle/Grid/Liste) umschaltbar | **S** |
| FA-062 | Tags und Tag-Filter | **M** *(USP)* |
| FA-063 | Volltext-Suche über Library | **S** |
| FA-064 | Library-Sidebar mit Auto-Collapse im Lesemodus | **S** |

#### 4.1.8 Sidecar-Datenmodell
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-070 | JSON-Sidecar neben PDF, Default-Speicherort | **M** |
| FA-071 | Schema-Versionierung im Sidecar | **M** |
| FA-072 | Optionaler zentraler Workspace für Sidecars | **S** |
| FA-073 | Automatische Sidecar-Erkennung an beiden Orten | **M** |
| FA-074 | Sidecar-Verschlüsselung mit AES-256-GCM | **K** |

#### 4.1.9 Markdown-Export & Obsidian-Integration
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-080 | Highlight-/Notiz-Export als Markdown | **M** *(USP)* |
| FA-081 | Reichhaltiger Export (Seitenzahlen, Wikilinks, YAML-Frontmatter) | **S** |
| FA-082 | Obsidian-kompatibles Format | **M** *(USP)* |

#### 4.1.10 Multi-PDF Split-View
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-090 | Zwei oder mehr PDFs nebeneinander/übereinander darstellen | **M** *(USP)* |
| FA-091 | Unabhängige Navigation und Annotation pro View | **M** |
| FA-092 | Optional synchronisiertes Scrollen | **K** |

#### 4.1.11 Themes & Lokalisierung
| ID | Anforderung (Kurzform) | Priorität |
|---|---|:---:|
| FA-100 | Vier Themes: Light, Dark, Sepia, Custom | **S** |
| FA-101 | OS-Auto + manueller Override, persistent | **M** |
| FA-102 | DE + EN ab MVP, i18n-ready | **M** |

### 4.2 Nicht-funktionale Anforderungen

#### 4.2.1 Performance
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-001 | PDF < 10 MB öffnen in < 2 s | **M** |
| NFA-002 | PDF 10–100 MB öffnen in < 10 s mit Progressiv-Loading | **M** |
| NFA-003 | PDF 100 MB – 1 GB mit virtuellem Scrolling und Web-Worker | **S** |
| NFA-004 | Library mit 5000 Einträgen ohne UI-Lag | **S** |
| NFA-005 | Annotation-Operationen < 100 ms latency-freundlich | **M** |

#### 4.2.2 Robustheit
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-010 | Offline-Fähigkeit nach erstem Laden (Service Worker) | **M** |
| NFA-011 | Aggressives Auto-Save (jede Änderung sofort persistent) | **M** |
| NFA-012 | Keine Datenverluste bei Browser-Crash | **M** |
| NFA-013 | Recovery-UI bei korrupter Sidecar | **S** |

#### 4.2.3 Sicherheit & Datenschutz
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-020 | Keine Daten an Pagebound-Server (außer opt-in Crash-Reports) | **M** |
| NFA-021 | Keine Tracker, Analytics, Third-Party-Werbung | **M** |
| NFA-022 | Verschlüsselte PDFs mit Passwort öffnen + speichern | **S** |
| NFA-023 | Sidecar optional AES-256-GCM verschlüsselbar | **K** |
| NFA-024 | Integritäts-Hash SHA-256 | **M** |
| NFA-025 | JS-Interop XSS-sicher | **M** |

#### 4.2.4 Barrierefreiheit
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-030 | WCAG 2.1 Level AA für UI | **M** |
| NFA-031 | Vollständige Tastatur-Navigation | **M** |
| NFA-032 | Screen-Reader-Unterstützung (ARIA) | **M** |
| NFA-033 | Mindestkontrast 4.5:1 / 3:1 | **M** |
| NFA-034 | Lighthouse Accessibility Score ≥ 90 (Quality-Gate) | **M** |

#### 4.2.5 Lizenz & Open-Source
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-040 | Apache License 2.0 | **M** |
| NFA-041 | Kompatible Third-Party-Lizenzen (Apache/MIT/BSD) | **M** |
| NFA-042 | Quellcode öffentlich auf GitHub | **M** |

#### 4.2.6 Internationalisierung
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-050 | UI-Texte aus Code extrahiert (JSON-Ressourcen) | **M** |
| NFA-051 | Lokalisierte Datums-/Zahlen-/Listen-Formatierung | **S** |
| NFA-052 | DE + EN ab MVP | **M** |

#### 4.2.7 Plattform-Kompatibilität
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-060 | Evergreen-Browser (Chrome, Edge, Firefox, Safari – letzte 2 Versionen) | **M** |
| NFA-061 | Vollwertige Touch-Bedienung | **S** |
| NFA-062 | File System Access API mit Fallback | **M** |

#### 4.2.8 Wartbarkeit
| ID | Anforderung | Priorität |
|---|---|:---:|
| NFA-070 | Interface-First-Architektur (`IXxxService` + DI) | **M** |
| NFA-071 | Unit-Test-Coverage ≥ 60 % (Application/Domain) | **S** |
| NFA-072 | E2E-Tests für Kern-Workflows | **S** |
| NFA-073 | Architektur-Entscheidungen als ADR dokumentiert | **M** |

---

## 5. Mengengerüst

Das System wird auf folgendes Mengengerüst hin ausgelegt:

| Kennzahl | Wert |
|---|---|
| Maximale unterstützte PDF-Dateigröße | 1 GB |
| Typische PDF-Dateigröße | < 100 MB |
| Maximale Seitenzahl pro PDF | 5000 |
| Library-Kapazität (PDFs) | 5000 |
| Annotation-Anzahl pro PDF (realistisch) | 5000 |
| UI-Sprachen ab MVP | 2 (DE, EN) |
| Erwartete UI-Sprachen langfristig | 5–10 (community-übersetzt) |
| Gleichzeitig geöffnete Tabs | 10 (UI-empfohlen), technisch offen |
| Themes (eingebaut) | 4 (Light, Dark, Sepia, Custom) |

---

## 6. Releases und Liefer-Meilensteine

Es gibt **keinen Big-Bang-Release** auf 1.0. Stattdessen liefert der Auftragnehmer in 10 nutzbaren Meilensteinen. Jeder Release ist eigenständig funktionsfähig. Die Reihenfolge ist im Pflichtenheft begründet.

| Release | Inhalt (Kurz) | Wichtigste FA-IDs |
|---|---|---|
| **0.1 Alpha** | Viewer + Highlight + Sticky Notes + Sidecar-JSON | FA-001/3/4/5/8, FA-010/11, FA-070/71 |
| **0.2** | + Stift, Formen, Outline, Suche-Polish, Markdown-Notizen | FA-006, FA-012/13/14 |
| **0.3** | + Seitenoperationen (Reorder, Löschen, Drehen, Merge, Split) | FA-020/21/22/23/24 |
| **0.4** | + PNG-Signatur + Hash-Integrität (USP) | FA-015/16/17 |
| **0.5** | + Library mit Tabelle/Grid/Liste, Tags, Suche | FA-060/61/62/63/64, FA-072 |
| **0.6** | + Multi-PDF Split-View | FA-090/91/92 |
| **0.7** | + Markdown-Export + Obsidian-Integration (USP) | FA-080/81/82 |
| **0.8** | + AcroForms + PDF-Verschlüsselung + Bild→PDF + Komprimierung | FA-025/26/27, FA-040/41 |
| **0.9** | + OCR + Stapelverarbeitung | FA-050/51/52 |
| **1.0** | + PDF→Bild/Text/HTML, A11y-Polish, Doku komplett, Cross-Browser-Verifikation | FA-030/31/32 |

> **Hinweis:** Optionale X.509-/PAdES-Signatur (FA-043) ist bewusst NICHT in 1.0 enthalten und wird nach 1.0 als 1.x-Feature aufgenommen.

---

## 7. Abnahme- und Akzeptanzkriterien

Pro Release-Meilenstein gilt die Release-Version als abgenommen, wenn:

1. **Funktional**: alle zugeordneten Muss-Anforderungen sind implementiert und manuell verifiziert.
2. **Test**: alle bUnit/xUnit-Tests grün, Playwright-Smoke-Tests grün.
3. **A11y**: Lighthouse Accessibility Score ≥ 90.
4. **UAT**: Der Auftraggeber hat die Release-Version mindestens 1 Woche im echten Workflow ohne Show-Stopper-Bugs genutzt.
5. **Doku**: CHANGELOG aktualisiert, neue ADRs verfasst, README-Feature-Stand aktuell.

Pro Gesamt-Release **1.0** gilt zusätzlich:

6. Alle Muss-Anforderungen (FA und NFA) sind erfüllt.
7. Alle Soll-Anforderungen sind erfüllt oder begründet zurückgestellt.
8. Unit-Test-Coverage ≥ 60 % für Application- und Domain-Schichten.
9. Cross-Browser-Test (Chrome, Edge, Firefox, Safari je letzte 2 Versionen) ohne kritische Fehler.
10. Touch-Bedienung auf mindestens einem Tablet und einem Smartphone (Safari iOS, Chrome Android) verifiziert.

---

## 8. Rahmenbedingungen

### 8.1 Organisatorisch
| ID | Bedingung |
|---|---|
| ORG-01 | Solo-Entwicklung. Keine zeitlichen Verpflichtungen. |
| ORG-02 | Open-Source-Community kann beitragen, ist aber nicht Voraussetzung. |
| ORG-03 | Kein Hosting-Budget über Domain-Kosten hinaus. |

### 8.2 Technisch
| ID | Bedingung |
|---|---|
| TEC-01 | Blazor WebAssembly auf .NET 10 als Frontend-Stack. |
| TEC-02 | PDF.js (Apache 2.0) für Rendering via JS-Interop. |
| TEC-03 | PdfSharpCore (MIT) für PDF-Manipulation in C#. |
| TEC-04 | Tailwind CSS für Styling, eigene Headless-Komponenten. |
| TEC-05 | Statisches Hosting (CNAME auf GitHub/Cloudflare Pages); keine Server-Komponente im MVP. |
| TEC-06 | GitHub Actions für CI/CD. |
| TEC-07 | Interface-First-Architektur: jede DI-registrierte Klasse hinter Interface. |

### 8.3 Rechtlich
| ID | Bedingung |
|---|---|
| LEG-01 | Apache License 2.0 für eigenen Code. |
| LEG-02 | Eingesetzte Bibliotheken müssen Apache-2.0-kompatibel sein (MIT, BSD, Apache 2.0). |
| LEG-03 | Pagebound bietet keine rechtlich qualifizierte Signatur nach eIDAS – das eigene Hash-Schema ist eine Integritätsprüfung, keine eQES. Das wird in der UI klar kommuniziert. |
| LEG-04 | Pagebound erhebt keine personenbezogenen Daten; eine DSGVO-Verarbeitungs-Vereinbarung ist nicht erforderlich. |

---

## 9. Schnittstellen

### 9.1 Externe Schnittstellen
| Bezeichnung | Beschreibung | Format |
|---|---|---|
| PDF-Dateien | Import/Export | PDF 1.4 – 2.0 |
| Sidecar-Dateien | Eigene Persistenz | JSON, Schema versioniert |
| Markdown-Export | Highlight-/Notiz-Export | CommonMark + YAML-Frontmatter (Obsidian-kompatibel) |
| Bild-Export | Seiten als Bild | PNG, JPG |
| Text-Export | Volltext-Extraktion | UTF-8 .txt |
| HTML-Export | Visuelle Konvertierung | HTML5 + eingebettete Bilder |

### 9.2 Benutzer-Schnittstelle
- Web-PWA auf Standard-Browsern
- Vollwertige Maus-, Tastatur-, Touch-Bedienung
- Vier Themes umschaltbar
- Zwei UI-Sprachen ab MVP (DE/EN)

### 9.3 Schnittstellen zu Drittsystemen (optional)
- **Obsidian-Vault**: Markdown-Export ist so formatiert, dass er in einen Obsidian-Vault hineinkopiert werden kann.
- **Datei-System des Nutzers**: über File System Access API (Chromium) bzw. Datei-Dialog-Fallback (Firefox/Safari).

---

## 10. Offene Punkte

Die folgenden Punkte sind im Lastenheft bewusst offen gelassen und werden vor Beginn des jeweiligen Releases geklärt:

| ID | Offener Punkt | Klärungs-Zeitpunkt |
|---|---|---|
| OP-01 | Exakter Aufbau der JSON-Sidecar-Schema-Felder (Detail-Schema) | Vor Release 0.1 |
| OP-02 | Festlegung der genauen Tastatur-Shortcuts | Vor Release 0.2 |
| OP-03 | Detail-Spezifikation der Hash-Anbringung im PDF-Metadaten-Feld (PDF-Standard-Konformität prüfen) | Vor Release 0.4 |
| OP-04 | Festlegung des Stapelverarbeitungs-DSL (eigene Sprache vs. C#-Skripts vs. visueller Designer) | Vor Release 0.9 |
| OP-05 | Domain-Wahl und Registrierung | Vor Release 0.1 (öffentliche Sichtbarkeit) |
| OP-06 | Branding (finaler Name, Logo, Favicon) | Vor Release 0.5 (Community-Sichtbarkeit) |

---

## 11. Dokument-Historie

| Version | Datum | Änderung | Autor |
|---|---|---|---|
| 0.1 | 2026-05-13 | Erstentwurf nach Anforderungs-Workshop | Projektinitiator |
