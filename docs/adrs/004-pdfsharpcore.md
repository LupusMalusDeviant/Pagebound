# ADR-004: PdfSharpCore für PDF-Manipulation

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Pagebound braucht PDF-Manipulation in C# (Merge, Split, Reorder, Rotate, Delete-Pages, Compress, Encrypt) — siehe FA-020 bis FA-027. Das Ergebnis muss in Blazor WASM laufen, ohne Server-Komponente.

Die wichtigsten Optionen:

| Library | Lizenz | WASM-tauglich? | Feature-Umfang |
|---|---|---|---|
| iText 7 | AGPL/kommerziell | ja | sehr hoch |
| QuestPDF | kommerziell ab 1 Mio. $ Jahresumsatz | ja | sehr hoch |
| PdfSharpCore | MIT | ja | mittel |
| PdfPig | Apache 2.0 | ja | Read-Only |

## Entscheidung

**PdfSharpCore (MIT) wird für PDF-Manipulation eingesetzt.**

Begründung:
- MIT-Lizenz ist Apache-2.0-kompatibel.
- Pure-C#-Bibliothek, läuft direkt in Blazor WASM.
- Deckt die Kern-Operationen (Merge, Split, Rotate, Delete-Pages, einfache Encryption) ab.
- AGPL-Libraries (iText) schließen wir wegen NFA-041 aus.
- Kommerzielle Libraries (QuestPDF) sind nicht open-source-kompatibel für Mitwirkende mit kommerziellen Plänen.

## Konsequenzen

**Positiv:**
- Lizenz-Kompatibilität gesichert.
- Pure C#, keine native-DLL-Abhängigkeit, läuft in WASM.
- Aktive Community, regelmäßige Updates.

**Negativ:**
- **Kompression** ist weniger ausgefeilt als bei iText (FA-026 wird mit einfacher Bild-Neukompression umgesetzt; verlustfreie Strom-Optimierung ist Phase-0.8+-Detail).
- **AES-256-Encryption**: PdfSharpCore unterstützt aktuell AES-128 vollständig, AES-256 ggf. nicht durchgängig — Implementation in Release 0.8 zeigt, ob eigene Erweiterung nötig.
- **Transitive Abhängigkeit auf SixLabors.ImageSharp 1.0.4** mit bekannten CVEs (NU1902/NU1903 Warnungen). Mitigation: Verfolgung des PdfSharpCore-Upstream auf ImageSharp-2.x-Upgrade; bei Bedarf eigener Fork oder ImageSharp-Versions-Override prüfen (Trade-off zu evaluieren, sobald wir die ersten Manipulation-Tests bauen).

**Mitigation des AES-256-Problems:**
- Falls PdfSharpCore AES-256 nicht produktionsreif liefert, evaluieren wir in Release 0.8 entweder einen Fork oder den Wechsel auf eine alternative Library (z.B. eine zukünftige Open-Source-Variante). Die Service-Abstraktion `IPdfManipulator` macht den Wechsel risikoarm.

## Alternativen erwogen

- **iText 7**: AGPL-Konflikt mit Apache 2.0; kommerzielle Lizenz nicht im Hobby-Budget.
- **QuestPDF**: lizenzrechtlich problematisch für Open-Source-Wiederverwendung.
- **PdfPig**: nur Read-Only, würde Schreib-Operationen nicht abdecken.
- **Eigenimplementation**: PDF-Spec ist enorm; nicht realistisch im Solo-Projekt.

## Referenz

- Lastenheft TEC-03, FA-020 bis FA-027
- Pflichtenheft Abschnitt 4.2 (`IPdfManipulator`), Abschnitt 6.2
- NOTICE-Eintrag PdfSharpCore
