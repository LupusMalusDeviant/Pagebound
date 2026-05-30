using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Pagebound.Infrastructure.Pdf.Encryption;

/// <summary>
/// Wendet AES-256 (ISO 32000-2 <c>/V 5</c>, <c>/R 6</c>) auf eine bereits von
/// PdfSharpCore normalisierte (klassische, unkomprimierte) PDF an: verschlüsselt
/// alle Stream-Daten mit dem File-Key, hängt das <c>/Encrypt</c>-Dictionary an
/// und schreibt xref + Trailer neu.
///
/// <para><b>MVP-Grenze:</b> Es werden nur Streams verschlüsselt
/// (<c>/StmF /StdCF /CFM /AESV3</c>); Strings bleiben Klartext
/// (<c>/StrF /Identity</c>). Damit ist der sichtbare Seiteninhalt
/// (Content-Streams, Bilder, eingebettete Fonts) passwortgeschützt, während
/// String-Metadaten (Info-Dictionary, Annotationstexte, Lesezeichen)
/// unverschlüsselt bleiben. Volle String-Verschlüsselung ist eine spätere
/// Iteration.</para>
///
/// <para>Arbeitet bewusst auf Byte-Ebene (statt über das PdfSharpCore-Objekt-
/// modell), weil PdfSharpCore weder das <c>/Encrypt</c>-Dictionary injizieren
/// lässt noch V5/R6 unterstützt. Die <see cref="AesR6"/>-Primitive liefern die
/// Krypto (kein MD5 → WASM-tauglich).</para>
/// </summary>
public static class PdfAesEncryptor
{
    private static readonly Encoding Latin1 = Encoding.Latin1;

    // /Length-Eintrag (direkt ODER indirekt) — wird beim Re-Emit komplett
    // entfernt und durch eine frische direkte Länge ersetzt.
    private static readonly Regex AnyLength = new(@"/Length\s+\d+(\s+\d+\s+R)?", RegexOptions.Compiled);

    /// <summary>
    /// Verschlüsselt <paramref name="pdf"/> (muss klassisch/normalisiert sein).
    /// <paramref name="permissions"/> = -1 erlaubt alle Operationen.
    /// </summary>
    public static byte[] Encrypt(
        byte[] pdf,
        byte[] ownerPassword,
        byte[] userPassword,
        int permissions = -1,
        bool encryptMetadata = true)
    {
        var doc = PdfStructure.Parse(pdf);

        byte[] fileKey = RandomNumberGenerator.GetBytes(AesR6.FileKeyLength);
        var (u, ue) = AesR6.ComputeUserKey(
            userPassword, fileKey, RandomNumberGenerator.GetBytes(8), RandomNumberGenerator.GetBytes(8));
        var (o, oe) = AesR6.ComputeOwnerKey(
            ownerPassword, fileKey, u, RandomNumberGenerator.GetBytes(8), RandomNumberGenerator.GetBytes(8));
        byte[] perms = AesR6.ComputePerms(fileKey, permissions, encryptMetadata);

        int encNum = doc.MaxObjectNumber + 1;
        int size = encNum + 1;

        using var ms = new MemoryStream();
        void W(string s) { var b = Latin1.GetBytes(s); ms.Write(b, 0, b.Length); }
        void WB(byte[] b) => ms.Write(b, 0, b.Length);

        // Header (PDF-Version auf 1.7 anheben — R6/AES-256 ist >= 1.7-Territorium).
        WB(BumpVersion(doc.Header));

        var offsets = new Dictionary<int, long>();
        foreach (var obj in doc.Objects.OrderBy(x => x.Number))
        {
            offsets[obj.Number] = ms.Position;

            if (obj.StreamData is null)
            {
                WB(obj.RawBytes);
                if (obj.RawBytes.Length == 0 || obj.RawBytes[^1] != (byte)'\n') W("\n");
            }
            else
            {
                byte[] enc = AesR6.EncryptData(fileKey, obj.StreamData);
                W($"{obj.Number} {obj.Generation} obj\n");
                W(WithFreshLength(obj.DictText, enc.Length));
                W("\nstream\n");
                WB(enc);
                W("\nendstream\nendobj\n");
            }
        }

        offsets[encNum] = ms.Position;
        W($"{encNum} 0 obj\n");
        W(BuildEncryptDict(o, u, oe, ue, perms, permissions, encryptMetadata));
        W("\nendobj\n");

        long xrefOffset = ms.Position;
        W($"xref\n0 {size}\n");
        W("0000000000 65535 f \n");
        for (int n = 1; n < size; n++)
        {
            bool used = offsets.TryGetValue(n, out var off);
            W($"{(used ? off : 0):D10} 00000 {(used ? "n" : "f")} \n");
        }

        string id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        W("trailer\n<< ");
        W($"/Size {size} /Root {doc.RootRef}");
        if (doc.InfoRef is not null) W($" /Info {doc.InfoRef}");
        W($" /Encrypt {encNum} 0 R /ID [<{id}><{id}>] >>\n");
        W($"startxref\n{xrefOffset}\n%%EOF\n");

        return ms.ToArray();
    }

    private static string WithFreshLength(string dictText, int length)
    {
        string stripped = AnyLength.Replace(dictText, string.Empty);
        int open = stripped.IndexOf("<<", StringComparison.Ordinal);
        int insertAt = open >= 0 ? open + 2 : 0;
        return stripped[..insertAt] + $" /Length {length}" + stripped[insertAt..].TrimEnd();
    }

    private static byte[] BumpVersion(byte[] header)
    {
        // "%PDF-1.x" → "%PDF-1.7" (nur die eine Stelle, falls vorhanden).
        var copy = (byte[])header.Clone();
        for (int i = 0; i + 7 < copy.Length; i++)
        {
            if (copy[i] == '%' && copy[i + 1] == 'P' && copy[i + 2] == 'D' && copy[i + 3] == 'F' &&
                copy[i + 4] == '-' && copy[i + 5] == '1' && copy[i + 6] == '.')
            {
                if (copy[i + 7] < (byte)'7') copy[i + 7] = (byte)'7';
                break;
            }
        }
        return copy;
    }

    private static string BuildEncryptDict(
        byte[] o, byte[] u, byte[] oe, byte[] ue, byte[] perms, int permissions, bool encryptMetadata)
    {
        static string Hex(byte[] b) => Convert.ToHexString(b);
        var sb = new StringBuilder();
        sb.Append("<< /Filter /Standard /V 5 /R 6 /Length 256 ");
        sb.Append($"/P {permissions} /EncryptMetadata {(encryptMetadata ? "true" : "false")} ");
        sb.Append("/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> ");
        sb.Append("/StmF /StdCF /StrF /Identity ");
        sb.Append($"/U <{Hex(u)}> /UE <{Hex(ue)}> /O <{Hex(o)}> /OE <{Hex(oe)}> /Perms <{Hex(perms)}> >>");
        return sb.ToString();
    }

    // --- Test-/Verifikations-Helfer ------------------------------------------

    /// <summary>Gibt die rohen Stream-Daten aller Stream-Objekte in Objekt-Reihenfolge zurück.</summary>
    public static IReadOnlyList<byte[]> ExtractStreams(byte[] pdf)
    {
        var doc = PdfStructure.Parse(pdf);
        return doc.Objects
            .Where(o => o.StreamData is not null)
            .OrderBy(o => o.Number)
            .Select(o => o.StreamData!)
            .ToList();
    }

    /// <summary>
    /// Rekonstruiert den File-Key aus dem <c>/Encrypt</c>-Dictionary (<c>/U</c>,
    /// <c>/UE</c>) und dem User-Passwort. Für Tests + (später) Entschlüsselung.
    /// </summary>
    public static bool TryRecoverFileKey(byte[] encryptedPdf, byte[] userPassword, out byte[] fileKey)
    {
        fileKey = Array.Empty<byte>();
        string text = Latin1.GetString(encryptedPdf);

        var uMatch = Regex.Match(text, @"/U\s*<([0-9A-Fa-f]+)>");
        var ueMatch = Regex.Match(text, @"/UE\s*<([0-9A-Fa-f]+)>");
        if (!uMatch.Success || !ueMatch.Success) return false;

        byte[] u = Convert.FromHexString(uMatch.Groups[1].Value);
        byte[] ue = Convert.FromHexString(ueMatch.Groups[1].Value);
        return AesR6.TryRecoverFileKeyFromUser(userPassword, u, ue, out fileKey);
    }

    /// <summary>Entschlüsselt einen Stream (16-Byte-IV ‖ AES-256-CBC/PKCS7) mit dem File-Key.</summary>
    public static byte[] DecryptStream(byte[] ivAndCipher, byte[] fileKey)
    {
        byte[] iv = ivAndCipher.AsSpan(0, 16).ToArray();
        using var aes = Aes.Create();
        using var dec = aes.CreateDecryptor(fileKey, iv);
        return dec.TransformFinalBlock(ivAndCipher, 16, ivAndCipher.Length - 16);
    }

    // --- Minimaler PDF-Strukturparser (für PdfSharpCore-normalisierte PDFs) ---

    private sealed class PdfObj
    {
        public int Number;
        public int Generation;
        public string DictText = string.Empty;          // nur bei Stream-Objekten
        public byte[]? StreamData;                       // null => kein Stream
        public byte[] RawBytes = Array.Empty<byte>();    // nur bei Nicht-Stream-Objekten
    }

    private sealed class PdfStructure
    {
        public byte[] Header = Array.Empty<byte>();
        public List<PdfObj> Objects = new();
        public int MaxObjectNumber;
        public string RootRef = string.Empty;
        public string? InfoRef;

        public static PdfStructure Parse(byte[] pdf)
        {
            string text = Latin1.GetString(pdf);

            int sx = text.LastIndexOf("startxref", StringComparison.Ordinal);
            if (sx < 0) throw new InvalidOperationException("Kein 'startxref' gefunden — PDF nicht klassisch.");
            int p = sx + "startxref".Length;
            long xrefOffset = ReadLong(text, ref p);

            var offsets = new Dictionary<int, long>();
            int xp = (int)xrefOffset;
            Expect(text, ref xp, "xref");
            while (true)
            {
                SkipWs(text, ref xp);
                if (xp >= text.Length || !char.IsDigit(text[xp])) break; // "trailer"
                int start = (int)ReadLong(text, ref xp);
                int count = (int)ReadLong(text, ref xp);
                SkipToNextLine(text, ref xp);
                for (int i = 0; i < count; i++)
                {
                    string entry = text.Substring(xp, 20);
                    long off = long.Parse(entry[..10], CultureInfo.InvariantCulture);
                    char type = entry[17];
                    if (type == 'n') offsets[start + i] = off;
                    xp += 20;
                }
            }
            if (offsets.Count == 0) throw new InvalidOperationException("xref enthält keine In-Use-Objekte.");

            int tp = text.IndexOf("trailer", (int)xrefOffset, StringComparison.Ordinal);
            string trailer = tp >= 0 ? text.Substring(tp, Math.Min(text.Length - tp, 4000)) : string.Empty;

            var result = new PdfStructure
            {
                RootRef = MatchRef(trailer, "/Root") ?? throw new InvalidOperationException("Kein /Root im Trailer."),
                InfoRef = MatchRef(trailer, "/Info"),
                MaxObjectNumber = offsets.Keys.Max(),
            };

            int firstOffset = (int)offsets.Values.Min();
            result.Header = pdf[..firstOffset];

            var sorted = offsets.OrderBy(kv => kv.Value).ToList();
            for (int idx = 0; idx < sorted.Count; idx++)
            {
                int start = (int)sorted[idx].Value;
                int end = idx + 1 < sorted.Count ? (int)sorted[idx + 1].Value : (int)xrefOffset;
                result.Objects.Add(ParseObject(pdf, text, start, end));
            }
            return result;
        }

        private static PdfObj ParseObject(byte[] pdf, string text, int start, int end)
        {
            int p = start;
            int number = (int)ReadLong(text, ref p);
            int gen = (int)ReadLong(text, ref p);
            Expect(text, ref p, "obj");
            int bodyStart = p;

            int streamKw = IndexOfStreamKeyword(text, bodyStart, end);
            if (streamKw < 0)
            {
                int eo = text.IndexOf("endobj", bodyStart, end - bodyStart, StringComparison.Ordinal);
                int sliceEnd = eo >= 0 ? eo + "endobj".Length : end;
                return new PdfObj { Number = number, Generation = gen, RawBytes = pdf[start..sliceEnd], StreamData = null };
            }

            string dictText = text[bodyStart..streamKw];
            int dataStart = streamKw + "stream".Length;
            if (dataStart < end && text[dataStart] == '\r') dataStart++;
            if (dataStart < end && text[dataStart] == '\n') dataStart++;

            int dataEnd;
            int length = ParseLengthDirect(dictText);
            if (length >= 0 && dataStart + length <= end)
            {
                dataEnd = dataStart + length;
            }
            else
            {
                int es = text.IndexOf("endstream", dataStart, end - dataStart, StringComparison.Ordinal);
                dataEnd = es < 0 ? end : es;
                if (dataEnd > dataStart && text[dataEnd - 1] == '\n') dataEnd--;
                if (dataEnd > dataStart && text[dataEnd - 1] == '\r') dataEnd--;
            }

            return new PdfObj
            {
                Number = number,
                Generation = gen,
                DictText = dictText,
                StreamData = pdf[dataStart..dataEnd],
            };
        }

        private static int IndexOfStreamKeyword(string text, int from, int end)
        {
            int i = from;
            while (i < end)
            {
                int idx = text.IndexOf("stream", i, end - i, StringComparison.Ordinal);
                if (idx < 0) return -1;
                bool partOfEndstream = idx > 0 && text[idx - 1] == 'd';
                int after = idx + 6;
                bool eolAfter = after < text.Length && (text[after] == '\r' || text[after] == '\n');
                if (!partOfEndstream && eolAfter) return idx;
                i = idx + 6;
            }
            return -1;
        }

        private static int ParseLengthDirect(string dict)
        {
            var m = Regex.Match(dict, @"/Length\s+(\d+)(?!\s+\d+\s+R)");
            return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : -1;
        }

        private static string? MatchRef(string s, string key)
        {
            var m = Regex.Match(s, Regex.Escape(key) + @"\s+(\d+)\s+(\d+)\s+R");
            return m.Success ? $"{m.Groups[1].Value} {m.Groups[2].Value} R" : null;
        }

        private static long ReadLong(string s, ref int p)
        {
            SkipWs(s, ref p);
            int start = p;
            if (p < s.Length && (s[p] == '-' || s[p] == '+')) p++;
            while (p < s.Length && char.IsDigit(s[p])) p++;
            return long.Parse(s[start..p], CultureInfo.InvariantCulture);
        }

        private static void SkipWs(string s, ref int p)
        {
            while (p < s.Length && (s[p] == ' ' || s[p] == '\r' || s[p] == '\n' || s[p] == '\t' || s[p] == '\f' || s[p] == '\0'))
                p++;
        }

        private static void SkipToNextLine(string s, ref int p)
        {
            while (p < s.Length && s[p] != '\n') p++;
            if (p < s.Length) p++;
        }

        private static void Expect(string s, ref int p, string token)
        {
            SkipWs(s, ref p);
            if (p + token.Length > s.Length || s.Substring(p, token.Length) != token)
                throw new InvalidOperationException($"Erwartetes Token '{token}' bei Offset {p} nicht gefunden.");
            p += token.Length;
        }
    }
}
