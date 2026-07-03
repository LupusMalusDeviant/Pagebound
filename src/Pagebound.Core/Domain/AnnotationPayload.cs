using System.Globalization;
using System.Text.Json;

namespace Pagebound.Core.Domain;

/// <summary>
/// Gemeinsame Konverter für Annotation-Payload-Werte (<c>IReadOnlyDictionary&lt;string, object?&gt;</c>).
/// Löst die zuvor 6-fach duplizierten (und teils divergierten) privaten
/// <c>GetDouble</c>/<c>GetString</c>-Helfer der Annotation-Klassen ab (F-15).
///
/// Übernimmt bewusst das GROSSZÜGIGSTE Verhalten aller Kopien:
///   - Zahl-Parse akzeptiert double/float/int/long/decimal, JSON-Number und
///     numerische Strings (<see cref="NumberStyles.Float"/>, invariant),
///   - String-Parse akzeptiert echte Strings, JSON-Strings und fällt sonst auf
///     <c>value.ToString()</c> zurück.
/// Payloads stammen aus zwei Quellen: In-Memory (echte CLR-Typen) und aus
/// IndexedDB/Sidecar-JSON (<see cref="JsonElement"/>) — beide müssen tragen.
/// </summary>
internal static class AnnotationPayload
{
    internal static double GetDouble(
        IReadOnlyDictionary<string, object?> payload,
        string key,
        double fallback = 0)
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return fallback;
        return value switch
        {
            double d => d,
            float f => f,
            int i => i,
            long l => l,
            decimal m => (double)m,
            JsonElement el when el.ValueKind == JsonValueKind.Number => el.GetDouble(),
            string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => fallback
        };
    }

    internal static string GetString(
        IReadOnlyDictionary<string, object?> payload,
        string key,
        string fallback = "")
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return fallback;
        return value switch
        {
            string s => s,
            JsonElement el when el.ValueKind == JsonValueKind.String => el.GetString() ?? fallback,
            _ => value.ToString() ?? fallback
        };
    }
}
