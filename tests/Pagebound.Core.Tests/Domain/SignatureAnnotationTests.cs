using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class SignatureAnnotationTests
{
    private static readonly PdfId TestPdf = new("ghi789");
    private const string TestImageUrl = "data:image/png;base64,iVBORw0KGgo=";

    [Fact]
    public void Create_SetsCorrectType()
    {
        var signedAt = new DateTimeOffset(2025, 1, 15, 10, 0, 0, TimeSpan.Zero);
        var result = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0.1, 0.2, 0.3, 0.1, signedAt);

        result.Type.ShouldBe(AnnotationType.Signature);
    }

    [Fact]
    public void Create_StoresGeometry()
    {
        var signedAt = DateTimeOffset.UtcNow;
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 2, TestImageUrl, 0.1, 0.2, 0.3, 0.15, signedAt);
        var annotation = MakeAnnotation(newAnnotation);

        SignatureAnnotation.GetX(annotation).ShouldBe(0.1);
        SignatureAnnotation.GetY(annotation).ShouldBe(0.2);
        SignatureAnnotation.GetWidth(annotation).ShouldBe(0.3);
        SignatureAnnotation.GetHeight(annotation).ShouldBe(0.15);
    }

    [Fact]
    public void Create_WithNoHash_GetIntegrityHashReturnsNull()
    {
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0, 0, 0.5, 0.1, DateTimeOffset.UtcNow, null);
        var annotation = MakeAnnotation(newAnnotation);

        SignatureAnnotation.GetIntegrityHash(annotation).ShouldBeNull();
    }

    [Fact]
    public void Create_WithHash_GetIntegrityHashReturnsIt()
    {
        var hash = "abc123def456";
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0, 0, 0.5, 0.1, DateTimeOffset.UtcNow, hash);
        var annotation = MakeAnnotation(newAnnotation);

        SignatureAnnotation.GetIntegrityHash(annotation).ShouldBe(hash);
    }

    [Fact]
    public void WithIntegrityHash_SetsHash()
    {
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0.1, 0.2, 0.3, 0.1, DateTimeOffset.UtcNow, null);
        var annotation = MakeAnnotation(newAnnotation);

        var updated = SignatureAnnotation.WithIntegrityHash(annotation, "newhash123");

        SignatureAnnotation.GetIntegrityHash(updated).ShouldBe("newhash123");
    }

    [Fact]
    public void WithIntegrityHash_PreservesGeometry()
    {
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0.1, 0.2, 0.3, 0.15, DateTimeOffset.UtcNow, null);
        var annotation = MakeAnnotation(newAnnotation);

        var updated = SignatureAnnotation.WithIntegrityHash(annotation, "hash");

        SignatureAnnotation.GetX(updated).ShouldBe(0.1);
        SignatureAnnotation.GetY(updated).ShouldBe(0.2);
        SignatureAnnotation.GetWidth(updated).ShouldBe(0.3);
        SignatureAnnotation.GetHeight(updated).ShouldBe(0.15);
    }

    [Fact]
    public void Create_WithSigner_StoresSignerInfo()
    {
        var signer = new SignerInfo("Alice Müller", "alice@example.com", "Approved", "Berlin");
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0, 0, 0.3, 0.1, DateTimeOffset.UtcNow, null, signer);
        var annotation = MakeAnnotation(newAnnotation);

        var result = SignatureAnnotation.GetSigner(annotation);
        result.Name.ShouldBe("Alice Müller");
        result.Email.ShouldBe("alice@example.com");
        result.Reason.ShouldBe("Approved");
        result.Location.ShouldBe("Berlin");
    }

    [Fact]
    public void Create_DefaultHashAlgorithm_IsSha256()
    {
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0, 0, 0.3, 0.1, DateTimeOffset.UtcNow);
        var annotation = MakeAnnotation(newAnnotation);

        SignatureAnnotation.GetHashAlgorithm(annotation).ShouldBe(SignatureAnnotation.HashAlgorithmSha256);
    }

    [Fact]
    public void GetSignedAt_ParsesStoredTimestamp()
    {
        var signedAt = new DateTimeOffset(2025, 6, 15, 12, 30, 45, TimeSpan.Zero);
        var newAnnotation = SignatureAnnotation.Create(TestPdf, 1, TestImageUrl, 0, 0, 0.3, 0.1, signedAt);
        var annotation = MakeAnnotation(newAnnotation);

        var retrieved = SignatureAnnotation.GetSignedAt(annotation);
        retrieved.Year.ShouldBe(2025);
        retrieved.Month.ShouldBe(6);
        retrieved.Day.ShouldBe(15);
    }

    private static Annotation MakeAnnotation(NewAnnotation n) =>
        new(new AnnotationId("ann-sig1"), n.PdfId, n.Type, n.PageNumber,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, n.Payload);
}
