using Microsoft.JSInterop;
using Pagebound.Core.Abstractions;
using Pagebound.Core.Domain;

namespace Pagebound.Infrastructure.Pdf;

/// <summary>
/// <see cref="IPdfManipulator"/>-Implementation für Blazor WASM — vollständig
/// über <c>pdf-lib</c> (JS-Bridge). Seiten-Operationen (Merge/Split/Reorder/
/// Delete/Rotate) nutzen pdf-libs <c>copyPages</c>/<c>setRotation</c>/<c>save</c>,
/// Compress die PDF.js-Rasterung, Signatur-Embed pdf-libs Draw-API,
/// Verschlüsselung den managed <see cref="IPdfEncryptor"/>.
///
/// Bewusst KEIN PdfSharpCore: dessen Save-Pfad ruft (auch bei plainem Save) im
/// Konstruktor des <c>PdfStandardSecurityHandler</c> <c>MD5.Create()</c> auf —
/// das schlägt unter Blazor WASM mit <c>TargetInvocationException</c> fehl
/// (CryptoConfig-Reflection kennt MD5 nicht). pdf-lib hat diese Abhängigkeit
/// nicht (verifiziert im Browser-Smoke-Test, 2026-05).
/// </summary>
public sealed class JsPdfLibManipulator : IPdfManipulator
{
    private readonly IJSRuntime _js;
    private readonly IPdfEncryptor _encryptor;

    public JsPdfLibManipulator(IJSRuntime js, IPdfEncryptor encryptor)
    {
        _js = js;
        _encryptor = encryptor;
    }

    public async Task<byte[]> MergeAsync(IReadOnlyList<Stream> pdfs, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdfs);
        if (pdfs.Count == 0) throw new ArgumentException("Mindestens eine PDF erforderlich.", nameof(pdfs));

        var base64 = new string[pdfs.Count];
        for (var i = 0; i < pdfs.Count; i++)
            base64[i] = Convert.ToBase64String(await ReadAllAsync(pdfs[i], cancellationToken).ConfigureAwait(false));

        return await InvokeBytesAsync("mergePdfs", cancellationToken, new object[] { base64 }).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<byte[]>> SplitAsync(Stream pdf, IReadOnlyList<int> splitAfterPages, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(splitAfterPages);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        try
        {
            var parts = await _js.InvokeAsync<string[]>(
                "pageboundPdfManipulator.splitPdf", cancellationToken, bytes, splitAfterPages.ToArray()).ConfigureAwait(false);
            return parts.Select(Convert.FromBase64String).ToList();
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:split] pdf-lib splitPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> ReorderAsync(Stream pdf, IReadOnlyList<int> newOrder, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(newOrder);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        return await InvokeBytesAsync("reorderPdf", cancellationToken, new object[] { bytes, newOrder.ToArray() }).ConfigureAwait(false);
    }

    public async Task<byte[]> DeletePagesAsync(Stream pdf, IReadOnlyList<int> pageIndices, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pageIndices);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        return await InvokeBytesAsync("deletePages", cancellationToken, new object[] { bytes, pageIndices.ToArray() }).ConfigureAwait(false);
    }

    public async Task<byte[]> RotateAsync(Stream pdf, IReadOnlyDictionary<int, int> rotationDegrees, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rotationDegrees);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        // Dictionary<int,int> → JSON-Objekt {"<seite>": <grad>}; pdf-lib liest Object.entries.
        var map = rotationDegrees.ToDictionary(
            kv => kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv => kv.Value);
        return await InvokeBytesAsync("rotatePages", cancellationToken, new object[] { bytes, map }).ConfigureAwait(false);
    }

    public async Task<byte[]> CompressAsync(
        Stream pdf,
        CompressionOptions options,
        IProgress<int>? progress,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(options);

        // PDF einlesen — die JS-Bridge nimmt Uint8Array entgegen.
        byte[] pdfBytes;
        await using (var ms = new MemoryStream())
        {
            await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
            pdfBytes = ms.ToArray();
        }

        // ImageQuality im Domain-Modell ist 1..100, JS erwartet 0.1..0.95.
        var quality = (options.ImageQuality ?? 75) / 100.0;
        quality = Math.Clamp(quality, 0.1, 0.95);

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.compressPdf",
                cancellationToken,
                pdfBytes,
                new { imageQuality = quality }).ConfigureAwait(false);
            return result ?? pdfBytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:compress] pdf-lib/PDF.js Re-Rasterize fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    // Verschlüsselung läuft managed über AES-256 (ISO 32000-2 V5/R6) im
    // ManagedPdfEncryptor — NICHT über PdfSharpCore, dessen Security-Handler in
    // WASM am MD5 crasht. V5/R6 nutzt nur SHA-256/384/512 + AES (FA-027, ADR-004).
    public Task<byte[]> EncryptAsync(Stream pdf, EncryptionOptions options, CancellationToken cancellationToken) =>
        _encryptor.EncryptAsync(pdf, options, cancellationToken);

    public async Task<byte[]> EmbedSignaturesAsync(
        Stream pdf,
        IReadOnlyList<EmbeddedSignature> signatures,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(signatures);

        // PDF einmal in ein byte[] kopieren (JS-Interop will Uint8Array, kein Stream).
        byte[] pdfBytes;
        await using (var ms = new MemoryStream())
        {
            await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
            pdfBytes = ms.ToArray();
        }

        if (signatures.Count == 0)
        {
            return pdfBytes;
        }

        // Payload für die JS-Bridge zusammenstellen. Die Property-Namen müssen
        // exakt zu EmbeddedSignatureInput in pdf-manipulator-bridge.ts passen
        // (camelCase, weil System.Text.Json-Default).
        var payload = signatures.Select(s => new JsEmbeddedSignature
        {
            PageNumber = s.PageNumber,
            ImageBytes = s.ImageBytes,
            X = s.X,
            Y = s.Y,
            Width = s.Width,
            Height = s.Height,
            SignedAtIso = s.SignedAt.ToUniversalTime().ToString("o", System.Globalization.CultureInfo.InvariantCulture),
            SignerName = s.Signer.Name ?? string.Empty,
            SignerEmail = string.IsNullOrWhiteSpace(s.Signer.Email) ? null : s.Signer.Email,
            SignerReason = string.IsNullOrWhiteSpace(s.Signer.Reason) ? null : s.Signer.Reason,
            SignerLocation = string.IsNullOrWhiteSpace(s.Signer.Location) ? null : s.Signer.Location,
            IntegrityHash = string.IsNullOrWhiteSpace(s.IntegrityHash) ? null : s.IntegrityHash
        }).ToArray();

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.embedSignatures",
                cancellationToken,
                pdfBytes,
                payload).ConfigureAwait(false);
            return result ?? pdfBytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:js-embed] pdf-lib embedSignatures fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> StampAsync(Stream pdf, StampOptions o, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(o);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);

        // Property-Namen müssen exakt zu StampOptions in der Bridge passen (camelCase).
        var payload = new
        {
            watermarkText = string.IsNullOrWhiteSpace(o.WatermarkText) ? null : o.WatermarkText,
            watermarkOpacity = o.WatermarkOpacity,
            watermarkFontSize = o.WatermarkFontSize,
            pageNumbers = o.PageNumbers,
            pageNumberFormat = o.PageNumberFormat,
            pageNumberPosition = o.PageNumberPosition switch
            {
                PageNumberPosition.BottomRight => "bottom-right",
                PageNumberPosition.BottomLeft => "bottom-left",
                _ => "bottom-center",
            },
            pageNumberFontSize = o.PageNumberFontSize,
            pageNumberStartAt = o.PageNumberStartAt,
        };

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.stampPdf", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:stamp] pdf-lib stampPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> FlattenAnnotationsAsync(
        Stream pdf,
        IReadOnlyList<Annotation> annotations,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(annotations);

        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (annotations.Count == 0) return bytes;

        var items = ProjectAnnotations(annotations);
        if (items.Count == 0) return bytes;

        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.flattenAnnotations", cancellationToken, bytes, items.ToArray()).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:flatten] pdf-lib flattenAnnotations fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    /// <summary>
    /// Domain-Annotationen → flache DTOs für die Brücke (camelCase via STJ).
    /// EINE Projektion für beide Wege — Einbrennen und <c>/Annots</c>. Zwei
    /// parallele Projektionen wären zwei Stellen, an denen die Koordinaten
    /// auseinanderlaufen können (Vertrag
    /// <c>docs/contracts/annotationen-als-pdf-annots.md</c>).
    /// Koordinaten bleiben 0..1 mit Ursprung oben-links; die Brücke rechnet pro
    /// Seite um.
    /// </summary>
    private static List<JsFlattenItem> ProjectAnnotations(IReadOnlyList<Annotation> annotations)
    {
        var items = new List<JsFlattenItem>(annotations.Count);
        foreach (var a in annotations)
        {
            var before = items.Count;
            switch (a.Type)
            {
                case AnnotationType.Highlight:
                    items.Add(new JsFlattenItem
                    {
                        Kind = "highlight",
                        PageNumber = a.PageNumber,
                        Color = HighlightAnnotation.GetColor(a),
                        Rects = HighlightAnnotation.GetRects(a)
                            .Select(r => new JsRect { X = r.X, Y = r.Y, W = r.Width, H = r.Height }).ToArray()
                    });
                    break;

                case AnnotationType.Ink:
                    items.Add(new JsFlattenItem
                    {
                        Kind = "ink",
                        PageNumber = a.PageNumber,
                        Color = InkAnnotation.GetColor(a),
                        StrokeWidth = InkAnnotation.GetStrokeWidth(a),
                        Strokes = InkAnnotation.GetStrokes(a)
                            .Select(s => s.Points.Select(p => new JsPoint { X = p.X, Y = p.Y }).ToArray()).ToArray()
                    });
                    break;

                case AnnotationType.Shape:
                    items.Add(new JsFlattenItem
                    {
                        Kind = "shape",
                        PageNumber = a.PageNumber,
                        Color = ShapeAnnotation.GetColor(a),
                        StrokeWidth = ShapeAnnotation.GetStrokeWidth(a),
                        Shape = ShapeAnnotation.GetShape(a) switch
                        {
                            ShapeKind.Arrow => "arrow",
                            ShapeKind.Line => "line",
                            _ => "rectangle",
                        },
                        StartX = ShapeAnnotation.GetStartX(a),
                        StartY = ShapeAnnotation.GetStartY(a),
                        EndX = ShapeAnnotation.GetEndX(a),
                        EndY = ShapeAnnotation.GetEndY(a)
                    });
                    break;

                case AnnotationType.StickyNote:
                    items.Add(new JsFlattenItem
                    {
                        Kind = "note",
                        PageNumber = a.PageNumber,
                        Color = StickyNoteAnnotation.GetColor(a),
                        X = StickyNoteAnnotation.GetX(a),
                        Y = StickyNoteAnnotation.GetY(a),
                        Text = StickyNoteAnnotation.GetContent(a)
                    });
                    break;

                case AnnotationType.FreeText:
                    items.Add(new JsFlattenItem
                    {
                        Kind = "text",
                        PageNumber = a.PageNumber,
                        Color = FreeTextAnnotation.GetColor(a),
                        X = FreeTextAnnotation.GetX(a),
                        Y = FreeTextAnnotation.GetY(a),
                        FontSize = FreeTextAnnotation.GetFontSize(a),
                        Text = FreeTextAnnotation.GetText(a)
                    });
                    break;

                case AnnotationType.Signature:
                    var b64 = StripDataUrlPrefix(SignatureAnnotation.GetImageDataUrl(a));
                    if (string.IsNullOrEmpty(b64)) break;
                    items.Add(new JsFlattenItem
                    {
                        Kind = "signature",
                        PageNumber = a.PageNumber,
                        ImageBase64 = b64,
                        X = SignatureAnnotation.GetX(a),
                        Y = SignatureAnnotation.GetY(a),
                        Width = SignatureAnnotation.GetWidth(a),
                        Height = SignatureAnnotation.GetHeight(a)
                    });
                    break;
            }

            // Id und Änderungszeitpunkt begleiten jedes Item: der /Annots-Weg
            // bildet daraus /NM und /M. Beide MÜSSEN aus den Daten kommen und
            // nicht aus Uhr oder Zufall, sonst ist die Ausgabe nicht mehr
            // reproduzierbar (Zusage seit MCP 2.0.0). Das Einbrennen ignoriert sie.
            if (items.Count > before)
            {
                var added = items[^1];
                added.Id = a.Id.Value;
                added.Modified = a.UpdatedAt.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
            }
        }

        return items;
    }

    public async Task<AnnotationWriteResult> WriteAnnotationsAsync(
        Stream pdf,
        IReadOnlyList<Annotation> annotations,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(annotations);

        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (annotations.Count == 0) return new AnnotationWriteResult(bytes, 0, 0);

        var items = ProjectAnnotations(annotations);
        // Was die Projektion gar nicht erst erzeugt hat (z.B. eine Signatur ohne
        // Bild), zählt bereits hier als übersprungen — sonst meldet die Summe
        // weniger, als der Aufrufer übergeben hat.
        var droppedInProjection = annotations.Count - items.Count;
        if (items.Count == 0) return new AnnotationWriteResult(bytes, 0, droppedInProjection);

        try
        {
            var result = await _js.InvokeAsync<JsWriteAnnotationsResult>(
                "pageboundPdfManipulator.writeAnnotations", cancellationToken, bytes, items.ToArray())
                .ConfigureAwait(false);
            if (result?.Bytes is null) return new AnnotationWriteResult(bytes, 0, annotations.Count);
            return new AnnotationWriteResult(result.Bytes, result.Written, result.Skipped + droppedInProjection);
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:annots-write] pdf-lib writeAnnotations fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<AnnotationReadResult> ReadAnnotationsAsync(
        Stream pdf,
        PdfId pdfId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);

        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        JsReadAnnotationsResult? result;
        try
        {
            result = await _js.InvokeAsync<JsReadAnnotationsResult>(
                "pageboundPdfManipulator.readAnnotations", cancellationToken, bytes).ConfigureAwait(false);
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException(
                $"[stage:annots-read] pdf-lib readAnnotations fehlgeschlagen: {jsex.Message}", jsex);
        }

        if (result?.Items is null)
        {
            return new AnnotationReadResult(Array.Empty<NewAnnotation>(), result?.Unsupported ?? 0);
        }

        var annotations = new List<NewAnnotation>(result.Items.Length);
        var unmapped = 0;
        foreach (var it in result.Items)
        {
            var mapped = ToDomain(it, pdfId);
            if (mapped is not null) annotations.Add(mapped); else unmapped++;
        }

        return new AnnotationReadResult(annotations, result.Unsupported + unmapped);
    }

    /// <summary>Rückweg der Projektion: Brücken-DTO → Domänen-Annotation.</summary>
    private static NewAnnotation? ToDomain(JsFlattenItem it, PdfId pdfId) => it.Kind switch
    {
        "highlight" => HighlightAnnotation.Create(
            pdfId,
            it.PageNumber,
            (it.Rects ?? Array.Empty<JsRect>())
                .Select(r => new HighlightRect(r.X, r.Y, r.W, r.H)).ToList(),
            it.Text ?? string.Empty,
            it.Color),

        "ink" => InkAnnotation.Create(
            pdfId,
            it.PageNumber,
            (it.Strokes ?? Array.Empty<JsPoint[]>())
                .Select(s => new InkStroke(s.Select(p => new InkPoint(p.X, p.Y)).ToList())).ToList(),
            it.Color,
            it.StrokeWidth),

        "shape" => ShapeAnnotation.Create(
            pdfId,
            it.PageNumber,
            it.Shape switch { "arrow" => ShapeKind.Arrow, "line" => ShapeKind.Line, _ => ShapeKind.Rectangle },
            it.StartX ?? 0, it.StartY ?? 0, it.EndX ?? 0, it.EndY ?? 0,
            it.Color,
            it.StrokeWidth),

        // Der Weg /Annots führt Klartext (/Contents kennt kein Markdown) — beim
        // Einlesen landet er unverändert im Markdown-Feld, siehe Vertrag.
        "note" => StickyNoteAnnotation.Create(
            pdfId, it.PageNumber, it.X ?? 0, it.Y ?? 0, it.Text ?? string.Empty, it.Color),

        "text" => FreeTextAnnotation.Create(
            pdfId, it.PageNumber, it.X ?? 0, it.Y ?? 0, it.Text ?? string.Empty, it.FontSize, it.Color),

        _ => null,
    };

    /// <summary>Schneidet das "data:...;base64,"-Präfix einer Data-URL ab (liefert reines base64).</summary>
    private static string StripDataUrlPrefix(string dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl)) return string.Empty;
        var marker = dataUrl.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
        return marker >= 0 ? dataUrl[(marker + "base64,".Length)..] : dataUrl;
    }

    public async Task<byte[]> RedactAsync(Stream pdf, IReadOnlyList<RedactionRegion> regions, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(regions);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (regions.Count == 0) return bytes;

        // camelCase-Payload exakt wie RedactionRegion in der Bridge.
        var payload = regions
            .Select(r => new { pageNumber = r.PageNumber, x = r.X, y = r.Y, w = r.Width, h = r.Height })
            .ToArray();
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.redactPdf", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:redact] pdf-lib redactPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> ApplyTextEditsAsync(Stream pdf, IReadOnlyList<TextEditRegion> edits, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(edits);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (edits.Count == 0) return bytes;

        // camelCase-Payload exakt wie TextEditDto in der Bridge.
        var payload = edits
            .Select(e => new { pageNumber = e.PageNumber, x = e.X, y = e.Y, w = e.Width, h = e.Height, text = e.Text ?? string.Empty, fontSize = e.FontSize, color = e.Color, bgColor = e.BgColor })
            .ToArray();
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.applyTextEdits", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:edit] pdf-lib applyTextEdits fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> CreateFormFieldsAsync(Stream pdf, IReadOnlyList<FormFieldRegion> fields, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(fields);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (fields.Count == 0) return bytes;

        var payload = fields
            .Select(f => new { pageNumber = f.PageNumber, x = f.X, y = f.Y, width = f.Width, height = f.Height, name = f.Name, fieldType = f.FieldType })
            .ToArray();
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.createFormFields", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:createFields] pdf-lib createFormFields fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> CreateBlankAsync(double widthPt, double heightPt, int pageCount, CancellationToken cancellationToken)
    {
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.createBlankPdf", cancellationToken, widthPt, heightPt, pageCount).ConfigureAwait(false);
            return result ?? Array.Empty<byte>();
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:createBlank] pdf-lib createBlankPdf fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> AppendBlankPageAsync(Stream pdf, double widthPt, double heightPt, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.appendBlankPage", cancellationToken, bytes, widthPt, heightPt).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:appendBlank] pdf-lib appendBlankPage fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> OrganizePagesAsync(Stream pdf, IReadOnlyList<PageOp> ops, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(ops);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        if (ops.Count == 0) return bytes;
        var payload = ops.Select(o => new { sourceIndex = o.SourceIndex, rotation = o.Rotation }).ToArray();
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.organizePages", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:organize] pdf-lib organizePages fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<byte[]> SetMetadataAsync(Stream pdf, PdfMetadata metadata, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(metadata);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        var payload = new { title = metadata.Title, author = metadata.Author, subject = metadata.Subject, keywords = metadata.Keywords };
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                "pageboundPdfManipulator.setMetadata", cancellationToken, bytes, payload).ConfigureAwait(false);
            return result ?? bytes;
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:setMetadata] pdf-lib setMetadata fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    public async Task<PdfMetadata> GetMetadataAsync(Stream pdf, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        var bytes = await ReadAllAsync(pdf, cancellationToken).ConfigureAwait(false);
        try
        {
            var m = await _js.InvokeAsync<PdfMetadata?>(
                "pageboundPdfManipulator.getMetadata", cancellationToken, bytes).ConfigureAwait(false);
            return m ?? new PdfMetadata(null, null, null, null);
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:getMetadata] pdf-lib getMetadata fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    private static async Task<byte[]> ReadAllAsync(Stream pdf, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        await using var ms = new MemoryStream();
        await pdf.CopyToAsync(ms, cancellationToken).ConfigureAwait(false);
        return ms.ToArray();
    }

    private async Task<byte[]> InvokeBytesAsync(string fn, CancellationToken cancellationToken, object[] args)
    {
        try
        {
            var result = await _js.InvokeAsync<byte[]>(
                $"pageboundPdfManipulator.{fn}", cancellationToken, args).ConfigureAwait(false);
            return result ?? Array.Empty<byte>();
        }
        catch (JSException jsex)
        {
            throw new InvalidOperationException($"[stage:{fn}] pdf-lib {fn} fehlgeschlagen: {jsex.Message}", jsex);
        }
    }

    /// <summary>
    /// DTO für die Übergabe an die JS-Bridge. Property-Namen werden via
    /// System.Text.Json zu camelCase serialisiert.
    /// </summary>
    private sealed class JsEmbeddedSignature
    {
        public int PageNumber { get; init; }
        public byte[] ImageBytes { get; init; } = Array.Empty<byte>();
        public double X { get; init; }
        public double Y { get; init; }
        public double Width { get; init; }
        public double Height { get; init; }
        public string SignedAtIso { get; init; } = string.Empty;
        public string SignerName { get; init; } = string.Empty;
        public string? SignerEmail { get; init; }
        public string? SignerReason { get; init; }
        public string? SignerLocation { get; init; }
        public string? IntegrityHash { get; init; }
    }

    /// <summary>
    /// Flaches Union-DTO für <c>flattenAnnotations</c> in der Bridge. Je nach
    /// <see cref="Kind"/> sind nur bestimmte Felder gesetzt; nicht zutreffende
    /// bleiben null (die Bridge ignoriert sie). camelCase via System.Text.Json.
    /// </summary>
    private sealed class JsFlattenItem
    {
        public string Kind { get; init; } = string.Empty;
        public int PageNumber { get; init; }
        public string? Color { get; init; }
        public double? Opacity { get; init; }
        public double? StrokeWidth { get; init; }
        public JsRect[]? Rects { get; init; }
        public JsPoint[][]? Strokes { get; init; }
        public string? Shape { get; init; }
        public double? StartX { get; init; }
        public double? StartY { get; init; }
        public double? EndX { get; init; }
        public double? EndY { get; init; }
        public string? Text { get; init; }
        public double? FontSize { get; init; }
        public double? X { get; init; }
        public double? Y { get; init; }
        public string? ImageBase64 { get; init; }
        public double? Width { get; init; }
        public double? Height { get; init; }

        // Nur für den /Annots-Weg (→ /NM und /M). Setzbar, weil sie nach dem
        // Zweig der Projektion nachgetragen werden; das Einbrennen liest sie nicht.
        public string? Id { get; set; }
        public string? Modified { get; set; }
    }

    private sealed class JsWriteAnnotationsResult
    {
        public byte[]? Bytes { get; init; }
        public int Written { get; init; }
        public int Skipped { get; init; }
    }

    private sealed class JsReadAnnotationsResult
    {
        public JsFlattenItem[]? Items { get; init; }
        public int Unsupported { get; init; }
    }

    private sealed class JsRect
    {
        public double X { get; init; }
        public double Y { get; init; }
        public double W { get; init; }
        public double H { get; init; }
    }

    private sealed class JsPoint
    {
        public double X { get; init; }
        public double Y { get; init; }
    }
}
