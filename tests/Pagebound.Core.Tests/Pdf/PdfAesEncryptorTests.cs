using Pagebound.Infrastructure.Pdf;
using Pagebound.Infrastructure.Pdf.Encryption;
using PdfSharpCore.Drawing;
using PdfSharpCore.Pdf;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

/// <summary>
/// End-to-End-Selbst-Konsistenz für den managed AES-256-Encryptor: eine echte
/// PdfSharp-PDF wird verschlüsselt, der File-Key aus dem /Encrypt-Dictionary mit
/// dem Passwort rekonstruiert und jeder Stream wieder zum Original entschlüsselt.
/// (Der Konformitäts-Beweis gegen einen Fremd-Reader / PDF.js folgt im Browser.)
/// </summary>
public sealed class PdfAesEncryptorTests
{
    private static byte[] MakePdfWithStreams()
    {
        // FontResolver via PdfSharpManipulator-Static-Ctor setzen (Save/XGraphics
        // greifen darauf zu).
        _ = new PdfSharpManipulator();

        var doc = new PdfDocument();
        for (int i = 0; i < 2; i++)
        {
            var page = doc.AddPage();
            using var gfx = XGraphics.FromPdfPage(page);
            // Linien brauchen keine Fonts → erzeugt einen Content-Stream.
            gfx.DrawLine(XPens.Black, 10, 10, 200, 200);
            gfx.DrawRectangle(XPens.Black, 20, 20, 100, 60);
        }
        using var ms = new MemoryStream();
        doc.Save(ms);
        return ms.ToArray();
    }

    [Fact]
    public void Encrypt_ProducesV5R6Dict_AndStreamsRoundTrip()
    {
        var normalized = MakePdfWithStreams();
        var owner = AesR6.PreparePassword("owner-secret");
        var user = AesR6.PreparePassword("open-me-123");

        var originalStreams = PdfAesEncryptor.ExtractStreams(normalized);
        originalStreams.Count.ShouldBeGreaterThan(0);

        var encrypted = PdfAesEncryptor.Encrypt(normalized, owner, user, permissions: -1);

        var encText = System.Text.Encoding.Latin1.GetString(encrypted);
        encText.ShouldContain("/Filter /Standard");
        encText.ShouldContain("/V 5");
        encText.ShouldContain("/R 6");
        encText.ShouldContain("/CFM /AESV3");
        encText.ShouldContain("/StmF /StdCF");
        encText.ShouldContain("/StrF /Identity");

        PdfAesEncryptor.TryRecoverFileKey(encrypted, user, out var fileKey).ShouldBeTrue();
        fileKey.Length.ShouldBe(32);
    }

    [Fact]
    public void Encrypt_WrongPassword_DoesNotRecoverKey()
    {
        var normalized = MakePdfWithStreams();
        var encrypted = PdfAesEncryptor.Encrypt(
            normalized, AesR6.PreparePassword("owner"), AesR6.PreparePassword("right"), permissions: -1);

        PdfAesEncryptor.TryRecoverFileKey(encrypted, AesR6.PreparePassword("wrong"), out _).ShouldBeFalse();
    }

    [Fact]
    public void Encrypt_EachStream_DecryptsBackToOriginal()
    {
        var normalized = MakePdfWithStreams();
        var user = AesR6.PreparePassword("pw");
        var encrypted = PdfAesEncryptor.Encrypt(
            normalized, AesR6.PreparePassword("pw"), user, permissions: -1);

        var originalStreams = PdfAesEncryptor.ExtractStreams(normalized);
        var encryptedStreams = PdfAesEncryptor.ExtractStreams(encrypted);
        encryptedStreams.Count.ShouldBe(originalStreams.Count);

        PdfAesEncryptor.TryRecoverFileKey(encrypted, user, out var fileKey).ShouldBeTrue();

        for (int i = 0; i < encryptedStreams.Count; i++)
        {
            var decrypted = PdfAesEncryptor.DecryptStream(encryptedStreams[i], fileKey);
            decrypted.ShouldBe(originalStreams[i]);
        }
    }
}
