using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Pagebound.Core.Abstractions;
using Pagebound.Infrastructure.Annotations;
using Pagebound.Infrastructure.Crypto;
using Pagebound.Infrastructure.Export;
using Pagebound.Infrastructure.Library;
using Pagebound.Infrastructure.Localization;
using Pagebound.Infrastructure.Ocr;
using Pagebound.Infrastructure.Pdf;
using Pagebound.Infrastructure.Sidecars;
using Pagebound.Infrastructure.Storage;
using Pagebound.Infrastructure.Telemetry;
using Pagebound.Infrastructure.Theme;
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
builder.Services.AddScoped<IPdfRenderer, PdfJsRenderer>();
// PdfSharpManipulator als Composition-Target — JsPdfLibManipulator delegiert
// alle Nicht-Embed-Operationen daran weiter. EmbedSignatures geht über pdf-lib
// (JS-Interop), weil PdfSharpCores Save-Pfad in WASM auf MD5.Create() crasht.
builder.Services.AddScoped<PdfSharpManipulator>();
builder.Services.AddScoped<IPdfEncryptor, ManagedPdfEncryptor>();
builder.Services.AddScoped<IPdfManipulator, JsPdfLibManipulator>();
builder.Services.AddScoped<IStorageService, IndexedDbStorage>();
builder.Services.AddScoped<IAnnotationService, AnnotationService>();
builder.Services.AddScoped<IMarkdownExporter, MarkdownExporter>();
builder.Services.AddScoped<IIntegrityService, IntegrityService>();
builder.Services.AddScoped<IThemeService, ThemeService>();
builder.Services.AddScoped<ILocalizationService, LocalizationService>();
builder.Services.AddScoped<ISidecarService, JsonSidecarService>();
builder.Services.AddScoped<ILibraryService, LibraryService>();
builder.Services.AddScoped<IOcrService, TesseractOcrService>();
builder.Services.AddScoped<IFileHandleService, FileSystemAccessHandleService>();

var host = builder.Build();

// Theme + Sprache aus localStorage holen (Pre-Boot-Script in index.html hat
// die Attribute schon FOUC-frei gesetzt — wir synchronisieren den C#-State,
// damit Toggle-Buttons den richtigen Initialwert zeigen). Erfolgt vor RunAsync,
// damit der erste Render bereits mit korrekten Texten/Theme läuft.
await ((ThemeService)host.Services.GetRequiredService<IThemeService>())
    .InitializeAsync(CancellationToken.None);
await ((LocalizationService)host.Services.GetRequiredService<ILocalizationService>())
    .InitializeAsync(CancellationToken.None);

await host.RunAsync();
