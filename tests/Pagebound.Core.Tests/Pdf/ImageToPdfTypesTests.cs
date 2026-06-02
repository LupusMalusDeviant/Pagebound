using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

public sealed class ImageToPdfTypesTests
{
    [Fact]
    public void Options_Defaults_AreImageSize_NoMargin()
    {
        var options = new ImageToPdfOptions();
        options.PageSize.ShouldBe(PdfPageSizeMode.ImageSize);
        options.MarginPoints.ShouldBe(0);
    }

    [Fact]
    public void ImageInput_CarriesBytesAndMime()
    {
        var input = new PdfImageInput(new byte[] { 1, 2, 3 }, "image/png");
        input.Bytes.Length.ShouldBe(3);
        input.MimeType.ShouldBe("image/png");
    }
}
