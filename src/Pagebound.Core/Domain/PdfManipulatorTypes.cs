namespace Pagebound.Core.Domain;

/// <summary>
/// Optionen für die PDF-Komprimierung (FA-026).
/// Erste Iteration hält das Modell schlank — feinere Steuerung
/// (Subset-Fonts, Bild-Downsampling-DPI, Streams) wird mit der echten
/// Implementation in Release 0.8+ ergänzt.
/// </summary>
public sealed record CompressionOptions(
    int? ImageQuality = 75,
    bool RecompressImages = true);

/// <summary>
/// Optionen für die PDF-Verschlüsselung (FA-027).
/// </summary>
public sealed record EncryptionOptions(
    string OwnerPassword,
    string? UserPassword = null,
    EncryptionStrength Strength = EncryptionStrength.Aes128);

public enum EncryptionStrength
{
    Aes128,
    Aes256
}
