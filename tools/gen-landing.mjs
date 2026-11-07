#!/usr/bin/env node
// Erzeugt die statischen Aufgaben-Landingpages (DE + EN), sitemap.xml, robots.txt und llms.txt.
//
// Ausführen (Repo-Wurzel):  node tools/gen-landing.mjs src/Pagebound.Web/wwwroot
// Die erzeugten Dateien werden eingecheckt; Texte hier pflegen, nicht im HTML.
// Auf die Standardausgabe kommt jeder geschriebene Pfad, einer pro Zeile: die CI
// prüft damit beide Richtungen — Inhalt gleich UND keine eingecheckte Seite übrig,
// die dieses Skript nicht mehr schreibt (ein umbenannter Slug lässt die alte
// Seite sonst liegen, der Generator löscht nichts).
//
// DE liegt unter /<slug>/, EN unter /en/<slug>/. Jede Seite verweist per hreflang auf
// ihr Gegenstück (und x-default = DE). EN-Seiten verlinken die App mit ?lang=en —
// die App startet sonst auf Deutsch.
//
// Abgelöst: tools/gen-landing.py (kein Python im Projekt). Die Ausgabe ist byte-gleich;
// esc() und pyJson() bilden dafür html.escape(quote=True) und json.dumps nach.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2]; // .../src/Pagebound.Web/wwwroot
if (!ROOT) {
  console.error("Aufruf: node tools/gen-landing.mjs <wwwroot>");
  process.exit(2);
}
const ORIGIN = "https://pagebound.app.lupusmalus.dev";
const REPO = "https://github.com/LupusMalusDeviant/Pagebound";
const LASTMOD = "2026-11-07"; // bei inhaltlichen Änderungen anheben

const UI = {
  de: {
    locale: "de_DE", home: "Zur App", nav: "Navigation", ogimg: "og-image.png",
    cta_note: "Kostenlos, ohne Anmeldung. Beim ersten Öffnen lädt die App einmalig einige MB und funktioniert danach auch offline.",
    how: "So geht’s", faq: "Häufige Fragen", more: "Weitere Werkzeuge", lang_other: "English",
    privacy: "Datenschutz",
    suffix: " – ohne Upload | Pagebound",
    footer: "Pagebound ist ein quelloffener PDF-Reader und -Editor, der vollständig im Browser läuft.",
    source: "Quellcode auf GitHub",
    facts: [
      ["Ohne Upload", "Die Datei wird im Browser verarbeitet und verlässt Ihr Gerät nicht."],
      ["Ohne Konto, ohne Kosten", "Keine Anmeldung, kein Abo, keine Wasserzeichen. Open Source (Apache 2.0)."],
      ["Ohne Tracking", "Keine Telemetrie, keine Werbung, keine Schriften oder Skripte von Drittanbietern."],
    ],
  },
  en: {
    locale: "en_US", home: "Open the app", nav: "Navigation", ogimg: "og-image-en.png",
    cta_note: "Free, no sign-up. The first visit downloads a few MB once; after that it also works offline.",
    how: "How it works", faq: "FAQ", more: "More tools", lang_other: "Deutsch",
    privacy: "Privacy",
    suffix: " – no upload | Pagebound",
    footer: "Pagebound is an open-source PDF reader and editor that runs entirely in your browser.",
    source: "Source code on GitHub",
    facts: [
      ["No upload", "Your file is processed in the browser and never leaves your device."],
      ["No account, no cost", "No sign-up, no subscription, no watermarks. Open source (Apache 2.0)."],
      ["No tracking", "No telemetry, no ads, no third-party fonts or scripts."],
    ],
  },
};

const PAGES = [
  {
    de: {
      slug: "pdf-seiten-loeschen",
      title: "PDF-Seiten löschen – kostenlos, ohne Upload | Pagebound",
      desc: "Einzelne Seiten aus einer PDF entfernen, umsortieren oder drehen – direkt im Browser, ohne Upload, ohne Konto. Open Source.",
      h1: "PDF-Seiten löschen",
      lead: "Seiten aus einer PDF entfernen, in neue Reihenfolge bringen oder drehen – und das Ergebnis als neue PDF speichern. Alles passiert in Ihrem Browser.",
      cta: ["/organize", "Seiten verwalten öffnen"],
      steps: [
        "„Seiten verwalten“ öffnen und die PDF auswählen.",
        "Seiten, die weg sollen, löschen; bei Bedarf per Ziehen umsortieren oder drehen.",
        "„Anwenden & speichern“ – die neue PDF wird heruntergeladen. Das Original bleibt unverändert.",
      ],
      faq: [
        ["Wird meine PDF hochgeladen?", "Nein. Pagebound läuft vollständig im Browser; die Datei wird nicht an einen Server geschickt."],
        ["Kann ich gelöschte Seiten zurückholen?", "Solange Sie noch nicht gespeichert haben, ja („Wiederherstellen“). Ihr Original wird ohnehin nie überschrieben."],
        ["Gibt es eine Größenbegrenzung?", "Es gibt kein Kontingent. Sehr große Dateien (mehrere hundert Seiten) brauchen entsprechend Arbeitsspeicher im Browser."],
      ],
    },
    en: {
      slug: "delete-pdf-pages",
      title: "Delete PDF pages – free, no upload | Pagebound",
      desc: "Remove, reorder or rotate pages of a PDF right in your browser – no upload, no account. Open source.",
      h1: "Delete PDF pages",
      lead: "Remove pages from a PDF, put them in a new order or rotate them – and save the result as a new PDF. Everything happens in your browser.",
      cta: ["/organize?lang=en", "Open page organizer"],
      steps: [
        "Open “Organize pages” and choose your PDF.",
        "Delete the pages you don’t need; drag to reorder or rotate if needed.",
        "“Apply & save” – the new PDF is downloaded. Your original stays untouched.",
      ],
      faq: [
        ["Is my PDF uploaded?", "No. Pagebound runs entirely in the browser; the file is never sent to a server."],
        ["Can I undo a deletion?", "Yes, as long as you haven’t saved yet (“Restore”). Your original is never overwritten anyway."],
        ["Is there a size limit?", "There is no quota. Very large files (hundreds of pages) need correspondingly more memory in the browser."],
      ],
    },
  },
  {
    de: {
      slug: "pdf-unterschreiben",
      title: "PDF unterschreiben – Unterschrift zeichnen oder tippen, ohne Upload | Pagebound",
      desc: "Eine PDF im Browser unterschreiben: Unterschrift zeichnen, als Schreibschrift tippen oder als Bild laden, frei platzieren. Ohne Upload, ohne Konto.",
      h1: "PDF unterschreiben",
      lead: "Unterschrift mit Maus oder Finger zeichnen, den Namen in Schreibschrift tippen oder ein Bild Ihrer Unterschrift laden – dann an die richtige Stelle ziehen und speichern.",
      cta: ["/reader", "Reader öffnen"],
      steps: [
        "Reader öffnen und die PDF auswählen.",
        "Im Menü „Signatur“ die Unterschrift zeichnen, tippen oder als PNG/JPG laden.",
        "Auf die Seite klicken, um sie zu platzieren; Größe und Position per Ziehen anpassen.",
        "„Signiert speichern“ – die Unterschrift wird fest in die PDF eingebettet.",
      ],
      note: "Ehrlich gesagt: Das ist eine Unterschrift als Bild (mit Unterzeichner-Angaben und Prüfsumme im Dokument), keine qualifizierte elektronische Signatur nach eIDAS. Für Verträge, die eine solche verlangen, brauchen Sie einen Vertrauensdienst.",
      faq: [
        ["Wird meine Unterschrift gespeichert oder hochgeladen?", "Nein. Sie wird im Browser erzeugt und nur in die PDF geschrieben, die Sie speichern."],
        ["Funktioniert das auf dem Smartphone?", "Ja, das Zeichnen klappt auch mit dem Finger."],
        ["Welche Schriften gibt es zum Tippen?", "Drei Schreibschriften (Caveat, Dancing Script, Great Vibes, alle unter freier OFL-Lizenz), mitgeliefert statt von einem Schriftdienst geladen."],
      ],
    },
    en: {
      slug: "sign-pdf",
      title: "Sign a PDF – draw or type your signature, no upload | Pagebound",
      desc: "Sign a PDF in your browser: draw your signature, type it in a script font or load an image, and place it anywhere. No upload, no account.",
      h1: "Sign a PDF",
      lead: "Draw your signature with mouse or finger, type your name in a script font or load an image of your signature – then drag it into place and save.",
      cta: ["/reader?lang=en", "Open the reader"],
      steps: [
        "Open the reader and choose your PDF.",
        "In the “Signature” menu, draw, type or load your signature as PNG/JPG.",
        "Click on the page to place it; drag to adjust size and position.",
        "“Save signed” – the signature is embedded into the PDF.",
      ],
      note: "To be clear: this is an image signature (with signer details and a checksum in the document), not a qualified electronic signature under eIDAS. Contracts that require one need a trust service provider.",
      faq: [
        ["Is my signature stored or uploaded?", "No. It is created in the browser and only written into the PDF you save."],
        ["Does it work on a phone?", "Yes, you can draw with your finger."],
        ["Which fonts are available for typing?", "Three script fonts (Caveat, Dancing Script, Great Vibes, all under the free OFL licence), bundled instead of loaded from a font service."],
      ],
    },
  },
  {
    de: {
      slug: "pdf-schwaerzen",
      title: "PDF schwärzen – Inhalte wirklich entfernen, ohne Upload | Pagebound",
      desc: "Bereiche in einer PDF dauerhaft schwärzen: Der Inhalt darunter wird entfernt, nicht nur überdeckt. Im Browser, ohne Upload, mit optionalem Audit-Report.",
      h1: "PDF schwärzen",
      lead: "Namen, Kontonummern oder ganze Absätze unkenntlich machen – so, dass der Text darunter wirklich weg ist und sich nicht mehr herauskopieren lässt.",
      cta: ["/reader", "Reader öffnen"],
      steps: [
        "Reader öffnen und die PDF auswählen.",
        "Werkzeug „Schwärzen“ wählen und die Bereiche auf der Seite aufziehen.",
        "„Schwärzung anwenden“ – die betroffenen Seiten werden neu erzeugt, der Inhalt unter den Balken ist entfernt.",
        "Optional den „Audit-Report“ speichern: SHA-256 vorher/nachher und Prüfung, dass in den Zonen kein Text mehr liegt.",
      ],
      note: "Gut zu wissen: Seiten mit Schwärzungen werden dafür in ein Bild umgewandelt – Text auf diesen Seiten ist danach nicht mehr markierbar. Seiten ohne Schwärzung bleiben unverändert.",
      faq: [
        ["Warum nicht einfach ein schwarzes Rechteck darüberlegen?", "Weil der Text darunter dann weiter in der Datei steht und sich herauskopieren lässt. Pagebound entfernt ihn."],
        ["Wird die Datei hochgeladen?", "Nein. Das Schwärzen passiert vollständig im Browser."],
      ],
    },
    en: {
      slug: "redact-pdf",
      title: "Redact a PDF – really remove content, no upload | Pagebound",
      desc: "Permanently redact areas of a PDF: the content underneath is removed, not just covered. In your browser, no upload, with an optional audit report.",
      h1: "Redact a PDF",
      lead: "Black out names, account numbers or whole paragraphs – so that the text underneath is really gone and can’t be copied out anymore.",
      cta: ["/reader?lang=en", "Open the reader"],
      steps: [
        "Open the reader and choose your PDF.",
        "Pick the “Redact” tool and drag over the areas on the page.",
        "“Apply redaction” – affected pages are rebuilt and the content under the boxes is removed.",
        "Optionally save the audit report: SHA-256 before/after and a check that no text is left in the zones.",
      ],
      note: "Good to know: pages with redactions are converted to an image for this – text on those pages can’t be selected afterwards. Pages without redactions stay unchanged.",
      faq: [
        ["Why not just draw a black box over it?", "Because the text underneath would still be in the file and could be copied out. Pagebound removes it."],
        ["Is the file uploaded?", "No. Redaction happens entirely in the browser."],
      ],
    },
  },
  {
    de: {
      slug: "pdf-zusammenfuegen",
      title: "PDF zusammenfügen und teilen – kostenlos, ohne Upload | Pagebound",
      desc: "Mehrere PDFs zu einer Datei zusammenfügen oder eine PDF in Teile trennen – direkt im Browser, ohne Upload, ohne Konto. Open Source.",
      h1: "PDFs zusammenfügen",
      lead: "Mehrere PDF-Dateien zu einer zusammenführen oder eine große PDF in einzelne Teile trennen – ohne die Dateien irgendwohin zu schicken.",
      cta: ["/reader?tab=tools", "Werkzeuge öffnen"],
      steps: [
        "„Werkzeuge“ öffnen, Kategorie „Seiten“ wählen und die erste PDF öffnen.",
        "Mit „Anhängen“ weitere PDFs hinten anfügen – eine nach der anderen.",
        "Zum Teilen stattdessen zwischen den Seiten Trennstellen setzen.",
        "Speichern: eine zusammengefügte PDF bzw. die Teile als einzelne Dateien.",
      ],
      faq: [
        ["Wie viele Dateien kann ich zusammenfügen?", "Es gibt kein festes Limit; begrenzend ist nur der Arbeitsspeicher Ihres Browsers."],
        ["Bleibt der Text markierbar?", "Ja. Die Seiten werden übernommen, nicht in Bilder umgewandelt."],
      ],
    },
    en: {
      slug: "merge-pdf",
      title: "Merge and split PDFs – free, no upload | Pagebound",
      desc: "Combine several PDFs into one file or split a PDF into parts – right in your browser, no upload, no account. Open source.",
      h1: "Merge PDFs",
      lead: "Combine several PDF files into one or split a large PDF into separate parts – without sending your files anywhere.",
      cta: ["/reader?tab=tools&lang=en", "Open the tools"],
      steps: [
        "Open “Tools”, choose the “Pages” category and open the first PDF.",
        "Use “Append” to add more PDFs at the end – one after another.",
        "To split instead, set split points between pages.",
        "Save: one merged PDF, or the parts as separate files.",
      ],
      faq: [
        ["How many files can I merge?", "There is no fixed limit; only your browser’s memory sets the boundary."],
        ["Does the text stay selectable?", "Yes. Pages are copied over, not turned into images."],
      ],
    },
  },
];

// Datenschutzseite — eigene URL, weil Google Play und der Microsoft Store eine
// verlangen (docs/distribution/app-stores.md). Inhaltlich muss sie mit SECURITY.md
// und dem tatsächlichen Verhalten übereinstimmen; `tools/privacy-check.mjs`
// erzwingt den technischen Teil (kein externer Request, keine Telemetrie).
// Kontakt: die Projektseite. Verlangt ein Store eine benannte verantwortliche
// Stelle mit Anschrift, gehört sie hier hinein — das kann nur der Betreiber.
const PRIVACY = {
  de: {
    slug: "datenschutz",
    title: "Datenschutz – Pagebound erhebt keine Daten",
    desc: "Pagebound verarbeitet PDFs vollständig im Browser. Keine Uploads, keine Konten, keine Cookies, keine Telemetrie, kein Tracking. Was auf dem Gerät bleibt und was beim Abruf der Seite anfällt.",
    h1: "Datenschutz",
    lead: "Pagebound ist so gebaut, dass gar keine Daten anfallen können: Ihre PDFs werden im Browser verarbeitet und verlassen Ihr Gerät nicht.",
    updated: "Stand: 7. November 2026",
    sections: [
      ["Kurz gefasst", [
        "Es gibt kein Benutzerkonto, keine Anmeldung und keine Zahlung.",
        "Ihre Dateien werden nicht hochgeladen. Es gibt keinen Server, der sie entgegennehmen könnte.",
        "Keine Cookies, keine Werbung, keine Analyse, keine Telemetrie, keine Weitergabe an Dritte.",
      ]],
      ["Ihre Dateien", [
        "Alles, was Pagebound mit einer PDF tut — lesen, annotieren, unterschreiben, schwärzen, zusammenfügen, verschlüsseln, Text erkennen —, geschieht in Ihrem Browser auf Ihrem Gerät.",
        "Auch die Texterkennung (OCR) läuft lokal: das Programm und die Sprachmodelle werden von dieser Seite mitgeliefert, nicht von einem fremden Dienst geladen.",
        "Ergebnisse speichern Sie selbst als Datei. Pagebound schickt sie nirgendwohin.",
      ]],
      ["Was auf Ihrem Gerät gespeichert wird", [
        "Damit Ihre Sammlung und Ihre Einstellungen einen Neustart überleben, legt Pagebound sie im Speicher Ihres Browsers ab (IndexedDB und localStorage).",
        "Im Cache-Speicher des Browsers liegt außerdem die App selbst, damit sie offline startet. Teilen Sie eine Datei über das Teilen-Menü an Pagebound, wird sie dort kurz zwischengelagert und beim nächsten Start der App entnommen und gelöscht.",
        "Diese Daten bleiben auf dem Gerät. Sie können sie jederzeit über die Website-Daten Ihres Browsers löschen; danach startet Pagebound wie beim ersten Mal.",
      ]],
      ["Beim Abruf dieser Seite", [
        "Pagebound wird wie jede Website von einem Webserver ausgeliefert. Dabei fallen beim Hosting technische Zugriffsdaten an: IP-Adresse, Zeitpunkt und angefragte Datei. Sie sind für die Auslieferung und den Schutz vor Missbrauch nötig und werden nicht mit anderen Daten zusammengeführt und nicht zur Wiedererkennung verwendet.",
        "Rechtsgrundlage ist das berechtigte Interesse am sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO). Betrieben wird der Server bei der Infomaniak Network SA in der Schweiz, die die Daten als Auftragsverarbeiter nur zur Auslieferung verwendet.",
        "Bei jedem Start sieht die App nach, ob es eine neue Fassung gibt, und lädt ihre Sprachdateien — beides von dieser Herkunft, nicht von Dritten. Danach arbeitet sie ohne weitere Verbindung und funktioniert auch offline.",
        "Eine Ausnahme: die Sprachmodelle für die Texterkennung sind rund 4 MB groß und werden nicht im Voraus mitgeliefert. Die erste Texterkennung holt sie von dieser Herkunft nach; danach liegen sie auf dem Gerät und funktionieren auch offline.",
      ]],
      ["Keine fremden Dienste", [
        "Schriften, Symbole und die OCR-Modelle werden von dieser Herkunft ausgeliefert. Es gibt keine Einbindung von CDN, Kartendiensten, Schriftdiensten, sozialen Netzwerken oder Analysewerkzeugen.",
        "Auch das Vorlesen bleibt im Gerät: Pagebound benutzt ausschließlich Stimmen, die Ihr Browser selbst berechnet. Stimmen, die den Text zum Vorlesen an einen Server schicken würden, werden nicht angeboten und nicht verwendet.",
        "Die Inhaltssicherheitsrichtlinie der Seite erlaubt Verbindungen nur zur eigenen Herkunft; eine Prüfung im Build bricht ab, sobald eine fremde Adresse im Code auftaucht.",
      ]],
      ["Ihre Rechte", [
        "Soweit überhaupt personenbezogene Daten verarbeitet werden — das betrifft nur die Zugriffsdaten oben —, haben Sie das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie das Recht, sich bei einer Aufsichtsbehörde zu beschweren.",
        "Die Dateien, die Sie mit Pagebound bearbeiten, liegen bei Ihnen; darauf hat der Betreiber keinen Zugriff.",
      ]],
      ["Kontakt und Änderungen", [
        "Fragen zum Datenschutz richten Sie bitte über die Projektseite des Vorhabens an den Betreiber: github.com/LupusMalusDeviant/Pagebound (Reiter „Issues“, oder für Sicherheitsmeldungen „Security“).",
        "Ändert sich etwas an der Verarbeitung, wird diese Seite angepasst; der Stand steht oben.",
      ]],
    ],
  },
  en: {
    slug: "privacy",
    title: "Privacy – Pagebound collects no data",
    desc: "Pagebound processes PDFs entirely in your browser. No uploads, no accounts, no cookies, no telemetry, no tracking. What stays on your device and what the web server sees.",
    h1: "Privacy",
    lead: "Pagebound is built so that no data can accumulate in the first place: your PDFs are processed in the browser and never leave your device.",
    updated: "Last updated: 7 November 2026",
    sections: [
      ["In short", [
        "There is no account, no sign-in and no payment.",
        "Your files are not uploaded. There is no server that could receive them.",
        "No cookies, no ads, no analytics, no telemetry, nothing passed to third parties.",
      ]],
      ["Your files", [
        "Everything Pagebound does with a PDF — reading, annotating, signing, redacting, merging, encrypting, recognising text — happens in your browser, on your device.",
        "Text recognition (OCR) runs locally as well: the program and the language models ship with this site instead of being fetched from an outside service.",
        "You save the result yourself as a file. Pagebound sends it nowhere.",
      ]],
      ["What is stored on your device", [
        "So that your library and settings survive a restart, Pagebound keeps them in your browser's storage (IndexedDB and localStorage).",
        "The browser's cache storage also holds the app itself, so that it starts offline. If you share a file with Pagebound through the share menu, it is briefly stored there and is taken out and deleted the next time the app starts.",
        "That data stays on the device. You can delete it at any time through your browser's site data; Pagebound then starts as it did the first time.",
      ]],
      ["When you load this site", [
        "Like any website, Pagebound is delivered by a web server. In doing so the hosting records technical access data: IP address, time and the file requested. It is needed to deliver the site and to protect it from abuse; it is not combined with other data and not used to recognise you.",
        "The legal basis is the legitimate interest in secure operation (Art. 6(1)(f) GDPR). The server is operated by Infomaniak Network SA in Switzerland, which processes the data on our behalf solely to deliver the site.",
        "On every start the app checks whether a new version exists and loads its language files — both from this origin, not from third parties. After that it needs no further connection and works offline.",
        "One exception: the language models for text recognition are about 4 MB and are not shipped in advance. The first text recognition fetches them from this origin; after that they stay on the device and work offline too.",
      ]],
      ["No third-party services", [
        "Fonts, icons and the OCR models are served from this origin. There is no CDN, map service, font service, social network or analytics tool embedded.",
        "Reading aloud stays on the device as well: Pagebound only uses voices your browser computes itself. Voices that would send the text to a server in order to speak it are neither offered nor used.",
        "The site's content security policy permits connections to its own origin only, and a build check fails as soon as an outside address appears in the code.",
      ]],
      ["Your rights", [
        "Where personal data is processed at all — which concerns only the access data above — you have the right to information, rectification, erasure, restriction, data portability and objection, as well as the right to lodge a complaint with a supervisory authority.",
        "The files you work on with Pagebound stay with you; the operator has no access to them.",
      ]],
      ["Contact and changes", [
        "For questions about privacy, please contact the operator through the project page: github.com/LupusMalusDeviant/Pagebound (the “Issues” tab, or “Security” for security reports).",
        "If anything about the processing changes, this page is updated; the date is shown above.",
      ]],
    ],
  },
};

const nl = "\n";
const LANGS = ["de", "en"];

// ---------------------------------------------------------------------------
// Fehlende oder falsch geschriebene Texte sollen den Lauf abbrechen, nicht als
// Wort „undefined" in einer Überschrift landen. Das Python-Skript tat das von
// selbst (KeyError), JavaScript setzt stillschweigend „undefined" ein.
// Zwei Netze: validate() prüft die Datenstruktur vor dem Rendern, und jede
// erzeugte Datei wird danach auf „undefined" geprüft (fängt auch einen Tippfehler
// in der Vorlage selbst, den validate() nicht sehen kann).
// ---------------------------------------------------------------------------
const UI_KEYS = ["locale", "home", "nav", "ogimg", "cta_note", "how", "faq", "more", "lang_other", "privacy", "suffix", "footer", "source"];
const PRIVACY_KEYS = ["slug", "title", "desc", "h1", "lead", "updated"];
const PAGE_KEYS = ["slug", "title", "desc", "h1", "lead"];

function str(value, what) {
  if (typeof value !== "string" || value === "") throw new Error(`${what}: fehlender oder leerer Text (${typeof value})`);
  return value;
}

// Indexiert prüfen, nicht mit forEach/map: die überspringen die Löcher einer
// lückenhaften Liste ([, , ,] hat length 3 und kein einziges Element), und das
// Rendern überspringt sie genauso — es käme eine leere Aufzählung heraus, ohne
// dass irgendwo „undefined" auftaucht.
function list(value, what) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${what}: leere oder fehlende Liste`);
  for (let i = 0; i < value.length; i++) if (!(i in value)) throw new Error(`${what}[${i}]: Lücke in der Liste`);
  return value;
}

function strings(value, what, len) {
  list(value, what);
  if (len !== undefined && value.length !== len) throw new Error(`${what}: ${value.length} statt ${len} Einträgen`);
  for (let i = 0; i < value.length; i++) str(value[i], `${what}[${i}]`);
  return value;
}

function pairs(value, what) {
  list(value, what);
  for (let i = 0; i < value.length; i++) strings(value[i], `${what}[${i}]`, 2);
}

function validate() {
  for (const lang of LANGS) {
    const ui = UI[lang];
    if (!ui) throw new Error(`UI.${lang} fehlt`);
    for (const k of UI_KEYS) str(ui[k], `UI.${lang}.${k}`);
    pairs(ui.facts, `UI.${lang}.facts`);
    for (const k of Object.keys(ui)) if (!UI_KEYS.includes(k) && k !== "facts") throw new Error(`UI.${lang}.${k}: unbekannter Schlüssel (Tippfehler?)`);
  }
  PAGES.forEach((group, n) => {
    for (const lang of LANGS) {
      const p = group[lang];
      if (!p) throw new Error(`PAGES[${n}].${lang} fehlt`);
      const where = `PAGES[${n}].${lang}`;
      for (const k of PAGE_KEYS) str(p[k], `${where}.${k}`);
      // Der Slug wird zum Verzeichnisnamen und zum Pfad in sitemap/hreflang:
      // keine Schrägstriche, kein Leerraum, keine Umlaute, kein "..".
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`${where}.slug: nur a-z, 0-9 und Bindestriche (${JSON.stringify(p.slug)})`);
      strings(p.cta, `${where}.cta`, 2);
      strings(p.steps, `${where}.steps`);
      pairs(p.faq, `${where}.faq`);
      if ("note" in p) str(p.note, `${where}.note`);
      for (const k of Object.keys(p)) if (![...PAGE_KEYS, "cta", "steps", "faq", "note"].includes(k)) throw new Error(`${where}.${k}: unbekannter Schlüssel (Tippfehler?)`);
    }
    for (const lang of LANGS) {
      if (PAGES.filter((g) => g[lang].slug === group[lang].slug).length !== 1)
        throw new Error(`Slug doppelt: ${lang}/${group[lang].slug}`);
    }
  });
  for (const lang of LANGS) {
    const p = PRIVACY[lang];
    if (!p) throw new Error(`PRIVACY.${lang} fehlt`);
    const where = `PRIVACY.${lang}`;
    for (const k of PRIVACY_KEYS) str(p[k], `${where}.${k}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`${where}.slug: nur a-z, 0-9 und Bindestriche (${JSON.stringify(p.slug)})`);
    if (PAGES.some((g) => g[lang].slug === p.slug)) throw new Error(`${where}.slug: kollidiert mit einer Landingpage (${p.slug})`);
    list(p.sections, `${where}.sections`);
    for (let i = 0; i < p.sections.length; i++) {
      const s = p.sections[i];
      list(s, `${where}.sections[${i}]`);
      if (s.length !== 2) throw new Error(`${where}.sections[${i}]: ${s.length} statt 2 Einträgen (Titel, Absätze)`);
      str(s[0], `${where}.sections[${i}][0]`);
      strings(s[1], `${where}.sections[${i}][1]`);
    }
    for (const k of Object.keys(p)) if (![...PRIVACY_KEYS, "sections"].includes(k)) throw new Error(`${where}.${k}: unbekannter Schlüssel (Tippfehler?)`);
  }
}

// Wie Pythons html.escape(s, quote=True).
function esc(s, what = "Text") {
  str(s, what);
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

// JSON im Ausgabeformat von Pythons json.dumps(v, ensure_ascii=False):
// Trenner ", " und ": ". Abgedeckt sind Zeichenketten, true/false, null, ganze
// Zahlen, Listen und Objekte — mehr braucht das JSON-LD hier nicht. Alles andere
// (undefined, Kommazahlen, NaN, Infinity, Funktionen) bricht ab, statt sich von
// Python zu unterscheiden (0.0 -> "0" statt "0.0") oder das Wort undefined in
// die Seite zu schreiben. Zeichenketten kodiert JSON.stringify gleich wie Python
// (Nicht-ASCII bleibt, "/" bleibt).
function pyJson(v, what = "JSON") {
  if (Array.isArray(v)) return "[" + v.map((x, i) => pyJson(x, `${what}[${i}]`)).join(", ") + "]";
  if (v !== null && typeof v === "object")
    return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + pyJson(x, `${what}.${k}`)).join(", ") + "}";
  if (typeof v === "string" || typeof v === "boolean" || v === null) return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`${what}: nur ganze Zahlen (Python schreibt 1.0, JavaScript 1)`);
    return JSON.stringify(v);
  }
  throw new Error(`${what}: ${typeof v} ist in JSON-LD nicht vorgesehen`);
}

// Dasselbe JSON, aber für ein <script>-Element: "<" wird zu <, damit ein
// "</script" oder "<!--" in einem Text das Element nicht beendet und den
// HTML-Parser nicht umschaltet (derselbe Grund, aus dem smoke.sh das ablehnt).
// JSON kennt "<" nur in Zeichenketten, deshalb ist das global sicher. An den
// heutigen Texten ändert es nichts — keiner enthält ein "<".
function jsonForScript(v, what) {
  return pyJson(v, what).replaceAll("<", "\\u003c");
}

function pathOf(lang, slug) {
  str(slug, "slug");
  return lang === "de" ? `/${slug}/` : `/en/${slug}/`;
}

const privacyPath = (lang) => pathOf(lang, PRIVACY[lang].slug);

// Jede erzeugte Datei: Pfad relativ zu ROOT, immer mit Schrägstrichen, damit die
// CI die Liste gegen `git ls-files` halten kann (Waisen-Prüfung).
const written = [];

function write(rel, text) {
  const path = rel.replaceAll("\\", "/");
  // Als Teilwort suchen, nicht mit Wortgrenzen: ein `p.h1 + ui.sufix` ergibt
  // „PDF-Seiten löschenundefined" — ohne Wortgrenze davor. Keiner der Texte
  // hier enthält das Wort, also ist jedes Vorkommen ein Fehler.
  const at = text.indexOf("undefined");
  if (at >= 0)
    throw new Error(`${path}: enthält das Wort "undefined" — fehlender Text in der Vorlage? …${text.slice(Math.max(0, at - 60), at + 20)}…`);
  writeFileSync(join(ROOT, rel), text, { encoding: "utf8" });
  written.push(path);
}

function render(group, lang) {
  const p = group[lang], ui = UI[lang];
  const other = lang === "de" ? "en" : "de";
  const url = ORIGIN + pathOf(lang, p.slug);
  const alt = Object.fromEntries(LANGS.map((l) => [l, ORIGIN + pathOf(l, group[l].slug)]));
  const image = `${ORIGIN}/${ui.ogimg}`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Pagebound – " + p.h1,
    url,
    inLanguage: lang,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Browser",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    description: p.desc,
    image,
    sameAs: [REPO],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  const others = PAGES.map((g) => g[lang]).filter((o) => o.slug !== p.slug);
  const [href, label] = p.cta;
  const home = lang === "de" ? "/" : "/?lang=en";
  const note = p.note ? `            <p class="note">${esc(p.note)}</p>` + nl : "";
  const out = `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.desc)}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="de" href="${alt.de}" />
    <link rel="alternate" hreflang="en" href="${alt.en}" />
    <link rel="alternate" hreflang="x-default" href="${alt.de}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pagebound" />
    <meta property="og:locale" content="${ui.locale}" />
    <meta property="og:locale:alternate" content="${UI[other].locale}" />
    <meta property="og:title" content="${esc(p.h1 + ui.suffix)}" />
    <meta property="og:description" content="${esc(p.desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(p.h1 + ui.suffix)}" />
    <meta name="twitter:description" content="${esc(p.desc)}" />
    <meta name="twitter:image" content="${image}" />
    <meta name="theme-color" content="#0f172a" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/landing/landing.css" />
    <script type="application/ld+json">${jsonForScript(ld, "ld")}</script>
    <script type="application/ld+json">${jsonForScript(faqLd, "faqLd")}</script>
</head>
<body>
    <div class="wrap">
        <header class="top">
            <a class="brand" href="${home}"><img src="/favicon.png" alt="" width="28" height="28" /> Pagebound</a>
            <nav aria-label="${ui.nav}"><a href="${pathOf(other, group[other].slug)}" hreflang="${other}" lang="${other}">${ui.lang_other}</a> · <a href="${home}">${ui.home}</a></nav>
        </header>
        <main>
            <h1>${esc(p.h1)}</h1>
            <p class="lead">${esc(p.lead)}</p>
            <p><a class="cta" href="${esc(href)}">${esc(label)}</a>
                <span class="cta-note">${esc(ui.cta_note)}</span></p>
            <ul class="facts">
${ui.facts.map(([a, b]) => `                <li><strong>${esc(a)}</strong>${esc(b)}</li>`).join(nl)}
            </ul>
            <h2>${ui.how}</h2>
            <ol class="steps">
${p.steps.map((s) => `                <li>${esc(s)}</li>`).join(nl)}
            </ol>
${note}            <h2>${ui.faq}</h2>
${p.faq.map(([q, a]) => `            <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(nl)}
            <h2>${ui.more}</h2>
            <ul class="more">
${others.map((o) => `                <li><a href="${pathOf(lang, o.slug)}">${esc(o.h1)}</a></li>`).join(nl)}
            </ul>
        </main>
        <footer>
            ${esc(ui.footer)}
            <a href="${home}">${ui.home}</a> · <a href="${REPO}">${ui.source}</a> · <a href="${privacyPath(lang)}">${ui.privacy}</a>
        </footer>
    </div>
</body>
</html>
`;
  const dir = pathOf(lang, p.slug).replace(/^\/|\/$/g, "");
  mkdirSync(join(ROOT, dir), { recursive: true });
  write(join(dir, "index.html"), out);
}

// Datenschutzseite: dieselbe Hülle, aber kein Werkzeug — kein CTA, keine
// Schritte, keine FAQ. Eigene Vorlage statt Sonderfälle in render(), damit die
// Landingpages davon unberührt bleiben.
function renderPrivacy(lang) {
  const p = PRIVACY[lang], ui = UI[lang];
  const other = lang === "de" ? "en" : "de";
  const url = ORIGIN + privacyPath(lang);
  const alt = Object.fromEntries(LANGS.map((l) => [l, ORIGIN + privacyPath(l)]));
  const image = `${ORIGIN}/${ui.ogimg}`;
  const home = lang === "de" ? "/" : "/?lang=en";
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: p.h1 + " – Pagebound",
    url,
    inLanguage: lang,
    description: p.desc,
    isPartOf: { "@type": "WebSite", name: "Pagebound", url: ORIGIN + "/" },
  };
  const out = `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.desc)}" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="de" href="${alt.de}" />
    <link rel="alternate" hreflang="en" href="${alt.en}" />
    <link rel="alternate" hreflang="x-default" href="${alt.de}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pagebound" />
    <meta property="og:locale" content="${ui.locale}" />
    <meta property="og:locale:alternate" content="${UI[other].locale}" />
    <meta property="og:title" content="${esc(p.h1 + ui.suffix)}" />
    <meta property="og:description" content="${esc(p.desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(p.h1 + ui.suffix)}" />
    <meta name="twitter:description" content="${esc(p.desc)}" />
    <meta name="twitter:image" content="${image}" />
    <meta name="theme-color" content="#0f172a" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/landing/landing.css" />
    <script type="application/ld+json">${jsonForScript(ld, "ld")}</script>
</head>
<body>
    <div class="wrap">
        <header class="top">
            <a class="brand" href="${home}"><img src="/favicon.png" alt="" width="28" height="28" /> Pagebound</a>
            <nav aria-label="${ui.nav}"><a href="${privacyPath(other)}" hreflang="${other}" lang="${other}">${ui.lang_other}</a> · <a href="${home}">${ui.home}</a></nav>
        </header>
        <main>
            <h1>${esc(p.h1)}</h1>
            <p class="lead">${esc(p.lead)}</p>
            <p class="note">${esc(p.updated)}</p>
${p.sections.map(([title, paras]) => `            <h2>${esc(title)}</h2>` + nl + paras.map((t) => `            <p>${esc(t)}</p>`).join(nl)).join(nl)}
        </main>
        <footer>
            ${esc(ui.footer)}
            <a href="${home}">${ui.home}</a> · <a href="${REPO}">${ui.source}</a>
        </footer>
    </div>
</body>
</html>
`;
  const dir = privacyPath(lang).replace(/^\/|\/$/g, "");
  mkdirSync(join(ROOT, dir), { recursive: true });
  write(join(dir, "index.html"), out);
}

validate();
for (const g of PAGES) for (const lang of LANGS) render(g, lang);
for (const lang of LANGS) renderPrivacy(lang);

// sitemap.xml mit lastmod und Sprachalternativen (xhtml:link)
{
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n';
  s += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  s += `  <url><loc>${ORIGIN}/</loc><lastmod>${LASTMOD}</lastmod></url>\n`;
  for (const g of PAGES) {
    let alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${pathOf(l, g[l].slug)}"/>`).join("");
    alts += `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${pathOf("de", g.de.slug)}"/>`;
    for (const l of LANGS) s += `  <url><loc>${ORIGIN}${pathOf(l, g[l].slug)}</loc><lastmod>${LASTMOD}</lastmod>${alts}</url>\n`;
  }
  {
    let alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${privacyPath(l)}"/>`).join("");
    alts += `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${privacyPath("de")}"/>`;
    for (const l of LANGS) s += `  <url><loc>${ORIGIN}${privacyPath(l)}</loc><lastmod>${LASTMOD}</lastmod>${alts}</url>\n`;
  }
  s += "</urlset>\n";
  write("sitemap.xml", s);
}

write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// llms.txt — Kurzbeschreibung für KI-Suchmaschinen/Agenten (llmstxt.org)
write("llms.txt", `# Pagebound

> Open-source PDF reader and editor that runs entirely in the browser (Blazor WebAssembly PWA). Files are never uploaded; no account, no telemetry, works offline. Apache 2.0. German and English UI.

Pagebound replaces a desktop PDF reader for everyday tasks: read and search, highlight and annotate, sign (draw, type or image), redact (content is really removed), fill and create forms, merge/split/reorder/rotate pages, compress, encrypt (AES-256), OCR for scanned PDFs, convert to images/text/HTML/DOCX, PDF/A, and a WYSIWYG designer for flyers, letters and invoices. It also ships an MCP server so AI agents can use the same PDF operations.

## Tools
${PAGES.map((g) => `- [${g.en.h1}](${ORIGIN}${pathOf("en", g.en.slug)}): ${g.en.desc}`).join(nl)}

## Project
- [App](${ORIGIN}/): the web app itself (installable PWA)
- [Source code](${REPO}): GitHub repository, README and changelog
- [MCP server](${REPO}/tree/main/mcp): tokenless MCP server, stdio or Streamable HTTP (hosted at ${ORIGIN}/mcp)
`);

// Nur die erzeugten Pfade, einer pro Zeile: so kann die CI prüfen, dass keine
// eingecheckte Landingpage übrig ist, die dieses Skript nicht mehr schreibt.
console.log(written.join(nl));
