using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Verschlüsselt eine PDF mit Passwortschutz (FA-027).
///
/// Web-Implementierung: <c>ManagedPdfEncryptor</c> mit AES-256 (ISO 32000-2,
/// <c>/V 5 /R 6</c>) — rein managed (SHA-256/384/512 + AES, KEIN MD5) und damit
/// Blazor-WASM-tauglich. RC4 und AES-128 (<c>/V &lt; 5</c>) brauchen MD5 zur
/// Schlüsselableitung und sind im Web-Pfad bewusst nicht enthalten (siehe
/// <c>JsPdfLibManipulator</c>-Hinweis zum MD5-Crash unter WASM).
/// </summary>
public interface IPdfEncryptor
{
    /// <summary>
    /// Verschlüsselt die übergebene PDF mit Owner- (Pflicht) und optionalem
    /// User-Passwort aus <paramref name="options"/> und gibt die verschlüsselten
    /// Bytes zurück. Die Stärke ist im Web-Pfad fix AES-256.
    /// </summary>
    Task<byte[]> EncryptAsync(
        Stream pdf,
        EncryptionOptions options,
        CancellationToken cancellationToken);
}
