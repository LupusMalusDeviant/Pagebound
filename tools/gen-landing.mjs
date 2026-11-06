#!/usr/bin/env node
// Erzeugt die statischen Aufgaben-Landingpages (DE + EN), sitemap.xml, robots.txt und llms.txt.
//
// Ausführen (Repo-Wurzel):  node tools/gen-landing.mjs src/Pagebound.Web/wwwroot
// Die erzeugten Dateien werden eingecheckt; Texte hier pflegen, nicht im HTML.
// Die CI prüft, dass die eingecheckten Dateien dem Stand dieses Skripts entsprechen.
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

const nl = "\n";
const LANGS = ["de", "en"];

// Wie Pythons html.escape(s, quote=True).
function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

// Wie Pythons json.dumps(v, ensure_ascii=False): Trenner ", " und ": ".
// Zeichenketten kodiert JSON.stringify gleich (Nicht-ASCII bleibt, "/" bleibt).
function pyJson(v) {
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(", ") + "]";
  if (v !== null && typeof v === "object")
    return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + pyJson(x)).join(", ") + "}";
  return JSON.stringify(v);
}

function pathOf(lang, slug) {
  return lang === "de" ? `/${slug}/` : `/en/${slug}/`;
}

function write(rel, text) {
  writeFileSync(join(ROOT, rel), text, { encoding: "utf8" });
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
    <script type="application/ld+json">${pyJson(ld)}</script>
    <script type="application/ld+json">${pyJson(faqLd)}</script>
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
            <a href="${home}">${ui.home}</a> · <a href="${REPO}">${ui.source}</a>
        </footer>
    </div>
</body>
</html>
`;
  const dir = pathOf(lang, p.slug).replace(/^\/|\/$/g, "");
  mkdirSync(join(ROOT, dir), { recursive: true });
  write(join(dir, "index.html"), out);
}

for (const g of PAGES) for (const lang of LANGS) render(g, lang);

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

console.log("ok", PAGES.flatMap((g) => LANGS.map((l) => g[l].slug)));
