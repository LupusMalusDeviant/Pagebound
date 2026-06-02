namespace Pagebound.Core.Domain;

/// <summary>Position der Seitenzahl auf der Seite (unten).</summary>
public enum PageNumberPosition
{
    BottomCenter,
    BottomRight,
    BottomLeft,
}

/// <summary>
/// Optionen fürs Stempeln einer PDF: ein diagonales Text-Wasserzeichen und/oder
/// Seitenzahlen (Bates-Nummerierung). Beide sind optional und können kombiniert
/// werden. Wird in einem Durchlauf über <c>IPdfManipulator.StampAsync</c> auf jede
/// Seite gezeichnet (pdf-lib, kein Re-Rendering).
/// </summary>
/// <param name="WatermarkText">Wasserzeichen-Text (leer/null = kein Wasserzeichen).</param>
/// <param name="WatermarkOpacity">Deckkraft 0,02–0,6 (Default 0,12).</param>
/// <param name="WatermarkFontSize">Schriftgröße in pt (Default 48).</param>
/// <param name="PageNumbers">Seitenzahlen zeichnen?</param>
/// <param name="PageNumberFormat">Format mit Platzhaltern <c>{n}</c> und <c>{total}</c> (Default "{n} / {total}").</param>
/// <param name="PageNumberPosition">Position unten (Default mittig).</param>
/// <param name="PageNumberFontSize">Schriftgröße der Seitenzahl in pt (Default 10).</param>
/// <param name="PageNumberStartAt">Startnummer (Default 1 — für Bates z. B. höher).</param>
public sealed record StampOptions(
    string? WatermarkText = null,
    double WatermarkOpacity = 0.12,
    int WatermarkFontSize = 48,
    bool PageNumbers = false,
    string PageNumberFormat = "{n} / {total}",
    PageNumberPosition PageNumberPosition = PageNumberPosition.BottomCenter,
    int PageNumberFontSize = 10,
    int PageNumberStartAt = 1);
