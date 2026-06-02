using NSubstitute;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Crypto;
using Shouldly;

namespace Pagebound.Core.Tests.Crypto;

public sealed class IntegrityServiceTests
{
    private readonly IHashService _hashService = Substitute.For<IHashService>();
    private readonly IntegrityService _sut;
    private static readonly PdfId TestPdf = new("sha256ofpdf");

    public IntegrityServiceTests()
    {
        _sut = new IntegrityService(_hashService);
    }

    [Fact]
    public void Constructor_NullHashService_Throws()
    {
        Should.Throw<ArgumentNullException>(() => new IntegrityService(null!));
    }

    [Fact]
    public async Task ComputeSignatureHashAsync_NullSignature_Throws()
    {
        var others = Enumerable.Empty<Annotation>();
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.ComputeSignatureHashAsync(TestPdf, null!, others, DateTimeOffset.UtcNow, default));
    }

    [Fact]
    public async Task ComputeSignatureHashAsync_NullOthers_Throws()
    {
        var sig = MakeSignature("sig1");
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.ComputeSignatureHashAsync(TestPdf, sig, null!, DateTimeOffset.UtcNow, default));
    }

    [Fact]
    public async Task ComputeSignatureHashAsync_CallsHashService()
    {
        _hashService
            .ComputeAsync(Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<HashAlgorithm>(), default)
            .Returns("deadbeef");

        var sig = MakeSignature("sig1");
        var result = await _sut.ComputeSignatureHashAsync(
            TestPdf, sig, Enumerable.Empty<Annotation>(), DateTimeOffset.UtcNow, default);

        result.ShouldBe("deadbeef");
        await _hashService.Received(1)
            .ComputeAsync(Arg.Any<ReadOnlyMemory<byte>>(), HashAlgorithm.Sha256, default);
    }

    [Fact]
    public async Task VerifySignatureAsync_NoStoredHash_ReturnsNoHash()
    {
        var sig = MakeSignature("sig1");
        var result = await _sut.VerifySignatureAsync(TestPdf, sig, Enumerable.Empty<Annotation>(), default);

        result.ShouldBe(SignatureIntegrityStatus.NoHash);
    }

    [Fact]
    public async Task VerifySignatureAsync_MatchingHash_ReturnsValid()
    {
        const string hash = "abc123";
        _hashService
            .ComputeAsync(Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<HashAlgorithm>(), default)
            .Returns(hash);

        var sig = MakeSignatureWithHash("sig1", hash);
        var result = await _sut.VerifySignatureAsync(TestPdf, sig, Enumerable.Empty<Annotation>(), default);

        result.ShouldBe(SignatureIntegrityStatus.Valid);
    }

    [Fact]
    public async Task VerifySignatureAsync_MismatchedHash_ReturnsInvalid()
    {
        _hashService
            .ComputeAsync(Arg.Any<ReadOnlyMemory<byte>>(), Arg.Any<HashAlgorithm>(), default)
            .Returns("recomputed_different");

        var sig = MakeSignatureWithHash("sig1", "stored_original");
        var result = await _sut.VerifySignatureAsync(TestPdf, sig, Enumerable.Empty<Annotation>(), default);

        result.ShouldBe(SignatureIntegrityStatus.Invalid);
    }

    [Fact]
    public async Task VerifySignatureAsync_NullSignature_Throws()
    {
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.VerifySignatureAsync(TestPdf, null!, Enumerable.Empty<Annotation>(), default));
    }

    [Fact]
    public async Task ComputeSignatureHashAsync_OtherSignaturesAreExcluded()
    {
        // Capture what canonical string is passed to the hash service
        ReadOnlyMemory<byte> capturedInput = default;
        _hashService
            .ComputeAsync(Arg.Do<ReadOnlyMemory<byte>>(x => capturedInput = x), Arg.Any<HashAlgorithm>(), default)
            .Returns("hash1");

        var sig = MakeSignature("sig1");
        var anotherSig = MakeSignature("sig2");
        var highlight = MakeHighlight("hl1");

        await _sut.ComputeSignatureHashAsync(
            TestPdf, sig, [anotherSig, highlight], DateTimeOffset.UtcNow, default);

        var canonical = System.Text.Encoding.UTF8.GetString(capturedInput.Span);
        canonical.ShouldContain("hl1");
        canonical.ShouldNotContain("sig2");
    }

    private static Annotation MakeSignature(string id)
    {
        var newAnnotation = SignatureAnnotation.Create(
            TestPdf, 1, "data:image/png;base64,abc", 0.1, 0.2, 0.3, 0.1, DateTimeOffset.UtcNow, null);
        return new Annotation(
            new AnnotationId(id), TestPdf, AnnotationType.Signature, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, newAnnotation.Payload);
    }

    private static Annotation MakeSignatureWithHash(string id, string hash)
    {
        var sig = MakeSignature(id);
        return SignatureAnnotation.WithIntegrityHash(sig, hash);
    }

    private static Annotation MakeHighlight(string id)
    {
        var newAnnotation = HighlightAnnotation.Create(
            TestPdf, 1, [new HighlightRect(0.1, 0.2, 0.3, 0.04)], "highlighted text");
        return new Annotation(
            new AnnotationId(id), TestPdf, AnnotationType.Highlight, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, newAnnotation.Payload);
    }
}
