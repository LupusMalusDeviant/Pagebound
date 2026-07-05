using Microsoft.JSInterop;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Pdf;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

/// <summary>
/// Pinnt den Dispatch-Vertrag für den SVG-Export in <see cref="JsPdfConverter"/>:
/// ConversionFormat.Svg ruft die Bridge-Funktion <c>pageboundPdf.convertToSvgZip</c>
/// und verpackt das Ergebnis als ZIP. Prüft außerdem den Fehlerpfad (Bridge wirft →
/// kontrollierte Propagation ohne Secret-/PDF-Leak) und den Leer-PDF-Guard.
/// Die eigentliche SVG-Erzeugung ist JS-Interop und wird im Browser verifiziert.
/// </summary>
public sealed class SvgConversionTests
{
    // Minimaler IJSRuntime-Fake: liefert konfigurierte Bytes oder wirft. Kein Mock-Lib.
    private sealed class FakeJsRuntime : IJSRuntime
    {
        private readonly byte[]? _result;
        private readonly Exception? _throw;
        public string? LastIdentifier { get; private set; }

        public FakeJsRuntime(byte[]? result = null, Exception? toThrow = null)
        {
            _result = result;
            _throw = toThrow;
        }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
            => InvokeAsync<TValue>(identifier, CancellationToken.None, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            LastIdentifier = identifier;
            if (_throw is not null)
            {
                throw _throw;
            }
            return new ValueTask<TValue>((TValue)(object)(_result ?? Array.Empty<byte>()));
        }
    }

    private static byte[] SamplePdf() => new byte[] { 0x25, 0x50, 0x44, 0x46 }; // "%PDF"

    [Fact]
    public async Task Svg_MultiPage_PkBytes_ReturnsZip()
    {
        var zip = new byte[] { 0x50, 0x4B, 3, 4 }; // "PK.." = ZIP-Magic-Byte
        var js = new FakeJsRuntime(result: zip);
        var converter = new JsPdfConverter(js);

        var result = await converter.ConvertAsync(SamplePdf(), ConversionFormat.Svg, CancellationToken.None);

        js.LastIdentifier.ShouldBe("pageboundPdf.convertToSvg");
        result.FileExtension.ShouldBe("zip");
        result.MimeType.ShouldBe("application/zip");
        result.Bytes.ShouldBe(zip);
    }

    [Fact]
    public async Task Svg_SinglePage_SvgBytes_ReturnsSvg()
    {
        var svg = System.Text.Encoding.UTF8.GetBytes("<svg/>"); // beginnt mit "<", kein ZIP
        var js = new FakeJsRuntime(result: svg);
        var converter = new JsPdfConverter(js);

        var result = await converter.ConvertAsync(SamplePdf(), ConversionFormat.Svg, CancellationToken.None);

        js.LastIdentifier.ShouldBe("pageboundPdf.convertToSvg");
        result.FileExtension.ShouldBe("svg");
        result.MimeType.ShouldBe("image/svg+xml");
    }

    [Fact]
    public async Task Svg_EmptyPdf_Throws()
    {
        var converter = new JsPdfConverter(new FakeJsRuntime());

        await Should.ThrowAsync<ArgumentException>(() =>
            converter.ConvertAsync(Array.Empty<byte>(), ConversionFormat.Svg, CancellationToken.None));
    }

    [Fact]
    public async Task Svg_BridgeThrows_PropagatesControlledErrorWithoutLeak()
    {
        // Bridge (z. B. korruptes PDF) wirft → ConvertAsync propagiert kontrolliert,
        // die Meldung enthält KEINE rohen PDF-Bytes/internen Zustand (Secret-Sicherheit).
        var boom = new InvalidOperationException("bridge failure");
        var converter = new JsPdfConverter(new FakeJsRuntime(toThrow: boom));

        var ex = await Should.ThrowAsync<InvalidOperationException>(() =>
            converter.ConvertAsync(SamplePdf(), ConversionFormat.Svg, CancellationToken.None));

        ex.Message.ShouldBe("bridge failure");
        ex.Message.ShouldNotContain("%PDF");
    }
}
