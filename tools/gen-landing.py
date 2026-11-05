#!/usr/bin/env python3
"""Erzeugt die statischen Aufgaben-Landingpages (wwwroot/<slug>/index.html), sitemap.xml und robots.txt.

Ausführen (Repo-Wurzel):  python3 tools/gen-landing.py src/Pagebound.Web/wwwroot
Die erzeugten Dateien werden eingecheckt; Texte hier pflegen, nicht im HTML."""
import html, json, os, sys

ROOT = sys.argv[1]  # .../src/Pagebound.Web/wwwroot
ORIGIN = "https://pagebound.app.lupusmalus.dev"

COMMON_FACTS = [
    ("Ohne Upload", "Die Datei wird im Browser verarbeitet und verlässt Ihr Gerät nicht."),
    ("Ohne Konto, ohne Kosten", "Keine Anmeldung, kein Abo, keine Wasserzeichen. Open Source (Apache 2.0)."),
    ("Ohne Tracking", "Keine Telemetrie, keine Werbung, keine Schriften oder Skripte von Drittanbietern."),
]

PAGES = [
    {
        "slug": "pdf-seiten-loeschen",
        "title": "PDF-Seiten löschen – kostenlos, ohne Upload | Pagebound",
        "desc": "Einzelne Seiten aus einer PDF entfernen, umsortieren oder drehen – direkt im Browser, ohne Upload, ohne Konto. Open Source.",
        "h1": "PDF-Seiten löschen",
        "lead": "Seiten aus einer PDF entfernen, in neue Reihenfolge bringen oder drehen – und das Ergebnis als neue PDF speichern. Alles passiert in Ihrem Browser.",
        "cta": ("/organize", "Seiten verwalten öffnen"),
        "steps": [
            "„Seiten verwalten“ öffnen und die PDF auswählen.",
            "Seiten, die weg sollen, löschen; bei Bedarf per Ziehen umsortieren oder drehen.",
            "„Anwenden & speichern“ – die neue PDF wird heruntergeladen. Das Original bleibt unverändert.",
        ],
        "faq": [
            ("Wird meine PDF hochgeladen?", "Nein. Pagebound läuft vollständig im Browser; die Datei wird nicht an einen Server geschickt."),
            ("Kann ich gelöschte Seiten zurückholen?", "Solange Sie noch nicht gespeichert haben, ja („Wiederherstellen“). Ihr Original wird ohnehin nie überschrieben."),
            ("Gibt es eine Größenbegrenzung?", "Es gibt kein Kontingent. Sehr große Dateien (mehrere hundert Seiten) brauchen entsprechend Arbeitsspeicher im Browser."),
        ],
    },
    {
        "slug": "pdf-unterschreiben",
        "title": "PDF unterschreiben – Unterschrift zeichnen oder tippen, ohne Upload | Pagebound",
        "desc": "Eine PDF im Browser unterschreiben: Unterschrift zeichnen, als Schreibschrift tippen oder als Bild laden, frei platzieren. Ohne Upload, ohne Konto.",
        "h1": "PDF unterschreiben",
        "lead": "Unterschrift mit Maus oder Finger zeichnen, den Namen in Schreibschrift tippen oder ein Bild Ihrer Unterschrift laden – dann an die richtige Stelle ziehen und speichern.",
        "cta": ("/reader", "Reader öffnen"),
        "steps": [
            "Reader öffnen und die PDF auswählen.",
            "Im Menü „Signatur“ die Unterschrift zeichnen, tippen oder als PNG/JPG laden.",
            "Auf die Seite klicken, um sie zu platzieren; Größe und Position per Ziehen anpassen.",
            "„Signiert speichern“ – die Unterschrift wird fest in die PDF eingebettet.",
        ],
        "note": "Ehrlich gesagt: Das ist eine Unterschrift als Bild (mit Unterzeichner-Angaben und Prüfsumme im Dokument), keine qualifizierte elektronische Signatur nach eIDAS. Für Verträge, die eine solche verlangen, brauchen Sie einen Vertrauensdienst.",
        "faq": [
            ("Wird meine Unterschrift gespeichert oder hochgeladen?", "Nein. Sie wird im Browser erzeugt und nur in die PDF geschrieben, die Sie speichern."),
            ("Funktioniert das auf dem Smartphone?", "Ja, das Zeichnen klappt auch mit dem Finger."),
            ("Welche Schriften gibt es zum Tippen?", "Drei Schreibschriften (Caveat, Dancing Script, Great Vibes, alle unter freier OFL-Lizenz), mitgeliefert statt von einem Schriftdienst geladen."),
        ],
    },
    {
        "slug": "pdf-schwaerzen",
        "title": "PDF schwärzen – Inhalte wirklich entfernen, ohne Upload | Pagebound",
        "desc": "Bereiche in einer PDF dauerhaft schwärzen: Der Inhalt darunter wird entfernt, nicht nur überdeckt. Im Browser, ohne Upload, mit optionalem Audit-Report.",
        "h1": "PDF schwärzen",
        "lead": "Namen, Kontonummern oder ganze Absätze unkenntlich machen – so, dass der Text darunter wirklich weg ist und sich nicht mehr herauskopieren lässt.",
        "cta": ("/reader", "Reader öffnen"),
        "steps": [
            "Reader öffnen und die PDF auswählen.",
            "Werkzeug „Schwärzen“ wählen und die Bereiche auf der Seite aufziehen.",
            "„Schwärzung anwenden“ – die betroffenen Seiten werden neu erzeugt, der Inhalt unter den Balken ist entfernt.",
            "Optional den „Audit-Report“ speichern: SHA-256 vorher/nachher und Prüfung, dass in den Zonen kein Text mehr liegt.",
        ],
        "note": "Gut zu wissen: Seiten mit Schwärzungen werden dafür in ein Bild umgewandelt – Text auf diesen Seiten ist danach nicht mehr markierbar. Seiten ohne Schwärzung bleiben unverändert.",
        "faq": [
            ("Warum nicht einfach ein schwarzes Rechteck darüberlegen?", "Weil der Text darunter dann weiter in der Datei steht und sich herauskopieren lässt. Pagebound entfernt ihn."),
            ("Wird die Datei hochgeladen?", "Nein. Das Schwärzen passiert vollständig im Browser."),
        ],
    },
    {
        "slug": "pdf-zusammenfuegen",
        "title": "PDF zusammenfügen und teilen – kostenlos, ohne Upload | Pagebound",
        "desc": "Mehrere PDFs zu einer Datei zusammenfügen oder eine PDF in Teile trennen – direkt im Browser, ohne Upload, ohne Konto. Open Source.",
        "h1": "PDFs zusammenfügen",
        "lead": "Mehrere PDF-Dateien zu einer zusammenführen oder eine große PDF in einzelne Teile trennen – ohne die Dateien irgendwohin zu schicken.",
        "cta": ("/reader?tab=tools", "Werkzeuge öffnen"),
        "steps": [
            "„Werkzeuge“ öffnen, Kategorie „Seiten“ wählen und die erste PDF öffnen.",
            "Mit „Anhängen“ weitere PDFs hinten anfügen – eine nach der anderen.",
            "Zum Teilen stattdessen zwischen den Seiten Trennstellen setzen.",
            "Speichern: eine zusammengefügte PDF bzw. die Teile als einzelne Dateien.",
        ],
        "faq": [
            ("Wie viele Dateien kann ich zusammenfügen?", "Es gibt kein festes Limit; begrenzend ist nur der Arbeitsspeicher Ihres Browsers."),
            ("Bleibt der Text markierbar?", "Ja. Die Seiten werden übernommen, nicht in Bilder umgewandelt."),
        ],
    },
]


def esc(s):
    return html.escape(s, quote=True)


def render(p):
    url = f"{ORIGIN}/{p['slug']}/"
    ld = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Pagebound – " + p["h1"],
        "url": url,
        "applicationCategory": "UtilitiesApplication",
        "operatingSystem": "Browser",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
        "description": p["desc"],
    }
    faq_ld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]],
    }
    others = [o for o in PAGES if o["slug"] != p["slug"]]
    href, label = p["cta"]
    out = f"""<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{esc(p['title'])}</title>
    <meta name="description" content="{esc(p['desc'])}" />
    <link rel="canonical" href="{url}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pagebound" />
    <meta property="og:locale" content="de_DE" />
    <meta property="og:title" content="{esc(p['h1'])} – ohne Upload | Pagebound" />
    <meta property="og:description" content="{esc(p['desc'])}" />
    <meta property="og:url" content="{url}" />
    <meta name="theme-color" content="#0f172a" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/landing/landing.css" />
    <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
    <script type="application/ld+json">{json.dumps(faq_ld, ensure_ascii=False)}</script>
</head>
<body>
    <div class="wrap">
        <header class="top">
            <a class="brand" href="/"><img src="/favicon.png" alt="" width="28" height="28" /> Pagebound</a>
            <nav aria-label="Navigation"><a href="/">Zur App</a></nav>
        </header>
        <main>
            <h1>{esc(p['h1'])}</h1>
            <p class="lead">{esc(p['lead'])}</p>
            <p><a class="cta" href="{esc(href)}">{esc(label)}</a>
                <span class="cta-note">Kostenlos, ohne Anmeldung. Beim ersten Öffnen lädt die App einmalig einige MB und funktioniert danach auch offline.</span></p>
            <ul class="facts">
{chr(10).join(f'                <li><strong>{esc(a)}</strong>{esc(b)}</li>' for a, b in COMMON_FACTS)}
            </ul>
            <h2>So geht’s</h2>
            <ol class="steps">
{chr(10).join(f'                <li>{esc(s)}</li>' for s in p['steps'])}
            </ol>
{f'            <p class="note">{esc(p["note"])}</p>' + chr(10) if p.get("note") else ""}            <h2>Häufige Fragen</h2>
{chr(10).join(f'            <details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in p['faq'])}
            <h2>Weitere Werkzeuge</h2>
            <ul class="more">
{chr(10).join(f'                <li><a href="/{o["slug"]}/">{esc(o["h1"])}</a></li>' for o in others)}
            </ul>
        </main>
        <footer>
            Pagebound ist ein quelloffener PDF-Reader und -Editor, der vollständig im Browser läuft.
            <a href="/">Zur App</a>
        </footer>
    </div>
</body>
</html>
"""
    d = os.path.join(ROOT, p["slug"])
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(out)


for p in PAGES:
    render(p)

urls = [f"{ORIGIN}/"] + [f"{ORIGIN}/{p['slug']}/" for p in PAGES]
with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        f.write(f"  <url><loc>{u}</loc></url>\n")
    f.write("</urlset>\n")
with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write(f"User-agent: *\nAllow: /\n\nSitemap: {ORIGIN}/sitemap.xml\n")
print("ok", [p["slug"] for p in PAGES])
