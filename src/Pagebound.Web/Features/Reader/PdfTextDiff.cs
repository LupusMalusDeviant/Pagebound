using Microsoft.JSInterop;

namespace Pagebound.Web.Features.Reader;

/// <summary>
/// Gemeinsame Engine für den PDF-Text-Vergleich (Roadmap B1, ehemals /compare).
/// Kapselt den JS-Interop-Aufruf <c>pageboundPdf.diffPdfText</c>, damit
/// Split-View (und künftige Aufrufer) nicht jeweils eigene DTO-Kopien pflegen.
/// 100 % lokal, Text-Layer-basiert (kein OCR).
/// </summary>
public static class PdfTextDiff
{
    public static async Task<PdfTextDiffResult> RunAsync(IJSRuntime js, byte[] pdfA, byte[] pdfB)
        => await js.InvokeAsync<PdfTextDiffResult>(
            "pageboundPdf.diffPdfText",
            Convert.ToBase64String(pdfA),
            Convert.ToBase64String(pdfB));
}

/// <summary>
/// Spiegelt das von <c>pageboundPdf.diffPdfText</c> gelieferte Objekt
/// (camelCase, case-insensitiv via Blazor-JS-Interop-Serializer).
/// </summary>
public sealed class PdfTextDiffResult
{
    public int PageCountA { get; set; }
    public int PageCountB { get; set; }
    public bool Changed { get; set; }
    public List<PdfTextDiffPage> Pages { get; set; } = new();
}

public sealed class PdfTextDiffPage
{
    public int Page { get; set; }
    public List<string> Added { get; set; } = new();
    public List<string> Removed { get; set; } = new();
}
