using NSubstitute;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;
using Pagebound.Infrastructure.Export;
using Shouldly;

namespace Pagebound.Core.Tests.Export;

public sealed class MarkdownExporterTests
{
    private readonly IAnnotationService _annotationService = Substitute.For<IAnnotationService>();
    private readonly MarkdownExporter _sut;
    private static readonly PdfId TestPdf = new("export-test-hash");

    public MarkdownExporterTests()
    {
        _sut = new MarkdownExporter(_annotationService);
    }

    [Fact]
    public void Constructor_NullAnnotationService_Throws()
    {
        Should.Throw<ArgumentNullException>(() => new MarkdownExporter(null!));
    }

    [Fact]
    public async Task ExportAsync_NullOptions_Throws()
    {
        await Should.ThrowAsync<ArgumentNullException>(
            () => _sut.ExportAsync(TestPdf, null!, default));
    }

    [Fact]
    public async Task ExportAsync_NoAnnotations_ContainsEmptyMessage()
    {
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([]);

        var options = new MarkdownExportOptions(IncludeHighlights: true, IncludeNotes: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("keine Annotationen");
    }

    [Fact]
    public async Task ExportAsync_WithHighlight_ContainsBlockquote()
    {
        var highlight = MakeHighlight("hl1", 1, 0.1, "Important finding");
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([highlight]);

        var options = new MarkdownExportOptions(IncludeHighlights: true, IncludeNotes: false);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("> Important finding");
    }

    [Fact]
    public async Task ExportAsync_WithStickyNote_ContainsNoteHeading()
    {
        var note = MakeStickyNote("note1", 1, 0.5, "My markdown note");
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([note]);

        var options = new MarkdownExportOptions(IncludeHighlights: false, IncludeNotes: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("**Notiz:**");
        result.ShouldContain("My markdown note");
    }

    [Fact]
    public async Task ExportAsync_WithFrontmatter_ContainsYamlBlock()
    {
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([]);

        var options = new MarkdownExportOptions(
            Title: "My PDF",
            SourceFilename: "document.pdf",
            IncludeYamlFrontmatter: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldStartWith("---");
        result.ShouldContain("pdfHash:");
        result.ShouldContain("exportedBy: \"Pagebound\"");
    }

    [Fact]
    public async Task ExportAsync_WithoutFrontmatter_DoesNotContainYaml()
    {
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([]);

        var options = new MarkdownExportOptions(IncludeYamlFrontmatter: false);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldNotStartWith("---");
        result.ShouldNotContain("pdfHash:");
    }

    [Fact]
    public async Task ExportAsync_OnlyHighlights_ExcludesNotes()
    {
        var highlight = MakeHighlight("hl1", 1, 0.1, "highlighted");
        var note = MakeStickyNote("note1", 1, 0.5, "my note");
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([highlight, note]);

        var options = new MarkdownExportOptions(IncludeHighlights: true, IncludeNotes: false);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("> highlighted");
        result.ShouldNotContain("**Notiz:**");
    }

    [Fact]
    public async Task ExportAsync_OnlyNotes_ExcludesHighlights()
    {
        var highlight = MakeHighlight("hl1", 1, 0.1, "highlighted text");
        var note = MakeStickyNote("note1", 1, 0.5, "my note content");
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([highlight, note]);

        var options = new MarkdownExportOptions(IncludeHighlights: false, IncludeNotes: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldNotContain("> highlighted text");
        result.ShouldContain("my note content");
    }

    [Fact]
    public async Task ExportAsync_MultiplePages_OrderedByPage()
    {
        var highlightP3 = MakeHighlight("hl3", 3, 0.1, "page 3 text");
        var highlightP1 = MakeHighlight("hl1", 1, 0.1, "page 1 text");
        var highlightP2 = MakeHighlight("hl2", 2, 0.1, "page 2 text");

        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([highlightP3, highlightP1, highlightP2]);

        var options = new MarkdownExportOptions(IncludeHighlights: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        var page1Idx = result.IndexOf("## Seite 1", StringComparison.Ordinal);
        var page2Idx = result.IndexOf("## Seite 2", StringComparison.Ordinal);
        var page3Idx = result.IndexOf("## Seite 3", StringComparison.Ordinal);

        page1Idx.ShouldBeLessThan(page2Idx);
        page2Idx.ShouldBeLessThan(page3Idx);
    }

    [Fact]
    public async Task ExportAsync_Title_AppearsAsH1()
    {
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([]);

        var options = new MarkdownExportOptions(Title: "My Research Paper");
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("# My Research Paper");
    }

    [Fact]
    public async Task ExportAsync_WikilinksEnabled_SourceHasWikilinkFormat()
    {
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([]);

        var options = new MarkdownExportOptions(
            IncludeYamlFrontmatter: true,
            SourceFilename: "my-paper.pdf",
            UseWikilinks: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("[[my-paper.pdf]]");
    }

    [Fact]
    public async Task ExportAsync_EmptyStickyNote_ContainsEmptyNoteMessage()
    {
        var note = MakeStickyNote("note1", 1, 0.5, "");
        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([note]);

        var options = new MarkdownExportOptions(IncludeNotes: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        result.ShouldContain("_(leere Notiz)_");
    }

    [Fact]
    public async Task ExportAsync_AnnotationsOnSamePage_OrderedByYPosition()
    {
        var topHighlight = MakeHighlight("hl-top", 1, 0.1, "top of page");
        var bottomHighlight = MakeHighlight("hl-bottom", 1, 0.9, "bottom of page");

        _annotationService.GetForDocumentAsync(TestPdf, default)
            .Returns([bottomHighlight, topHighlight]);

        var options = new MarkdownExportOptions(IncludeHighlights: true);
        var result = await _sut.ExportAsync(TestPdf, options, default);

        var topIdx = result.IndexOf("top of page", StringComparison.Ordinal);
        var bottomIdx = result.IndexOf("bottom of page", StringComparison.Ordinal);

        topIdx.ShouldBeLessThan(bottomIdx);
    }

    private static Annotation MakeHighlight(string id, int page, double y, string text)
    {
        var newAnnotation = HighlightAnnotation.Create(
            TestPdf, page,
            [new HighlightRect(0.0, y, 0.8, 0.04)],
            text);
        return new Annotation(
            new AnnotationId(id), TestPdf, AnnotationType.Highlight, page,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, newAnnotation.Payload);
    }

    private static Annotation MakeStickyNote(string id, int page, double y, string content)
    {
        var newAnnotation = StickyNoteAnnotation.Create(TestPdf, page, 0.5, y, content);
        return new Annotation(
            new AnnotationId(id), TestPdf, AnnotationType.StickyNote, page,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, newAnnotation.Payload);
    }
}
