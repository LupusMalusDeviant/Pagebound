using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Status der Integritätsprüfung einer Signatur.
/// </summary>
public enum SignatureIntegrityStatus
{
    /// <summary>Signatur hat keinen Hash gespeichert (z.B. alter Datenstand).</summary>
    NoHash,
    /// <summary>Berechneter Hash stimmt mit dem gespeicherten überein.</summary>
    Valid,
    /// <summary>Berechneter Hash weicht ab — Annotationen wurden seitdem verändert.</summary>
    Invalid
}

/// <summary>
/// Hilfsklasse für PNG-Signatur-Annotationen (FA-015, FA-016, FA-017).
///
/// Payload-Struktur:
///   imageDataUrl:   Vollständige Data-URL des PNG (mit "data:image/png;base64,")
///   x, y, width, h: Position und Größe als 0..1-Fraction der Seite
///   signedAt:       ISO-8601-Zeitstempel der Signatur
///   integrityHash:  SHA-256 über (pdfHash + sortierte andere Annotationen + signedAt)
///   hashAlgorithm:  Default "sha256"
///   hashScope:      Default "pdf+annotations-snapshot"
///
/// Erfüllt das pragmatische Anti-Adobe-Schema laut ADR-006:
/// keine PDF-Modifikation, Hash deckt PDF + Annotation-Stand zum Signaturzeitpunkt
/// ab. Eine spätere echte PAdES-Variante (FA-043, post-1.0) kann darüberlegen.
/// </summary>
public static class SignatureAnnotation
{
    public const string PayloadKeyImage = "imageDataUrl";
    public const string PayloadKeyX = "x";
    public const string PayloadKeyY = "y";
    public const string PayloadKeyWidth = "width";
    public const string PayloadKeyHeight = "height";
    public const string PayloadKeySignedAt = "signedAt";
    public const string PayloadKeyIntegrityHash = "integrityHash";
    public const string PayloadKeyHashAlgorithm = "hashAlgorithm";
    public const string PayloadKeyHashScope = "hashScope";

    public const string HashAlgorithmSha256 = "sha256";
    public const string DefaultHashScope = "pdf+annotations-snapshot";

    public static NewAnnotation Create(
        PdfId pdfId,
        int pageNumber,
        string imageDataUrl,
        double x,
        double y,
        double width,
        double height,
        DateTimeOffset signedAt,
        string? integrityHash = null) =>
        new(
            pdfId,
            AnnotationType.Signature,
            pageNumber,
            BuildPayload(imageDataUrl, x, y, width, height, signedAt, integrityHash));

    public static Annotation WithIntegrityHash(Annotation existing, string integrityHash)
    {
        var payload = BuildPayload(
            GetImageDataUrl(existing),
            GetX(existing),
            GetY(existing),
            GetWidth(existing),
            GetHeight(existing),
            GetSignedAt(existing),
            integrityHash);
        return existing with { UpdatedAt = DateTimeOffset.UtcNow, Payload = payload };
    }

    public static string GetImageDataUrl(Annotation annotation) => GetString(annotation.Payload, PayloadKeyImage);
    public static double GetX(Annotation annotation) => GetDouble(annotation.Payload, PayloadKeyX);
    public static double GetY(Annotation annotation) => GetDouble(annotation.Payload, PayloadKeyY);
    public static double GetWidth(Annotation annotation) => GetDouble(annotation.Payload, PayloadKeyWidth);
    public static double GetHeight(Annotation annotation) => GetDouble(annotation.Payload, PayloadKeyHeight);
    public static string? GetIntegrityHash(Annotation annotation)
    {
        var value = GetString(annotation.Payload, PayloadKeyIntegrityHash);
        return string.IsNullOrEmpty(value) ? null : value;
    }
    public static DateTimeOffset GetSignedAt(Annotation annotation)
    {
        var raw = GetString(annotation.Payload, PayloadKeySignedAt);
        return DateTimeOffset.TryParse(raw, out var parsed) ? parsed : annotation.CreatedAt;
    }
    public static string GetHashAlgorithm(Annotation annotation) =>
        GetString(annotation.Payload, PayloadKeyHashAlgorithm, HashAlgorithmSha256);
    public static string GetHashScope(Annotation annotation) =>
        GetString(annotation.Payload, PayloadKeyHashScope, DefaultHashScope);

    private static IReadOnlyDictionary<string, object?> BuildPayload(
        string imageDataUrl,
        double x,
        double y,
        double width,
        double height,
        DateTimeOffset signedAt,
        string? integrityHash) =>
        new Dictionary<string, object?>
        {
            [PayloadKeyImage] = imageDataUrl,
            [PayloadKeyX] = x,
            [PayloadKeyY] = y,
            [PayloadKeyWidth] = width,
            [PayloadKeyHeight] = height,
            [PayloadKeySignedAt] = signedAt.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture),
            [PayloadKeyIntegrityHash] = integrityHash,
            [PayloadKeyHashAlgorithm] = HashAlgorithmSha256,
            [PayloadKeyHashScope] = DefaultHashScope
        };

    private static double GetDouble(IReadOnlyDictionary<string, object?> payload, string key)
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return 0;
        return value switch
        {
            double d => d,
            float f => f,
            int i => i,
            long l => l,
            decimal m => (double)m,
            JsonElement el when el.ValueKind == JsonValueKind.Number => el.GetDouble(),
            string s when double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0
        };
    }

    private static string GetString(
        IReadOnlyDictionary<string, object?> payload,
        string key,
        string fallback = "")
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return fallback;
        return value switch
        {
            string s => s,
            JsonElement el when el.ValueKind == JsonValueKind.String => el.GetString() ?? fallback,
            _ => value.ToString() ?? fallback
        };
    }
}
