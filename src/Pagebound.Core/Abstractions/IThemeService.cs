using Pagebound.Core.Domain;

namespace Pagebound.Core.Abstractions;

/// <summary>
/// Verwaltet das aktive Theme (Light/Dark/Sepia/Custom).
/// Erfüllt FA-100, FA-101.
/// </summary>
public interface IThemeService
{
    ThemeName CurrentTheme { get; }

    event Action<ThemeName>? ThemeChanged;

    Task SetThemeAsync(ThemeName theme, CancellationToken cancellationToken);
}
