namespace Pagebound.Core.Abstractions;

/// <summary>
/// Opt-in Telemetrie. Default-Implementierung ist eine No-Op-Klasse;
/// nur wenn der Nutzer in den Settings zustimmt, wird eine echte Sender-Implementierung registriert.
/// Erfüllt NFA-020, NFA-021.
/// </summary>
public interface ITelemetryService
{
    bool IsEnabled { get; }

    Task TrackExceptionAsync(
        Exception exception,
        IReadOnlyDictionary<string, string>? context,
        CancellationToken cancellationToken);

    Task TrackEventAsync(
        string eventName,
        IReadOnlyDictionary<string, string>? properties,
        CancellationToken cancellationToken);
}
