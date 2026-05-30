using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Pdf;
using Shouldly;

namespace Pagebound.Core.Tests.Pdf;

/// <summary>
/// Pinnt den Token-Vertrag zwischen der pdf-lib-Bridge (liefert den Feldtyp als
/// String) und dem Domain-Enum. Bricht ein Rename des Enums oder ein Tippfehler
/// in einem der Token-Strings, fällt einer dieser Tests um.
/// </summary>
public sealed class JsPdfFormServiceTests
{
    [Theory]
    [InlineData("Text", PdfFormFieldType.Text)]
    [InlineData("Checkbox", PdfFormFieldType.Checkbox)]
    [InlineData("Radio", PdfFormFieldType.Radio)]
    [InlineData("Dropdown", PdfFormFieldType.Dropdown)]
    [InlineData("ListBox", PdfFormFieldType.ListBox)]
    public void ParseType_MapsBridgeTokens(string token, PdfFormFieldType expected)
    {
        JsPdfFormService.ParseType(token).ShouldBe(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Signature")] // bewusst nicht unterstützt
    [InlineData("checkbox")]  // case-sensitive: Kleinschreibung ist kein Treffer
    public void ParseType_UnknownToken_FallsBackToText(string? token)
    {
        JsPdfFormService.ParseType(token).ShouldBe(PdfFormFieldType.Text);
    }
}
