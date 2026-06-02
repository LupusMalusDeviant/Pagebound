using System.Security.Cryptography;
using System.Text;
using Pagebound.Infrastructure.Pdf.Encryption;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

/// <summary>
/// Verifiziert den managed AES-256-R6-Krypto-Kern über Selbst-Konsistenz:
/// Determinismus, Passwort-Round-Trip (File-Key-Recovery) und Daten-Round-Trip.
/// Der vollständige End-to-End-Beweis (echte verschlüsselte PDF in Reader öffnen)
/// folgt in Phase B.
/// </summary>
public sealed class AesR6Tests
{
    private static byte[] Pw(string s) => AesR6.PreparePassword(s);

    [Fact]
    public void Hash2B_IsDeterministic_And32Bytes()
    {
        var salt = RandomNumberGenerator.GetBytes(8);
        var a = AesR6.Hash2B(Pw("secret"), salt, Array.Empty<byte>());
        var b = AesR6.Hash2B(Pw("secret"), salt, Array.Empty<byte>());

        a.Length.ShouldBe(32);
        a.ShouldBe(b);
    }

    [Fact]
    public void Hash2B_DifferentPassword_DifferentHash()
    {
        var salt = new byte[8];
        AesR6.Hash2B(Pw("alpha"), salt, Array.Empty<byte>())
            .ShouldNotBe(AesR6.Hash2B(Pw("beta"), salt, Array.Empty<byte>()));
    }

    [Fact]
    public void UserKey_RoundTrip_RecoversFileKey()
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        var validationSalt = RandomNumberGenerator.GetBytes(8);
        var keySalt = RandomNumberGenerator.GetBytes(8);

        var (u, ue) = AesR6.ComputeUserKey(Pw("öffnen-123"), fileKey, validationSalt, keySalt);

        u.Length.ShouldBe(48);
        ue.Length.ShouldBe(32);

        AesR6.TryRecoverFileKeyFromUser(Pw("öffnen-123"), u, ue, out var recovered).ShouldBeTrue();
        recovered.ShouldBe(fileKey);
    }

    [Fact]
    public void UserKey_WrongPassword_Fails()
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        var (u, ue) = AesR6.ComputeUserKey(
            Pw("correct"), fileKey, RandomNumberGenerator.GetBytes(8), RandomNumberGenerator.GetBytes(8));

        AesR6.TryRecoverFileKeyFromUser(Pw("wrong"), u, ue, out _).ShouldBeFalse();
    }

    [Fact]
    public void OwnerKey_ProducesCorrectLengths()
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        var (u, _) = AesR6.ComputeUserKey(
            Pw("user"), fileKey, RandomNumberGenerator.GetBytes(8), RandomNumberGenerator.GetBytes(8));

        var (o, oe) = AesR6.ComputeOwnerKey(
            Pw("owner"), fileKey, u, RandomNumberGenerator.GetBytes(8), RandomNumberGenerator.GetBytes(8));

        o.Length.ShouldBe(48);
        oe.Length.ShouldBe(32);
    }

    [Fact]
    public void EncryptData_RoundTrips_WithIvPrefix()
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        var plain = Encoding.UTF8.GetBytes("Hallo Welt — ümläüte & sonderzeichen!");

        var encrypted = AesR6.EncryptData(fileKey, plain);
        encrypted.Length.ShouldBeGreaterThan(16); // IV (16) + mind. 1 Block

        var iv = encrypted[..16];
        using var aes = Aes.Create();
        using var dec = aes.CreateDecryptor(fileKey, iv);
        var back = dec.TransformFinalBlock(encrypted, 16, encrypted.Length - 16);

        back.ShouldBe(plain);
    }

    [Fact]
    public void ComputePerms_Returns16Bytes()
    {
        var fileKey = RandomNumberGenerator.GetBytes(32);
        AesR6.ComputePerms(fileKey, permissions: -1, encryptMetadata: true).Length.ShouldBe(16);
    }
}
