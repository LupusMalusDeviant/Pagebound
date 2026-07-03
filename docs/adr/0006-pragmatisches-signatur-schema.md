# ADR-0006: Pragmatisches Signatur-Integritäts-Schema (kein PAdES)

- Status: **Akzeptiert**
- Bezug: `src/Pagebound.Core/Abstractions/IIntegrityService.cs`, `src/Pagebound.Core/Domain/SignatureAnnotation.cs`, `src/Pagebound.Infrastructure/Crypto/IntegrityService.cs`, [Blueprint: Signatur & Integrität](../blueprints/signatur-integritaet.md)

> Nachträglich dokumentiert (F-19) — hält die im Code bereits umgesetzte
> Entscheidung fest.

## Kontext

Nutzer sollen eine PDF bild-basiert (PNG) unterschreiben und später erkennen
können, ob seit der Unterschrift etwas verändert wurde — **komplett lokal, ohne
PKI/Server**. Eine echte kryptografische PDF-Signatur nach **PAdES** braucht
Zertifikate/PKI und modifiziert die PDF-Struktur — beides passt (noch) nicht zum
serverlosen, sidecar-basierten Ansatz.

## Entscheidung

Ein **kombinierter SHA-256-Hash** dient als Integritätsnachweis, **ohne die PDF zu
re-hashen/zu modifizieren**. Der kanonische String deckt ab:

1. den SHA-256 der Original-PDF (= `PdfId`),
2. den deterministisch serialisierten Annotation-Snapshot **ohne die Signaturen
   selbst** (sortiert nach Id, Payload-Keys sortiert),
3. den Signaturzeitpunkt (`signedAt`).

Defaults: `hashAlgorithm = "sha256"`, `hashScope = "pdf+annotations-snapshot"`.
Ändert sich nach dem Signieren einer dieser Werte, schlägt die Verifikation fehl;
die UI zeigt **Valid / Invalid / NoHash**.

## Konsequenzen

- **+** Rein lokal, kein Zertifikat/Server, keine PDF-Modifikation nötig.
- **+** Signaturen hashen sich gegenseitig nicht → das Verschieben einer Signatur
  invalidiert keine andere.
- **−** **Bewusste Einschränkung:** Die Integritätsprüfung gilt nur innerhalb des
  Pagebound-Ökosystems (Sidecar), **nicht** für Dritt-Viewer.
- **−** Freitext-/Inhalts-Annotationen sind Teil des Hashs — Bewegen/Ändern nach
  dem Signieren macht die Signatur ungültig (gewolltes Verhalten).
- Eine spätere echte PAdES-Variante (FA-043, post-1.0) kann darüberlegen.
