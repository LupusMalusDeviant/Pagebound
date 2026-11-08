# Statische Seiten & Store-Auftritt

## Zweck

Alles, was außerhalb der App gefunden werden muss: vier zweisprachige Aufgaben-Landingpages („PDF zusammenfügen", „PDF unterschreiben", „PDF schwärzen", „PDF-Seiten löschen"), die Datenschutzerklärung, `sitemap.xml`, `robots.txt` und `llms.txt` — alle **generiert**, nicht von Hand gepflegt, damit Text, Sprachalternativen und Sitemap nicht auseinanderlaufen. Dazu die App-Icons, Bildschirmfotos und OG-Bilder, die Google Play und der Microsoft Store verlangen.

## Dateien

| Pfad | Rolle |
|------|-------|
| `tools/gen-landing.mjs` | Generator: Inhalte als Daten (`UI` `:30`, `PAGES` `:61`, `PRIVACY` `:228`), Pflichtprüfung der Datenstruktur (`validate` `:361`), HTML-Maskierung (`esc` `:409`), Schreiben (`write` `:458`), `sitemap.xml` mit `lastmod` und `xhtml:link` (`:653`–`666`), `robots.txt` (`:669`), `llms.txt` (`:672`) |
| `tools/app-icons/render.mjs` | App-Icons in allen vom Manifest verlangten Größen |
| `tools/app-icons/screenshots.mjs` | Bildschirmfotos für die Store-Einträge |
| `tools/og-image/render.mjs` | OG-Bild für Verweise in sozialen Netzen |
| `src/Pagebound.Web/wwwroot/landing/` | Generierte deutsche Startseite |
| `src/Pagebound.Web/wwwroot/en/` | Generierte englische Seiten |
| `src/Pagebound.Web/wwwroot/datenschutz/` | Generierte Datenschutzerklärung (`PRIVACY` `:228`, Slug `datenschutz`) |
| `src/Pagebound.Web/wwwroot/pdf-zusammenfuegen/`, `pdf-unterschreiben/`, `pdf-schwaerzen/`, `pdf-seiten-loeschen/` | Die vier generierten Aufgabenseiten (englische Gegenstücke: `merge-pdf`, `sign-pdf`, `redact-pdf`, `delete-pdf-pages`) |
| `src/Pagebound.Web/tests-js/landing.test.mjs` | 13 Prüfungen auf die generierten Seiten |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Interop-Hilfen (UI)** (Querschnitt, via `load`, `save`): das Bildschirmfoto-Werkzeug steuert die laufende App über dieselben Brücken wie die Oberfläche — `tools/app-icons/screenshots.mjs:59`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).
- **PDF-Reader & Rendering** (Typ, via `speak`): **Namensgleichheit, keine Abhängigkeit.** `tools/gen-landing.mjs:304` ist Seitentext über das Vorlesen, keine Nutzung von `speak()` aus `tts-bridge.ts`. Siehe die Anmerkung in [`./INDEX.md`](./INDEX.md).

### Extern (Packages)

- Keine Laufzeit-Abhängigkeit. Die Werkzeuge laufen unter Node mit Bordmitteln; die Bildschirmfotos nutzen den Playwright-Browser, der ohnehin für die E2E-Prüfungen installiert ist.

## Öffentliche API / Interface

Keine API — zwei Kommandos:

```bash
node tools/gen-landing.mjs src/Pagebound.Web/wwwroot
```

Der Generator nimmt das `wwwroot` als Argument (`gen-landing.mjs:21`) und schreibt alle Seiten, `sitemap.xml`, `robots.txt` und `llms.txt` dorthin. `LASTMOD` (`:28`) ist von Hand zu pflegen und gehört bei inhaltlichen Änderungen angehoben; `ORIGIN` (`:26`) und `REPO` (`:27`) stehen als Konstanten im Skript.

Der Generator **prüft seine Eingabedaten selbst**: `validate()` (`:361`) verlangt für jede Sprache die Schlüssel aus `UI_KEYS` (`:330`), für die Datenschutzseite die aus `PRIVACY_KEYS` (`:331`) und für jede Aufgabenseite die aus `PAGE_KEYS` (`:332`). Fehlt einer, bricht der Lauf ab, statt eine halbe Seite zu schreiben.

## Datenfluss / Call-Flow

1. Die Inhalte stehen als JavaScript-Daten im Skript: Oberflächentexte je Sprache (`UI`, `:30`), die vier Aufgabenseiten mit deutschem und englischem Slug (`PAGES`, `:61`), die Datenschutzerklärung (`PRIVACY`, `:228`).
2. `validate()` (`:361`) prüft die Struktur vollständig, bevor etwas geschrieben wird.
3. Je Seite und Sprache entsteht ein Verzeichnis nach dem Slug (`pathOf`, `:447`) mit einer `index.html`; der Slug wird zugleich der Pfad in Sitemap und `hreflang` (Kommentar `:375`).
4. Jeder Text läuft durch `esc()` (`:409`), JSON für eingebettete Skripte durch `jsonForScript()` (`:443`) — Maskierung ist nicht optional, weil die Inhalte aus Daten kommen.
5. `sitemap.xml` entsteht mit `lastmod` und Sprachalternativen als `xhtml:link` (`:653`–`666`), dann `robots.txt` (`:669`) und `llms.txt` (`:672`).
6. Die CI prüft, dass die eingecheckten Seiten zum Generator passen: der Schritt „Landing pages up to date (gen-landing.mjs)" in `.github/workflows/ci.yml:56` lässt den Generator laufen und vergleicht. Eine von Hand geänderte Seite macht den Lauf rot — genau so soll es sein.

## Offene Fragen / TODOs

- **Offen beim Nutzer:** die Datenschutzerklärung nennt keine verantwortliche Stelle und keine erreichbare Kontaktadresse. Google Play und der Microsoft Store prüfen die Datenschutz-URL; ohne diese Angaben wird sie abgelehnt. Das kann nur der Betreiber ausfüllen (Art. 13 DSGVO).
- `LASTMOD` (`:28`) ist von Hand zu pflegen. Wird es vergessen, zeigt die Sitemap ein falsches Datum; eine Prüfung darauf gibt es nicht — die CI prüft nur, dass die Dateien zum Generator passen, und der Generator passt dann zu seinem veralteten Datum.
- `ORIGIN` ist fest eingetragen (`:26`). Ein Betrieb unter einer anderen Domain braucht eine Änderung am Skript.
