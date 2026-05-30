using Pagebound.Core.Domain;
using Shouldly;

namespace Pagebound.Core.Tests.Domain;

public sealed class PdfFormTypesTests
{
    [Fact]
    public void FillFormOptions_DefaultMode_IsKeepEditable()
    {
        new FillFormOptions().Mode.ShouldBe(FormSaveMode.KeepEditable);
    }

    [Fact]
    public void PdfFormField_StoresValuesAndOptions()
    {
        var field = new PdfFormField(
            Name: "country",
            Type: PdfFormFieldType.Dropdown,
            Value: new[] { "DE" },
            Options: new[] { "DE", "AT", "CH" },
            ReadOnly: false,
            Required: true,
            PageNumber: 2);

        field.Type.ShouldBe(PdfFormFieldType.Dropdown);
        field.Value.ShouldHaveSingleItem().ShouldBe("DE");
        field.Options.Count.ShouldBe(3);
        field.Required.ShouldBeTrue();
        field.PageNumber.ShouldBe(2);
    }

    [Fact]
    public void FormFieldValue_CarriesMultipleValues_ForMultiSelect()
    {
        var value = new FormFieldValue("languages", new[] { "de", "en" });

        value.Name.ShouldBe("languages");
        value.Value.ShouldBe(new[] { "de", "en" });
    }
}
