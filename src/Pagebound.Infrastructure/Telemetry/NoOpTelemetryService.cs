using Pagebound.Core.Abstractions;

namespace Pagebound.Infrastructure.Telemetry;

/// <summary>
/// Standard-Implementierung von <see cref="ITelemetryService"/>: tut nichts.
/// Wird durch eine echte Sender-Implementierung ersetzt, sobald der Nutzer
/// in den Einstellungen anonyme Crash-Reports aktiviert. Erfüllt NFA-020.
/// </summary>
public sealed class NoOpTelemetryService : ITelemetryService
{
    public bool IsEnabled => false;

    public Task TrackExceptionAsync(
        Exception exception,
        IReadOnlyDictionary<string, string>? context,
        CancellationToken cancellationToken) => Task.CompletedTask;

    public Task TrackEventAsync(
        string eventName,
        IReadOnlyDictionary<string, string>? properties,
        CancellationToken cancellationToken) => Task.CompletedTask;
}
