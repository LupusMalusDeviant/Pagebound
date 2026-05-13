using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Pagebound.Core.Abstractions;
using Pagebound.Infrastructure.Crypto;
using Pagebound.Infrastructure.Telemetry;
using Pagebound.Web;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// HTTP-Client (z.B. für i18n-Ressourcen aus wwwroot/resources/).
builder.Services.AddScoped(_ => new HttpClient
{
    BaseAddress = new Uri(builder.HostEnvironment.BaseAddress)
});

// =============================================================================
// Service-Registrierungen (Interface-First, siehe ADR-001).
//   Jeder Service hängt am Interface, nicht an der konkreten Klasse.
// =============================================================================

builder.Services.AddSingleton<IHashService, Sha256HashService>();
builder.Services.AddSingleton<ITelemetryService, NoOpTelemetryService>();

// TODO Release 0.1: IStorageService, ISidecarService, IAnnotationService, IPdfRenderer, IThemeService, ILocalizationService.
//   Jede Registrierung kommt mit ihrer Implementation; die Interfaces stehen bereits.

await builder.Build().RunAsync();
