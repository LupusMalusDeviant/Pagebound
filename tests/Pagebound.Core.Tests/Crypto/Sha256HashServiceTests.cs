using System.Text;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Crypto;
using Shouldly;

namespace Pagebound.Core.Tests.Crypto;

public sealed class Sha256HashServiceTests
{
    private readonly Sha256HashService _sut = new();

    [Fact]
    public async Task ComputeAsync_Stream_Sha256_ReturnsLowercaseHex()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("hello"));

        var hash = await _sut.ComputeAsync(stream, HashAlgorithm.Sha256, default);

        hash.ShouldBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    [Fact]
    public async Task ComputeAsync_Memory_Sha256_ReturnsLowercaseHex()
    {
        var data = new ReadOnlyMemory<byte>(Encoding.UTF8.GetBytes("hello"));

        var hash = await _sut.ComputeAsync(data, HashAlgorithm.Sha256, default);

        hash.ShouldBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    [Fact]
    public async Task ComputeAsync_Stream_Sha384_Returns96CharHex()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("hello"));

        var hash = await _sut.ComputeAsync(stream, HashAlgorithm.Sha384, default);

        hash.Length.ShouldBe(96);
        hash.ShouldBe(hash.ToLowerInvariant());
    }

    [Fact]
    public async Task ComputeAsync_Stream_Sha512_Returns128CharHex()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("hello"));

        var hash = await _sut.ComputeAsync(stream, HashAlgorithm.Sha512, default);

        hash.Length.ShouldBe(128);
        hash.ShouldBe(hash.ToLowerInvariant());
    }

    [Fact]
    public async Task ComputeAsync_UnknownAlgorithm_Throws()
    {
        using var stream = new MemoryStream([1, 2, 3]);
        var unknownAlgorithm = (HashAlgorithm)999;

        await Should.ThrowAsync<ArgumentOutOfRangeException>(
            () => _sut.ComputeAsync(stream, unknownAlgorithm, default));
    }

    [Fact]
    public async Task ComputeAsync_NullStream_Throws()
    {
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.ComputeAsync((Stream)null!, HashAlgorithm.Sha256, default));
    }

    [Fact]
    public async Task ComputeAsync_EmptyInput_ReturnsKnownHash()
    {
        using var stream = new MemoryStream([]);

        var hash = await _sut.ComputeAsync(stream, HashAlgorithm.Sha256, default);

        hash.ShouldBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    [Fact]
    public async Task ComputeAsync_SameInput_Stream_AndMemory_ProduceSameHash()
    {
        var data = Encoding.UTF8.GetBytes("pagebound test data");
        using var stream = new MemoryStream(data);
        var memory = new ReadOnlyMemory<byte>(data);

        var hashStream = await _sut.ComputeAsync(stream, HashAlgorithm.Sha256, default);
        var hashMemory = await _sut.ComputeAsync(memory, HashAlgorithm.Sha256, default);

        hashStream.ShouldBe(hashMemory);
    }

    [Fact]
    public async Task ComputeAsync_DifferentInput_ProducesDifferentHash()
    {
        var hash1 = await _sut.ComputeAsync(
            new ReadOnlyMemory<byte>(Encoding.UTF8.GetBytes("input one")),
            HashAlgorithm.Sha256, default);
        var hash2 = await _sut.ComputeAsync(
            new ReadOnlyMemory<byte>(Encoding.UTF8.GetBytes("input two")),
            HashAlgorithm.Sha256, default);

        hash1.ShouldNotBe(hash2);
    }
}
