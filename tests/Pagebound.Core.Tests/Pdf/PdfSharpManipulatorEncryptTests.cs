using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Pdf;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

public sealed class PdfSharpManipulatorEncryptTests
{
    private readonly PdfSharpManipulator _sut = new();

    // --- Argument validation --------------------------------------------------

    [Fact]
    public async Task EncryptAsync_NullPdf_Throws()
    {
        var options = new EncryptionOptions("owner123");
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.EncryptAsync(null!, options, default));
    }

    [Fact]
    public async Task EncryptAsync_NullOptions_Throws()
    {
        await using var stream = CreateTestPdfStream();
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.EncryptAsync(stream, null!, default));
    }

    [Fact]
    public async Task EncryptAsync_EmptyOwnerPassword_Throws()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("");
        await Should.ThrowAsync<ArgumentException>(
            () => _sut.EncryptAsync(stream, options, default));
    }

    [Fact]
    public async Task EncryptAsync_Aes256Strength_ThrowsNotSupported()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123", Strength: EncryptionStrength.Aes256);
        await Should.ThrowAsync<NotSupportedException>(
            () => _sut.EncryptAsync(stream, options, default));
    }

    // --- Success paths --------------------------------------------------------

    [Fact]
    public async Task EncryptAsync_OwnerPasswordOnly_ReturnsPdfBytes()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123");

        var result = await _sut.EncryptAsync(stream, options, default);

        result.ShouldNotBeNull();
        result.Length.ShouldBeGreaterThan(0);
        IsPdfHeader(result).ShouldBeTrue();
    }

    [Fact]
    public async Task EncryptAsync_OwnerAndUserPassword_ReturnsPdfBytes()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123", "user456");

        var result = await _sut.EncryptAsync(stream, options, default);

        result.ShouldNotBeNull();
        result.Length.ShouldBeGreaterThan(0);
        IsPdfHeader(result).ShouldBeTrue();
    }

    [Fact]
    public async Task EncryptAsync_OwnerPasswordOnly_OutputContainsEncryptEntry()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123");

        var result = await _sut.EncryptAsync(stream, options, default);

        // The /Encrypt key is present in plain ASCII in the PDF trailer.
        var content = System.Text.Encoding.Latin1.GetString(result);
        content.ShouldContain("/Encrypt");
    }

    [Fact]
    public async Task EncryptAsync_Aes128Strength_IsAccepted()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123", Strength: EncryptionStrength.Aes128);

        var result = await _sut.EncryptAsync(stream, options, default);

        result.ShouldNotBeNull();
        result.Length.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task EncryptAsync_CancellationRequested_Throws()
    {
        await using var stream = CreateTestPdfStream();
        var options = new EncryptionOptions("owner123");
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Should.ThrowAsync<OperationCanceledException>(
            () => _sut.EncryptAsync(stream, options, cts.Token));
    }

    // --- Helpers --------------------------------------------------------------

    private static MemoryStream CreateTestPdfStream()
    {
        var doc = new PdfDocument();
        doc.AddPage();
        var ms = new MemoryStream();
        doc.Save(ms);
        ms.Position = 0;
        return ms;
    }

    private static bool IsPdfHeader(byte[] bytes)
        => bytes.Length >= 4
           && bytes[0] == (byte)'%'
           && bytes[1] == (byte)'P'
           && bytes[2] == (byte)'D'
           && bytes[3] == (byte)'F';
}
