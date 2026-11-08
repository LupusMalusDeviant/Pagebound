# Signatur & Integrität

## Zweck

Drei Stufen, die oft verwechselt werden:

1. **Handschriftliche Signatur** — ein mit der Maus oder dem Finger gezeichnetes PNG, als Annotation auf der Seite. Beweist nichts kryptografisch, ist aber der häufigste Bedarf.
2. **Integritätsnachweis** — SHA-256 über die Signatur-Annotation samt der übrigen Annotationen und dem Zeitpunkt. Zeigt, ob sich nach dem Unterschreiben etwas geändert hat. Gilt **innerhalb** von Pagebound; ein fremder Betrachter kann ihn nicht prüfen.
3. **Zertifikatbasierte PAdES-Signatur** — ein echter CMS-SignedData-Container mit P12-Zertifikat, als inkrementelles Update in das PDF geschrieben. Den Container baut `sign-bridge.ts` selbst auf, weil node-forge dafür nichts Passendes liefert; die Gegenprobe läuft über ein unabhängiges .NET-Werkzeug.

## Dateien

| Pfad | Rolle |
|------|-------|
| `src/Pagebound.Infrastructure/Crypto/Sha256HashService.cs` | `IHashService` über managed SHA-256 (Stream und Speicherblock, `:13`, `:24`) |
| `src/Pagebound.Infrastructure/Crypto/IntegrityService.cs` | Hash über Signatur plus Kontext (`ComputeSignatureHashAsync`, `:40`), Prüfung einzeln (`:58`) und aller Signaturen (`:82`) |
| `src/Pagebound.Infrastructure/Pdf/JsPdfSignService.cs` | `IPdfSignService` über die Signatur-Brücke (`SignAsync`, `:25`) |
| `src/Pagebound.Web/Features/Reader/SignaturePad.razor` | Zeichenfläche für die handschriftliche Signatur |
| `src/Pagebound.Core/Domain/SignatureAnnotation.cs` | Signatur als Annotation (`:52` mappt auf die Annotationstypen) |
| `src/Pagebound.Core/Domain/SignerInfo.cs` | Angaben zum Unterzeichner |
| `src/Pagebound.Core/Domain/HashAlgorithm.cs` | Zugelassene Hash-Verfahren |
| `src/Pagebound.Web/wwwroot/js/sign-bridge.ts` | CMS/ASN.1-Aufbau von Hand (`buildCms`, `:233`; signierte Attribute `:215`; `signingCertificateV2` `:197`), P12-Zerlegung (`:278`), inkrementelles Update ins PDF (`:403`), Einstieg `signPdf` (`:467`) |
| `tools/cms-verify/Program.cs` | Unabhängige Gegenprobe: liest den erzeugten Container mit .NET-Bordmitteln und prüft die DER-Konformität |

## Abhängigkeiten

### Intern (andere Features dieses Repos)

- **Annotationen** (Typ, via `NewAnnotation`, `AnnotationType`, `Annotation`, `AnnotationPayload`): die Signatur ist eine Annotation — `src/Pagebound.Core/Domain/SignatureAnnotation.cs:52`. Siehe [`./annotationen.md`](./annotationen.md).
- **PDF-Reader & Rendering** (Typ, via `cancel`): das Signatur-Pad bricht laufende Sprachausgabe bzw. Gesten ab — `src/Pagebound.Web/Features/Reader/SignaturePad.razor:80`. Siehe [`./pdf-reader.md`](./pdf-reader.md).
- **Lokalisierung & Theme** (Querschnitt, via `ILocalizationService`): Texte — `…/SignaturePad.razor:2`. Siehe [`./lokalisierung-theme.md`](./lokalisierung-theme.md).
- **Interop-Hilfen (UI)** (Querschnitt, via `initSignaturePad`, `clearSignaturePad`, `getSignatureDataUrl`, `disposeSignaturePad`, `load`): die Zeichenfläche selbst liegt in JS — `…/SignaturePad.razor:138`. Siehe [`./interop-hilfen.md`](./interop-hilfen.md).
- **MCP-Server** (Typ, via `catalog`): **diese Kante ist eine Namensgleichheit, keine Abhängigkeit.** `src/Pagebound.Web/wwwroot/js/sign-bridge.ts:522` greift auf `doc.catalog` von pdf-lib zu; gemeint wäre `catalog()` aus `mcp/src/design.ts`. Siehe die Anmerkung unter „Kanten (geprüft)" in [`./INDEX.md`](./INDEX.md).

### Extern (Packages)

- `node-forge` — P12/PKCS#12 lesen, RSA-Signatur, ASN.1-Grundbausteine. **Nicht** für den SignedData-Container selbst.
- `pdf-lib` — Signaturfeld im AcroForm, inkrementelles Update
- Managed SHA-256 aus .NET für den Integritätsnachweis (kein WebCrypto, damit der Pfad auch ohne sicheren Kontext trägt)

## Öffentliche API / Interface

```csharp
public interface IHashService
{
    Task<string> ComputeAsync(Stream data, HashAlgorithm algorithm, CancellationToken ct);
    Task<string> ComputeAsync(ReadOnlyMemory<byte> data, HashAlgorithm algorithm, CancellationToken ct);
}

public interface IIntegrityService
{
    Task<string> ComputeSignatureHashAsync(PdfId pdfId, Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations, DateTimeOffset signedAt, CancellationToken ct);
    Task<SignatureIntegrityStatus> VerifySignatureAsync(PdfId pdfId, Annotation signatureAnnotation,
        IEnumerable<Annotation> otherAnnotations, CancellationToken ct);
    Task<IReadOnlyDictionary<AnnotationId, SignatureIntegrityStatus>> VerifyAllAsync(
        PdfId pdfId, IEnumerable<Annotation> annotations, CancellationToken ct);
}

public interface IPdfSignService
{
    Task<PdfSignResult> SignAsync(Stream pdf, byte[] certificateP12, string password,
        PdfSignOptions options, CancellationToken ct);
}
public sealed record PdfSignResult(byte[] Bytes, string SignerSubject, IReadOnlyList<string> Warnings);
public sealed record PdfSignOptions(string? Reason, string? Location, string? ContactInfo);
```

## Datenfluss / Call-Flow

**Handschriftlich plus Integritätsnachweis**

1. `SignaturePad.razor` öffnet die Zeichenfläche über die Interop-Brücke (`:138`), der Nutzer zeichnet, `getSignatureDataUrl` liefert ein PNG.
2. Der Reader legt daraus eine `SignatureAnnotation` an.
3. `IntegrityService.ComputeSignatureHashAsync` (`IntegrityService.cs:40`) bildet SHA-256 über die Signatur, die übrigen Annotationen und den Zeitpunkt; der Hash liegt in der Annotation.
4. Beim Öffnen prüft `VerifyAllAsync` (`:82`) alle Signaturen und meldet je Annotation einen `SignatureIntegrityStatus`.

**Zertifikatbasiert (PAdES)**

1. Der Nutzer wählt eine P12-Datei und gibt das Kennwort ein; `JsPdfSignService.SignAsync` (`:25`) gibt beides an die Brücke.
2. `parseP12` (`sign-bridge.ts:278`) holt Schlüssel, Signierzertifikat und Kette.
3. `signPdf` (`:467`) legt ein Signaturfeld an, reserviert den Platz für den Container, berechnet den Digest über den Bereich und ruft `buildCms` (`:233`).
4. `buildCms` setzt die SignedData-Struktur direkt zusammen, samt signierter Attribute (`:215`) und `signingCertificateV2` (`:197`).
5. `appendIncrementalUpdate` (`:403`) hängt die geänderten Objekte samt neuer xref an das Original an — die ursprünglichen Bytes bleiben unverändert, wie PAdES es verlangt.
6. Gegenprobe außerhalb der eigenen Werkzeugkette: `dotnet run --project tools/cms-verify` liest den Container mit .NET-Bordmitteln. Das ist der Punkt, an dem ein selbstgebauter Kodierer überhaupt widerlegt werden kann — der eigene Dekodierer würde den eigenen Fehler wiederholen.

## Offene Fragen / TODOs

- Es gibt **keine** Zertifikatsvalidierung gegen Vertrauensanker und keine Sperrlistenprüfung. Der Container ist formal korrekt; ob das Zertifikat vertrauenswürdig ist, entscheidet der prüfende Betrachter.
- Kein Zeitstempel von einem TSA-Dienst (das wäre PAdES-T). Der Signierzeitpunkt stammt aus dem signierten Attribut, nicht von einer unabhängigen Stelle.
- `tests/Pagebound.Web.Tests` ist eine leere Hülle; die Prüfung des Signatur-Containers hängt allein an `tools/cms-verify`, das manuell gestartet wird.
