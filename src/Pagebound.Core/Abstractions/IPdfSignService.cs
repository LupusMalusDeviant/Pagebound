namespace Pagebound.Core.Abstractions;

/// <summary>
/// Signiert eine PDF mit einem P12/PFX-Zertifikat — klassische PDF-32000-
/// Signatur <c>adbe.pkcs7.detached</c> mit SHA-256 und CMS/PKCS#7 inkl.
/// signierter Attribute (contentType, messageDigest, signingTime); die
/// Zertifikatskette wird eingebettet, das Signaturfeld ist unsichtbar
/// (Seite 1). In Adobe/Foxit prüfbar.
/// <b>Ehrliche Grenzen:</b> kein PAdES-B-T (kein Zeitstempel-Server — die App
/// ist offline-first), kein LTV, kein signingCertificateV2-Attribut (von
/// node-forge nicht unterstützt). PDFs mit vorhandener Signatur werden mit
/// klarer Meldung abgelehnt (kein inkrementelles Update in v1).
/// Zertifikat und Passwort werden ausschließlich lokal im Browser verarbeitet.
/// Im Browser-Pfad über die <c>pageboundSign</c>-Bridge (wwwroot/js/sign-bridge.ts);
/// MCP-Pendant: Tool <c>pdf_sign</c>.
/// </summary>
public interface IPdfSignService
{
    /// <summary>
    /// Erzeugt eine signierte Kopie der PDF. Die Eingabe bleibt unangetastet.
    /// </summary>
    /// <param name="pdf">Quell-PDF (unverschlüsselt, ohne vorhandene Signatur).</param>
    /// <param name="certificateP12">P12/PFX-Datei (privater Schlüssel + Zertifikatskette).</param>
    /// <param name="password">Passwort der P12/PFX-Datei.</param>
    /// <param name="options">Optionale Signatur-Metadaten (Grund/Ort/Kontakt).</param>
    Task<PdfSignResult> SignAsync(Stream pdf, byte[] certificateP12, string password, PdfSignOptions options, CancellationToken cancellationToken);
}

/// <summary>
/// Ergebnis der Signatur: die neuen Bytes, der Subject-String des
/// Signatur-Zertifikats (CN=…, O=…, C=…) und ehrliche Hinweise
/// (z. B. abgelaufenes Zertifikat).
/// </summary>
public sealed record PdfSignResult(byte[] Bytes, string SignerSubject, IReadOnlyList<string> Warnings);

/// <summary>Optionale Signatur-Metadaten (/Reason, /Location, /ContactInfo).</summary>
public sealed record PdfSignOptions(string? Reason, string? Location, string? ContactInfo);
