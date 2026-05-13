# ADR-006: Eigenes PNG+SHA256-Schema für Signatur-Integrität (statt PAdES für MVP)

| | |
|---|---|
| Status | Akzeptiert |
| Datum  | 2026-05-13 |

## Kontext

Der Auftraggeber hat als USP gefordert: **PNG-Unterschrift, die in der PDF eingebettet wird, plus ein interner Hash, der sicherstellt, dass das PDF nicht (un)bemerkt verändert wurde** (FA-015 bis FA-017).

Der Industriestandard für PDF-Signaturen ist **PAdES** (PDF Advanced Electronic Signatures, ISO 32000-2). PAdES erfordert jedoch:
- Ein **X.509-Zertifikat** des Signierenden (Schlüsselpaar, ggf. von einer CA ausgestellt).
- **Kryptografisches Schlüsselmaterial** im Browser zu handhaben (HSM, Hardware-Token, oder Software-Keystore — alles im Browser problematisch).
- Komplexe Spec-Compliance (Byte-Range-Signaturen, OCSP-/CRL-Prüfung, Zeitstempel).

Diese Komplexität ist für ein Solo-Projekt im MVP nicht realistisch und übersteigt zudem die Anforderung — der Auftraggeber will keine rechtlich qualifizierte Signatur (eIDAS QES), sondern eine **Integritätsprüfung**.

## Entscheidung

**Für das MVP nutzen wir ein eigenes, vereinfachtes Schema:**

1. **PNG-Signatur als Annotation**: der Nutzer fügt ein PNG-Bild (handschriftliche Unterschrift) an gewählter Position ein.
2. **SHA-256-Hash des fertigen PDFs**: nach Einbettung des PNG wird ein Hash berechnet, der das gesamte PDF abdeckt.
3. **Hybrid-Speicherort**: der Hash wird sowohl in einem Custom-Metadata-Feld der PDF (`/Pagebound:IntegrityHash`) **als auch** in der Sidecar-Datei (`integrity.hash`) abgelegt.
4. **Sentinel-Hash-Verfahren**: zur Berechnung wird das Hash-Feld in der PDF auf einen festen Wert (64×`0x00`) gesetzt, gehasht, dann der berechnete Hash an die Stelle geschrieben. Dasselbe Verfahren beim Verifizieren — vermeidet das Henne-Ei-Problem.
5. **Visuelle Anzeige beim Öffnen**: grünes Häkchen (Hash gültig), rotes Warndreieck (Hash ungültig), graues Symbol (kein Hash vorhanden).
6. **UI-Disclaimer**: explizit kommuniziert: „Dies ist eine Integritätsprüfung. Es handelt sich **nicht** um eine rechtlich qualifizierte elektronische Signatur (eIDAS QES)."

**Echte PAdES-Signatur wird als FA-043 nach 1.0 als 1.x-Feature nachgereicht.**

## Konsequenzen

**Positiv:**
- Im Browser ohne CA-Infrastruktur umsetzbar.
- Hybrid-Persistenz (PDF + Sidecar) ist robust gegen einzelne Datenverluste.
- Für den Use-Case des Auftraggebers (private Dokumentensicherheit) ausreichend.
- Sentinel-Hash-Verfahren ist deterministisch und leicht zu re-implementieren.

**Negativ:**
- **Nicht eIDAS-konform**: kein rechtlich qualifizierter Beweis. Wenn jemand das PDF **und** beide Hash-Stellen neu berechnet, erscheint die Manipulation als gültig.
- **Kein Identitätsbeweis**: das Schema sagt „dieses PDF wurde nicht verändert", nicht „diese Person hat es signiert". Die Identität steckt nur im PNG-Bild der Unterschrift, was leicht kopierbar ist.
- **Standard-Inkompatibilität**: Adobe Acrobat zeigt unser Hash-Feld als „unbekanntes Custom-Metadata" — keine native Anerkennung.

**Mitigation:**
- UI-Text erklärt die Grenzen deutlich.
- Roadmap zeigt PAdES-Variante (FA-043) als Ergänzung post-1.0.
- Für kritische Anwendungsfälle (Verträge mit Rechtsfolge) verweisen wir explizit auf eIDAS-konforme Tools (DocuSign, AdobeSign, etc.).

## Alternativen erwogen

- **PAdES sofort im MVP**: zu komplex für Solo, würde Release 0.4 monatelang blockieren.
- **PGP-/SSH-Signaturen statt PDF-eingebettet**: unhandlich für Endnutzer, Schlüssel-Management komplex.
- **Nur Sidecar-Hash, kein PDF-Eintrag**: Sidecar kann verloren gehen → Hash-Verifikation nicht mehr möglich. Hybrid ist robuster.
- **Nur PDF-Eintrag, kein Sidecar**: PDF-Metadata-Felder können von anderen Tools überschrieben werden. Sidecar als Backup ist sinnvoll.

## Referenz

- Lastenheft FA-015 bis FA-017
- Pflichtenheft Abschnitt 4.5 (`ISignatureService`), inkl. Sentinel-Hash-Verfahren
- Roadmap: FA-043 (PAdES) post-1.0
