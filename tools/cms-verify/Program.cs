// Unabhängige Gegenprobe zur Pagebound-Signatur: .NET dekodiert den
// CMS-Container und prüft die Signatur, indem es die signierten Attribute NEU
// nach DER kodiert — genau der Weg, an dem eine unsortierte Attributmenge
// scheitert (und an dem Adobe nichts merkt, weil es über die empfangenen
// Bytes prüft).
using System.Formats.Asn1;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;

var pdfPath = args[0];
var pdf = File.ReadAllBytes(pdfPath);
var text = System.Text.Encoding.Latin1.GetString(pdf);

// Ein Dokument kann MEHRERE Signaturen tragen (inkrementell angehängt) —
// jede deckt ihren eigenen Byte-Bereich ab und wird einzeln geprüft.
var matches = System.Text.RegularExpressions.Regex.Matches(text, @"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]");
if (matches.Count == 0) { Console.WriteLine("FEHLER: keine /ByteRange gefunden"); return 1; }
Console.WriteLine($"Signaturen in der Datei: {matches.Count}");

var allOk = true;
var index = 0;
foreach (System.Text.RegularExpressions.Match m in matches)
{
index++;
Console.WriteLine($"\n===== Signatur {index} von {matches.Count} =====");
var br = m.Groups.Cast<System.Text.RegularExpressions.Group>().Skip(1).Select(g => int.Parse(g.Value)).ToArray();
var signedBytes = new byte[br[1] + br[3]];
Array.Copy(pdf, br[0], signedBytes, 0, br[1]);
Array.Copy(pdf, br[2], signedBytes, br[1], br[3]);

// CMS aus der /Contents-Lücke (Null-Auffüllung über die DER-Länge abschneiden).
var hex = text.Substring(br[1] + 1, br[2] - br[1] - 2);
var padded = Convert.FromHexString(hex);
var reader = new AsnReader(padded, AsnEncodingRules.DER);
var cmsBytes = reader.PeekEncodedValue().ToArray();

var cms = new SignedCms(new ContentInfo(signedBytes), detached: true);
cms.Decode(cmsBytes);

Console.WriteLine($"Signierer: {cms.SignerInfos.Count}, Zertifikate: {cms.Certificates.Count}");
var signer = cms.SignerInfos[0];
Console.WriteLine($"Zertifikat: {signer.Certificate?.Subject}");
Console.WriteLine($"Digest:     {signer.DigestAlgorithm.FriendlyName}");

Console.WriteLine("\nSignierte Attribute (in der Reihenfolge, wie .NET sie liest):");
byte[]? certHash = null;
foreach (var attr in signer.SignedAttributes)
{
    var oid = attr.Oid.Value;
    var label = oid switch
    {
        "1.2.840.113549.1.9.3" => "contentType",
        "1.2.840.113549.1.9.5" => "signingTime",
        "1.2.840.113549.1.9.4" => "messageDigest",
        "1.2.840.113549.1.9.16.2.47" => "signingCertificateV2",
        _ => "?",
    };
    Console.WriteLine($"  {oid,-30} {label}");
    if (oid == "1.2.840.113549.1.9.16.2.47")
    {
        // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
        // ESSCertIDv2 ::= SEQUENCE { hashAlgorithm DEFAULT sha256, certHash OCTET STRING, issuerSerial OPTIONAL }
        var r = new AsnReader(attr.Values[0].RawData, AsnEncodingRules.DER);
        var outer = r.ReadSequence();
        var certsSeq = outer.ReadSequence();
        var essCertId = certsSeq.ReadSequence();
        var first = essCertId.PeekTag();
        if (first.TagClass == TagClass.Universal && first.TagValue == (int)UniversalTagNumber.Sequence)
        {
            Console.WriteLine("    hashAlgorithm: ausdrücklich kodiert (DER-Vorgabewert wäre wegzulassen)");
            essCertId.ReadSequence();
        }
        else
        {
            Console.WriteLine("    hashAlgorithm: weggelassen (DER-Vorgabewert sha256) — korrekt");
        }
        certHash = essCertId.ReadOctetString();
        var hasIssuerSerial = essCertId.HasData;
        Console.WriteLine($"    certHash:      {Convert.ToHexString(certHash)[..24]}… ({certHash.Length} Bytes)");
        Console.WriteLine($"    issuerSerial:  {(hasIssuerSerial ? "vorhanden" : "FEHLT")}");
        if (hasIssuerSerial)
        {
            var issuerSerial = essCertId.ReadSequence();
            var generalNames = issuerSerial.ReadSequence();
            var dirName = generalNames.ReadSequence(new Asn1Tag(TagClass.ContextSpecific, 4, true));
            var nameBytes = dirName.ReadEncodedValue().ToArray();
            var serial = issuerSerial.ReadIntegerBytes().ToArray();
            var certIssuerRaw = signer.Certificate!.IssuerName.RawData;
            Console.WriteLine($"    Aussteller passt zum Zertifikat: {nameBytes.SequenceEqual(certIssuerRaw)}");
            var certSerial = Convert.FromHexString(signer.Certificate!.SerialNumber);
            Console.WriteLine($"    Seriennummer passt:              {serial.SequenceEqual(certSerial)}");
        }
    }
}

if (certHash is not null && signer.Certificate is not null)
{
    var actual = SHA256.HashData(signer.Certificate.RawData);
    Console.WriteLine($"\ncertHash == SHA-256(eingebettetes Zertifikat): {actual.SequenceEqual(certHash)}");
}

// --- Prüfung 1: wie der Empfänger sie bekommt --------------------------------
// SignedCms.CheckSignature prüft über die ÜBERTRAGENEN Attributbytes. Das ist
// dieselbe Nachsicht, die Adobe walten lässt — eine unsortierte Attributmenge
// fällt hier NICHT auf.
var received = false;
try
{
    cms.CheckSignature(verifySignatureOnly: true);
    received = true;
    Console.WriteLine("\n1) SignedCms.CheckSignature (über die empfangenen Bytes): BESTANDEN");
}
catch (Exception ex)
{
    Console.WriteLine($"\n1) SignedCms.CheckSignature (über die empfangenen Bytes): GESCHEITERT — {ex.GetType().Name}: {ex.Message}");
}

// --- Prüfung 2: mit DER-Neukodierung -----------------------------------------
// Der strenge Weg (BouncyCastle, eIDAS-Validatoren): die signierten Attribute
// werden nach DER NEU kodiert — ein SET wird dabei sortiert — und die Signatur
// gegen diesen Digest geprüft. Wurde ursprünglich über eine unsortierte Menge
// signiert, passt der Digest nicht mehr.
var writer = new AsnWriter(AsnEncodingRules.DER);
writer.PushSetOf();
foreach (var attr in signer.SignedAttributes)
{
    writer.PushSequence();
    writer.WriteObjectIdentifier(attr.Oid.Value!);
    writer.PushSetOf();
    foreach (var value in attr.Values) writer.WriteEncodedValue(value.RawData);
    writer.PopSetOf();
    writer.PopSequence();
}
writer.PopSetOf(); // DER: sortiert die Elemente
var canonical = writer.Encode();
var transmitted = signer.SignedAttributes.Count > 0 ? cmsBytes : Array.Empty<byte>();
Console.WriteLine($"\n2) DER-Neukodierung der Attribute: {canonical.Length} Bytes");

var reencoded = false;
using (var rsa = signer.Certificate!.GetRSAPublicKey())
{
    reencoded = rsa!.VerifyData(canonical, signer.GetSignature(), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
}
Console.WriteLine($"   Signatur über die NEU kodierten Attribute: {(reencoded ? "BESTANDEN" : "GESCHEITERT")}");
Console.WriteLine($"   → {(reencoded ? "Auch strenge Prüfer (BouncyCastle, eIDAS) akzeptieren." : "Strenge Prüfer lehnen ab, Adobe akzeptiert.")}");

_ = transmitted;
allOk = allOk && received && reencoded;
}

Console.WriteLine(allOk
    ? "\nAlle Signaturen bestehen beide Prüfungen."
    : "\nMindestens eine Signatur ist für strenge Prüfer nicht brauchbar.");
return allOk ? 0 : 1;
