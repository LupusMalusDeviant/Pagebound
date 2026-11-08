# Pagebound in die App-Stores bringen

Stand: 2026-11-07. Ziel: Pagebound dort anbieten, wo Menschen Apps suchen —
ohne dass jemand „Zum Startbildschirm hinzufügen" verstehen muss. Die Web-App
bleibt die eine Codebasis; die Store-Pakete sind dünne Hüllen darum.

## Kurzfassung

| Store | Weg | Aufwand | Kosten | Risiko | Empfehlung |
|---|---|---|---|---|---|
| **Microsoft Store** | PWA als MSIX (PWABuilder) | klein | 0 € (Einzelperson) | gering | **zuerst** |
| **Google Play** | Trusted Web Activity (Bubblewrap/PWABuilder) | klein–mittel | 25 $ einmalig | mittel: 12 Tester × 14 Tage | **parallel** |
| **Apple App Store** | Capacitor-Hülle mit gebündelter App + nativen Funktionen | groß | 99 $/Jahr + Mac | hoch: Richtlinie 4.2 | **später, eigenes Projekt** |

Gemeinsam für alle drei: erst das **Web-Manifest store-tauglich** machen (siehe
unten) — das hilft schon heute jedem, der Pagebound im Browser installiert.

## 0. Voraussetzungen in der Web-App (für alle Stores)

Gefunden im aktuellen `wwwroot/manifest.webmanifest`:

- **`name`/`short_name` heißen „Pagebound.Web"** (Rest aus der Projektvorlage).
  So heißt die installierte App heute auch im Browser. → „Pagebound" /
  „Pagebound – PDF ohne Upload".
- Keine `description`, keine `categories`, kein `lang`/`dir`.
- **Kein maskierbares Icon** (`purpose: "maskable"`) — Android schneidet sonst
  das Logo in den runden/eckigen Rahmen falsch zu. Dazu ein 1024er für die Stores.
- Keine `screenshots` (Play/MS Store zeigen sie im Installationsdialog).
- **Kein PDF-Datei-Handler.** Nur `.pbdesign.json` ist registriert. Für Laien ist
  „PDF anklicken → Öffnen mit Pagebound" der entscheidende Weg:
  - Windows (installierte PWA / MS Store): `file_handlers` mit
    `application/pdf` + `launchQueue` im Reader — funktioniert in Edge/Chrome.
  - Android (TWA): `file_handlers` greifen dort nicht; stattdessen
    `share_target` (POST, Datei) — „Teilen → Pagebound" aus Dateimanager, Mail,
    Messenger. Der Service Worker nimmt die Datei an und gibt sie an den Reader
    weiter (wie die Boot-Drop-Zone).
- **Datenschutzerklärung als eigene URL** (Play und MS Store verlangen sie):
  eine statische Seite wie die Landingpages, z. B. `/datenschutz/` — Inhalt im
  Kern: „Es werden keine Daten erhoben" (stimmt; `privacy-check.mjs` hält das).
- `/.well-known/assetlinks.json` für Google Play (s. u.). **Gemessen am
  2026-11-08 und erledigt:** `dotnet publish` nimmt das Punkt-Verzeichnis mit,
  und das gebaute Abbild liefert die Datei mit `application/json` aus. Die Datei
  liegt als leere Liste (`[]`) im Repo; `infra/docker/smoke.sh` prüft Typ und
  Form. Der Fallstrick, den die Prüfung fängt: ein **fehlender** Pfad unter
  `.well-known/` kommt als **HTTP 200 mit `text/html`** zurück (SPA-Fallback),
  nicht als 404 — Googles Prüfer sähe eine gültige Antwort, die kein JSON ist,
  und die TWA zeigte stumm die Browser-Leiste. Vor der Einreichung muss der
  SHA-256 des App-Signaturschlüssels hinein (s. 2.3).

## 1. Microsoft Store — zuerst

**Warum zuerst:** Für Einzelpersonen ist die Registrierung inzwischen kostenlos
(Identität per Ausweis + Selfie) [1][2]. Die Hülle ist ein MSIX-Paket, das die
installierte PWA in Edge startet — Updates kommen weiter über das normale
Deploy, nicht über den Store. Auf Windows ist Pagebound als
„Acrobat-Reader-Ersatz" am stärksten: mit PDF-`file_handlers` steht es unter
„Öffnen mit" und kann Standard-App für PDFs werden.

**Schritte:**
1. Partner Center: Konto (Einzelperson), App-Namen „Pagebound" reservieren.
2. PWABuilder (pwabuilder.com) mit `https://pagebound.app.lupusmalus.dev` →
   Windows-Paket; die drei Werte aus Partner Center (Package ID, Publisher,
   Publisher Display Name) eintragen.
3. Hochladen, Store-Eintrag (Beschreibung, Screenshots, Datenschutz-URL), Altersfreigabe.
4. Zertifizierung abwarten (typisch Tage).

## 2. Google Play — parallel starten, weil es dauert

**Weg:** Trusted Web Activity — eine Android-App, die die Web-App im Chrome-
Kontext ohne Browser-Leiste zeigt. Pagebound erfüllt die TWA-Anforderungen
(HTTPS, Manifest, Service Worker, Offline) bereits.

**Wichtigste Hürde:** Neue *private* Entwicklerkonten (nach dem 13.11.2023)
müssen vor der Veröffentlichung einen **geschlossenen Test mit mindestens 12
Testern über 14 zusammenhängende Tage** fahren [3]. Organisationskonten (mit
D-U-N-S-Nummer) sind ausgenommen [4]. → Testerkreis früh organisieren.

**Schritte:**
1. Play-Console-Konto (25 $ einmalig).
2. Paket mit Bubblewrap (CLI) oder PWABuilder (Android) erzeugen; Signierschlüssel
   sicher aufbewahren, **Play App Signing** aktivieren.
3. `/.well-known/assetlinks.json` auf der Domain ausliefern — mit dem
   SHA-256-Fingerabdruck des **App-Signaturschlüssels aus der Play Console**
   (App-Integrität), nicht nur dem lokalen Upload-Schlüssel; beide eintragen
   schadet nicht [5]. Ohne korrekte Datei zeigt die App eine Browser-Leiste.
4. Interner Test → geschlossener Test (12 Tester, 14 Tage) → Produktion.
5. Formular „Datensicherheit": keine Datenerhebung, keine Weitergabe.

**Hinweis Datenschutz:** Die TWA läuft in Chrome. Pagebound selbst sendet nichts;
was Chrome als Browser tut, liegt außerhalb der App — in der Store-Beschreibung
ehrlich so formulieren.

## 3. Apple App Store — später, als eigenes Projekt

Eine reine Web-Hülle wird nach Richtlinie **4.2 (Minimum Functionality)**
regelmäßig abgelehnt [6][7]. Chancen hat eine App, die den Web-Code **lokal
bündelt** (Capacitor; Blazor-WASM läuft in WKWebView) und **echte native
Funktionen** mitbringt — für Pagebound naheliegend:
- Integration in die **Dateien-App** („Öffnen in Pagebound", Dokumenttyp PDF),
- **Share-Extension** („Teilen → Pagebound"),
- Speichern zurück an den Ursprungsort.

Kosten/Aufwand: 99 $/Jahr, ein Mac mit Xcode, eigene Build-Pipeline, App-Review.
Das ist eine zweite Auslieferungsform mit eigener Pflege — erst angehen, wenn
Windows und Android laufen. Bis dahin funktioniert auf iOS die installierte
Web-App (Teilen → „Zum Home-Bildschirm").

## Reihenfolge (Vorschlag)

0. **Deployen, bevor paketiert wird.** PWABuilder und Bubblewrap lesen die
   **ausgelieferte** Seite, nicht das Repo. Am 2026-11-08 gemessen: live fehlten
   der PDF-Dateihandler, das Teilen-Ziel, die Screenshots und das maskierbare
   Icon, und `/datenschutz/` wie `/en/privacy/` lieferten den App-Rahmen statt
   der Erklärung (gleicher `<title>` wie ein erfundener Pfad). Ein Paket aus
   diesem Stand hätte genau die zwei Wege nicht, für die Pagebound in den Stores
   antritt, und ein Store-Prüfer hätte unter der Datenschutz-URL den Reader
   gesehen. `infra/docker/smoke.sh` nimmt eine beliebige Basis-URL und prüft das
   — auch gegen live: `bash infra/docker/smoke.sh https://pagebound.app.lupusmalus.dev`.
   Gegen den heutigen Live-Stand ist der Lauf rot. **Nach jedem Deploy fahren.**
1. Manifest store-tauglich + PDF-`file_handlers` (Windows) + Datenschutzseite.
2. Microsoft Store einreichen.
3. Play-Konto + geschlossenen Test starten (die 14 Tage laufen nebenher);
   dafür `share_target` (Android) und `assetlinks.json`.
4. Apple: erst nach Rückmeldung aus 2./3. bewerten.

## Quellen

1. [Free developer registration for individual developers on Microsoft Store (Windows Developer Blog)](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)
2. [Microsoft Store Developer Platform](https://storedeveloper.microsoft.com/)
3. [App testing requirements for new personal developer accounts (Play Console Help)](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
4. [Google Play's 12 Testers, 14 Days Requirement Explained (2026)](https://ontest.app/blog/google-play-12-testers-14-days-requirement-explained)
5. [Android Concepts for Web Developers — Digital Asset Links (Chrome for Developers)](https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs)
6. [App Store Review Guidelines 2026: Will Apple Approve Your Webview App? (MobiLoud)](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper/)
7. [Can You Publish a PWA to the App Store and Google Play? (2026, MobiLoud)](https://www.mobiloud.com/blog/publishing-pwa-app-store/)
