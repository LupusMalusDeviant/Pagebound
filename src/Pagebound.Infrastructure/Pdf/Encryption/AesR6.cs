using System.Security.Cryptography;
using System.Text;

namespace Pagebound.Infrastructure.Pdf.Encryption;

/// <summary>
/// Managed AES-256-Krypto-Kern für PDF-Verschlüsselung nach ISO 32000-2
/// (<c>/V 5</c>, <c>/R 6</c>).
///
/// <para>Nutzt ausschließlich SHA-256/384/512 + AES — <b>kein MD5</b> (anders als
/// RC4 und AES-128 / <c>V&lt;5</c>) und auch keine Per-Objekt-MD5-Schlüssel
/// (die gibt es erst ab V&lt;5). Damit vollständig Blazor-WASM-kompatibel.</para>
///
/// <para>Reiner Krypto-Kern ohne PDF-Objektmodell — die strukturelle Integration
/// (Strings/Streams verschlüsseln, <c>/Encrypt</c> setzen) übernimmt
/// <c>ManagedPdfEncryptor</c>. Methoden sind öffentlich, damit der Algorithmus
/// gegen Round-Trip-/Auth-Vektoren testbar ist.</para>
///
/// <para>Quelle: ISO 32000-2:2020 §7.6.4.3 (Algorithmen 2.A/2.B sowie 8–10).</para>
/// </summary>
public static class AesR6
{
    public const int FileKeyLength = 32;
    public const int SaltLength = 8;

    /// <summary>
    /// Passwort-Aufbereitung: UTF-8 und auf 127 Byte gekappt (ISO 32000-2).
    /// SASLprep-Normalisierung entfällt im MVP (ASCII-Passwörter sind unberührt).
    /// </summary>
    public static byte[] PreparePassword(string? password)
    {
        if (string.IsNullOrEmpty(password)) return Array.Empty<byte>();
        var bytes = Encoding.UTF8.GetBytes(password);
        return bytes.Length <= 127 ? bytes : bytes.AsSpan(0, 127).ToArray();
    }

    /// <summary>
    /// Algorithm 2.B — der iterierte Hardening-Hash. Innen-Loop nutzt AES-128-CBC
    /// (ohne Padding), die Runden-Hashes SHA-256/384/512. Läuft mindestens 64
    /// Runden und dann weiter, bis das letzte Byte von E ≤ (Runde − 32) ist.
    /// </summary>
    public static byte[] Hash2B(byte[] password, byte[] salt, byte[] udata)
    {
        byte[] k = SHA256.HashData(Concat(password, salt, udata));
        byte[] e = Array.Empty<byte>();

        for (int round = 0; round < 64 || (e[^1] & 0xFF) > round - 32; round++)
        {
            // K1 = (password || K || udata), 64-mal hintereinander.
            byte[] block = Concat(password, k, udata);
            byte[] k1 = new byte[block.Length * 64];
            for (int i = 0; i < 64; i++)
                Buffer.BlockCopy(block, 0, k1, i * block.Length, block.Length);

            // E = AES-128-CBC(no padding): Key = K[0..16], IV = K[16..32].
            e = AesCbc(k.AsSpan(0, 16).ToArray(), k.AsSpan(16, 16).ToArray(), k1, encrypt: true);

            // Modulo aus der Summe der ersten 16 Byte von E wählt den Hash.
            int sum = 0;
            for (int i = 0; i < 16; i++) sum += e[i];
            k = (sum % 3) switch
            {
                0 => SHA256.HashData(e),
                1 => SHA384.HashData(e),
                _ => SHA512.HashData(e),
            };
        }

        return k.AsSpan(0, 32).ToArray();
    }

    /// <summary>Algorithm 8 — berechnet <c>/U</c> (48 B) und <c>/UE</c> (32 B) aus dem User-Passwort.</summary>
    public static (byte[] U, byte[] UE) ComputeUserKey(
        byte[] password, byte[] fileKey, byte[] validationSalt, byte[] keySalt)
    {
        byte[] hash = Hash2B(password, validationSalt, Array.Empty<byte>());
        byte[] u = Concat(hash, validationSalt, keySalt);                // 32 + 8 + 8
        byte[] intermediate = Hash2B(password, keySalt, Array.Empty<byte>());
        byte[] ue = AesCbc(intermediate, new byte[16], fileKey, encrypt: true);
        return (u, ue);
    }

    /// <summary>Algorithm 9 — berechnet <c>/O</c> (48 B) und <c>/OE</c> (32 B) aus dem Owner-Passwort (über <c>/U</c>).</summary>
    public static (byte[] O, byte[] OE) ComputeOwnerKey(
        byte[] password, byte[] fileKey, byte[] u, byte[] validationSalt, byte[] keySalt)
    {
        byte[] hash = Hash2B(password, validationSalt, u);
        byte[] o = Concat(hash, validationSalt, keySalt);
        byte[] intermediate = Hash2B(password, keySalt, u);
        byte[] oe = AesCbc(intermediate, new byte[16], fileKey, encrypt: true);
        return (o, oe);
    }

    /// <summary>
    /// Algorithm 10 — der 16-Byte-<c>/Perms</c>-Block, AES-256-ECB ohne Padding/IV
    /// über den File-Key verschlüsselt.
    /// </summary>
    public static byte[] ComputePerms(byte[] fileKey, int permissions, bool encryptMetadata)
    {
        byte[] block = new byte[16];
        block[0] = (byte)permissions;
        block[1] = (byte)(permissions >> 8);
        block[2] = (byte)(permissions >> 16);
        block[3] = (byte)(permissions >> 24);
        block[4] = block[5] = block[6] = block[7] = 0xFF;
        block[8] = (byte)(encryptMetadata ? 'T' : 'F');
        block[9] = (byte)'a';
        block[10] = (byte)'d';
        block[11] = (byte)'b';
        RandomNumberGenerator.Fill(block.AsSpan(12, 4));
        return AesEcb(fileKey, block, encrypt: true);
    }

    /// <summary>
    /// Verschlüsselt String-/Stream-Daten für <c>/CFM /AESV3</c>: zufälliger
    /// 16-Byte-IV ‖ AES-256-CBC(PKCS7). Für V5 wird der File-Key direkt verwendet
    /// (kein Per-Objekt-Schlüssel).
    /// </summary>
    public static byte[] EncryptData(byte[] fileKey, byte[] plaintext)
    {
        byte[] iv = RandomNumberGenerator.GetBytes(16);
        using var aes = Aes.Create();
        using var enc = aes.CreateEncryptor(fileKey, iv); // Default: CBC + PKCS7
        return Concat(iv, enc.TransformFinalBlock(plaintext, 0, plaintext.Length));
    }

    /// <summary>
    /// Auth-Pfad (Algorithm 2.A, User-Seite): prüft das Passwort gegen <c>/U</c>
    /// und rekonstruiert den File-Key aus <c>/UE</c>. Dient Tests und (später) der
    /// Entschlüsselung. Gibt <c>false</c> bei falschem Passwort zurück.
    /// </summary>
    public static bool TryRecoverFileKeyFromUser(byte[] password, byte[] u, byte[] ue, out byte[] fileKey)
    {
        fileKey = Array.Empty<byte>();
        if (u.Length != 48 || ue.Length != 32) return false;

        byte[] validationSalt = u.AsSpan(32, 8).ToArray();
        byte[] keySalt = u.AsSpan(40, 8).ToArray();

        byte[] hash = Hash2B(password, validationSalt, Array.Empty<byte>());
        if (!CryptographicOperations.FixedTimeEquals(hash, u.AsSpan(0, 32)))
            return false;

        byte[] intermediate = Hash2B(password, keySalt, Array.Empty<byte>());
        fileKey = AesCbc(intermediate, new byte[16], ue, encrypt: false);
        return true;
    }

    // --- AES-Helfer -----------------------------------------------------------

    private static byte[] AesCbc(byte[] key, byte[] iv, byte[] data, bool encrypt)
    {
        using var aes = Aes.Create();
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.None;
        aes.Key = key;
        aes.IV = iv;
        using var transform = encrypt ? aes.CreateEncryptor() : aes.CreateDecryptor();
        return transform.TransformFinalBlock(data, 0, data.Length);
    }

    private static byte[] AesEcb(byte[] key, byte[] data, bool encrypt)
    {
        using var aes = Aes.Create();
        aes.Mode = CipherMode.ECB;
        aes.Padding = PaddingMode.None;
        aes.Key = key;
        using var transform = encrypt ? aes.CreateEncryptor() : aes.CreateDecryptor();
        return transform.TransformFinalBlock(data, 0, data.Length);
    }

    private static byte[] Concat(params byte[][] parts)
    {
        int total = 0;
        foreach (var p in parts) total += p.Length;

        byte[] result = new byte[total];
        int offset = 0;
        foreach (var p in parts)
        {
            Buffer.BlockCopy(p, 0, result, offset, p.Length);
            offset += p.Length;
        }
        return result;
    }
}
