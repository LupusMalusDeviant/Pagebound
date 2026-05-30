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

## Update 2026-05-30 — AES-256 (FA-027) managed gelöst

Die offene AES-256-Frage ist entschieden. PdfSharpCores eigener Verschlüsselungs-Pfad ist **nicht WASM-tauglich**: er ruft `MD5.Create()` im Security-Handler auf, was der WASM-CryptoConfig nicht kennt (derselbe Grund wie bei Signatur-Embed und Compress). Statt PdfSharpCore-Encryption (RC4/AES-128, MD5-abhängig) oder eines Upgrades auf PdfSharp 6.x wird AES-256 **rein managed** implementiert (`AesR6` + `PdfAesEncryptor`, ISO 32000-2 `/V 5` `/R 6`). R6 nutzt ausschließlich SHA-256/384/512 + AES — WASM-kompatibel und zugleich das im Lastenheft geforderte AES-256.

- PdfSharpCore bleibt für Merge/Split/Reorder/Rotate/Delete und zum **Normalisieren** der Eingabe (klassische, unkomprimierte Struktur) zuständig.
- `IPdfEncryptor` kapselt die Verschlüsselung; `JsPdfLibManipulator.EncryptAsync` delegiert dorthin. Die Abstraktion macht einen späteren Desktop-Pfad (PdfSharp 6.x) risikoarm.
- MVP-Grenze: nur Stream-Verschlüsselung (`/StmF /StdCF`), Strings `/Identity`. Volle String-Verschlüsselung ist eine Folge-Iteration.
- Der ursprüngliche RC4-Prototyp (`PdfSharpManipulator.EncryptAsync`) wurde entfernt.

## Referenz

- Lastenheft TEC-03, FA-020 bis FA-027
- Pflichtenheft Abschnitt 4.2 (`IPdfManipulator`), Abschnitt 6.2
- NOTICE-Eintrag PdfSharpCore
