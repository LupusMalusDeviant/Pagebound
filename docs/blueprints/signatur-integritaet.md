# Signatur & Integrität

## Zweck

Bild-basierte Unterschrift (PNG) mit Signer-Metadaten plus nachvollziehbarer Integritätsprüfung — komplett lokal, ohne PKI/Server. Die Signatur kann als PNG **hochgeladen** oder direkt **auf einem Canvas gezeichnet** werden (`SignaturePad.razor` + `pageboundShortcuts.*SignaturePad*` — Pointer-Zeichnen im JS, Ergebnis als PNG-Data-URL, danach identischer Platzier-/Einbrenn-Pfad). Statt PDF-Re-Hashing wird (laut ADR-006, pragmatische Variante) ein kombinierter SHA-256-Hash gebildet über: (1) den SHA-256 der Original-PDF (= `PdfId`), (2) den deterministisch serialisierten Annotation-Snapshot ohne die Signatur selbst, (3) den Signaturzeitpunkt. Ändert sich nach dem Signieren einer dieser Werte, schlägt die Verifikation fehl. Die UI zeigt den Zustand als Status-Badge: **Valid / Invalid / NoHash**. Erfüllt FA-016/FA-017.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Core/Domain/SignatureAnnotation.cs` | Payload-Helfer für die Signatur-Annotation (PNG-Bild, Position, Hash-Feld) |
| `src/Pagebound.Core/Domain/SignerInfo.cs` | Signer-Metadaten (Name usw.), Teil der Signatur |
| `src/Pagebound.Core/Domain/HashAlgorithm.cs` | Hash-Algorithmus-Domain-Typ |
| `src/Pagebound.Core/Abstractions/IIntegrityService.cs` | Berechnung + Verifikation des Signatur-Hashes |
| `src/Pagebound.Core/Abstractions/IHashService.cs` | Hash-Abstraktion (SHA-256) |
| `src/Pagebound.Infrastructure/Crypto/IntegrityService.cs` | Implementierung: deterministische Serialisierung + kombinierter Hash |
| `src/Pagebound.Infrastructure/Crypto/Sha256HashService.cs` | SHA-256-Implementierung von `IHashService` |
| `src/Pagebound.Web/Features/Reader/ReaderPane.razor` | Platzierung der Signatur auf der Seite, Status-Badge, Export-Auslösung |
| `src/Pagebound.Infrastructure/Pdf/JsPdfLibManipulator.cs` | `EmbedSignaturesAsync`: PNG-Signaturen beim Export fest ins PDF einbetten |

## Abhängigkeiten

### Intern (andere Features dieses Repos)
- **Annotationen** — die Signatur ist ein `AnnotationType.Signature` und nutzt dieselbe CRUD-/Persistenz-Infrastruktur; das übrige Annotation-Set fließt in den Hash ein. Siehe [`./annotationen.md`](./annotationen.md).
- **PDF-Reader & Viewer** — Platzierung und Anzeige auf dem gerenderten Seiten-Canvas. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Storage & Persistenz** — Ablage der Signatur inkl. Hash im Sidecar/IndexedDB; die `PdfId` selbst ist der SHA-256 der Datei. Siehe [`./storage-persistenz.md`](./storage-persistenz.md).
- **PDF-Werkzeuge** — Export via gemeinsamem `JsPdfLibManipulator`. Siehe [`./pdf-werkzeuge.md`](./pdf-werkzeuge.md).

### Extern (Packages)
- `pdf-lib` (via `pdf-manipulator-bridge.ts`) — Einbetten der PNG-Signatur beim Export

## Öffentliche API / Interface

```csharp
public interface IIntegrityService
{
    Task<string> ComputeSignatureHashAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        DateTimeOffset signedAt,
        CancellationToken cancellationToken);

    Task<SignatureIntegrityStatus> VerifySignatureAsync(
        PdfId pdfId,
        Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations,
        CancellationToken cancellationToken);
}
```

`SignatureIntegrityStatus` bildet die drei Badge-Zustände ab: gültig (Hash stimmt), ungültig (Dokument/Annotationen nach dem Signieren verändert), kein Hash vorhanden (Alt-Signatur ohne Integritätsdaten).

## Datenfluss / Call-Flow

1. **Signieren:** Nutzer platziert PNG-Signatur in `ReaderPane.razor` → Signatur-Annotation mit `SignerInfo` wird angelegt → `ComputeSignatureHashAsync(pdfId, signatur, übrigeAnnotationen, signedAt)` → Hash wird im Signatur-Payload gespeichert und mitpersistiert.
2. **Verifizieren:** Beim Öffnen/Anzeigen → `VerifySignatureAsync` rechnet den Hash mit dem aktuellen Zustand nach → Ergebnis steuert das Status-Badge (Valid/Invalid/NoHash).
3. **Export:** `JsPdfLibManipulator.EmbedSignaturesAsync` bettet die PNG-Signatur(en) beim PDF-Export fest ins Dokument ein.

## Offene Fragen / TODOs

- Bewusste Einschränkung (ADR-006): keine kryptografische PDF-Signatur nach PAdES — Integritätsprüfung gilt nur innerhalb des Pagebound-Ökosystems (Sidecar), nicht für Dritt-Viewer.
