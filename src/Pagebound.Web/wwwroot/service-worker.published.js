// Caution! Be sure you understand the caveats before publishing an application with
// offline support. See https://aka.ms/blazor-offline-considerations

self.importScripts('./service-worker-assets.js');
self.addEventListener('install', event => event.waitUntil(onInstall(event)));
self.addEventListener('activate', event => event.waitUntil(onActivate(event)));
self.addEventListener('fetch', event => event.respondWith(onFetch(event)));

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;
// i18n-Bundles (resources/{lang}.json): werden bei der Installation MIT gecacht,
// aber zur Laufzeit IMMER zuerst vom Netz geholt (siehe onFetch) — der Cache ist
// nur der Offline-Rückfall. Vorher waren sie ganz ausgeklammert, aber nie per
// cache.put nachgetragen: offline zeigte die App rohe Schlüssel (Bean PDF-Tool-off1).
// Sonstiges JSON bleibt draußen.
// woff2: /\.woff$/ allein erfasst .woff2 nicht — offline fehlten alle Schriften.
const offlineAssetsInclude = [ /\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.css$/, /\.woff2?$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/, /\.webmanifest$/, /^resources\/[a-z]{2}\.json$/ ];
const offlineAssetsExclude = [ /^service-worker\.js$/ ];

// --- Teilen-Ziel (share_target, Android) -------------------------------------
// Eine Freigabe („Teilen → Pagebound") kommt als POST /share-target mit
// multipart/form-data an. Hier wird sie abgefangen und für boot.js geparkt;
// geprüft wird sie dort, von pageboundBoot.offer() — dem einzigen Prüfpunkt
// (docs/contracts/datei-eintritt.md).
//
// Der Name trägt BEWUSST nicht cacheNamePrefix: onActivate räumt nur
// offline-cache-* weg, deshalb übersteht eine geteilte Datei einen
// Fassungswechsel. Wer die Aufräumregel verallgemeinert, bricht das.
const shareCacheName = 'pb-share';
const shareEntryUrl = '/__pb-share';
const shareFilenameHeader = 'X-Pagebound-Filename';

// Replace with your base path if you are hosting on a subfolder. Ensure there is a trailing '/'.
const base = "/";
const baseUrl = new URL(base, self.origin);
const manifestUrlList = self.assetsManifest.assets.map(asset => new URL(asset.url, baseUrl).href);

// "/pdf-unterschreiben" oder "/pdf-unterschreiben/" → URL von ".../index.html",
// falls es diese Datei im Asset-Manifest gibt (die Wurzel "/" ausgenommen).
function staticIndexFor(url) {
    let path = url.pathname;
    if (path === '/' || path === '') return null;
    if (!path.endsWith('/')) path += '/';
    const candidate = new URL(path.slice(1) + 'index.html', baseUrl).href;
    return manifestUrlList.includes(candidate) ? candidate : null;
}

async function onInstall(event) {
    console.info('Service worker: Install');

    // Fetch and cache all matching items from the assets manifest
    const assetsRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(asset.url, { integrity: asset.hash, cache: 'no-cache' }));
    // Einzeln cachen statt cache.addAll(): addAll ist all-or-nothing — schlägt EIN
    // Asset fehl (Integrity-Mismatch/Netz-Hiccup während eines Deploys), rejectet der
    // ganze Aufruf und der NEUE Cache bleibt LEER → onActivate löscht den alten →
    // alle Navigationen fallen auf fetch() zurück und werfen bei Pech "Failed to
    // fetch", der Nutzer hängt auf altem/kaputtem Stand fest. Mit allSettled cachen
    // die übrigen Assets (v.a. index.html + Framework) trotzdem → der neue Build
    // kommt sauber an. Nicht gecachte Einzel-Assets holt onFetch online nach.
    const cache = await caches.open(cacheName);
    const results = await Promise.allSettled(assetsRequests.map(req => addSanitized(cache, req)));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
        console.warn(`Service worker: ${failed} Asset(s) nicht gecacht (werden online nachgeladen)`);
    }

    // skipWaiting: neue SW-Version übernimmt sofort, ohne darauf zu warten,
    // dass alle Tabs geschlossen werden. Ohne das bleibt der alte SW aktiv
    // und liefert das Vorgänger-Bundle aus — ein Klick auf "Sprache" hätte
    // im UI dann keine Wirkung, weil das gecachte JSON / Razor-Code zurück
    // an den Client geht. Akzeptabler Trade-off im Pre-Alpha: leichtes Risiko
    // schemainkompatibler Live-Updates gegen drastisch bessere UX bei Releases.
    self.skipWaiting();
}

// Pendant zu cache.add(), aber ohne umgeleitete Antworten in den Cache zu lassen.
//
// Eine Response mit response.redirected darf eine NAVIGATION nicht beantworten:
// respondWith() liefert dafür einen Netzwerkfehler (Spec: hat die URL-Liste der
// Antwort mehr als einen Eintrag, ist das Ergebnis ein network error). onFetch
// beantwortet JEDE Navigation aus genau diesem Cache (index.html bzw. die
// index.html einer statischen Unterseite) — leitet der Server /index.html also
// um, ist die App für WIEDERKEHRENDE Besucher tot, und zwar dauerhaft, weil der
// kaputte Eintrag im Cache liegt. Beobachtet in der CI: `serve` schickt
// /index.html per 301 auf /index, danach scheiterten 12 von 14 E2E-Tests mit
// net::ERR_FAILED. Produktions-nginx leitet nicht um — eine Konfigurationszeile
// davon entfernt aber schon.
//
// Deshalb den Body in eine frische Response kopieren, bevor er in den Cache
// geht. Die Integritätsprüfung bleibt erhalten: sie steckt in der Request
// (asset.hash), und fetch() wertet sie genauso aus wie cache.add().
async function addSanitized(cache, request) {
    const response = await fetch(request);
    // cache.add() rejectet bei nicht-2xx; dieses Verhalten beibehalten, damit
    // onInstall weiter zählen kann, was nicht gecacht wurde.
    if (!response.ok) throw new TypeError(`Asset ${request.url}: HTTP ${response.status}`);
    await cache.put(request, response.redirected ? await withoutRedirect(response) : response);
}

async function withoutRedirect(response) {
    return new Response(await response.blob(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

async function onActivate(event) {
    console.info('Service worker: Activate');

    // Delete unused caches
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
        .filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));

    // Sofort die Kontrolle über alle offenen Clients übernehmen — Pendant zu
    // skipWaiting(), damit der erste Reload nach einem Update wirklich den
    // neuen Code sieht.
    await self.clients.claim();
}

// Nimmt die geteilte Datei an und parkt sie. Antwortet mit einer Umleitung auf
// /reader, damit die App normal startet und boot.js den Parkplatz leert.
//
// Diese Umleitung berührt die Härtung aus c4b7bfb nicht: sie beantwortet ein
// POST, wird nicht gecacht, und index.html bleibt unberührt. Gecacht wird nur
// die Datei selbst.
async function onShareTarget(request) {
    try {
        const form = await request.formData();
        // Der Manifest-Parameter heißt "file"; getAll, weil manche Plattformen
        // mehrere schicken — die erste echte Datei genügt.
        const file = form.getAll('file').find(v => typeof v !== 'string' && v);
        if (file) {
            const cache = await caches.open(shareCacheName);
            await cache.put(shareEntryUrl, new Response(file, {
                headers: {
                    'Content-Type': file.type || 'application/pdf',
                    // Prozentkodiert: ein Dateiname darf Zeichen enthalten, die
                    // in einem HTTP-Header nicht erlaubt sind (Umlaute, Komma).
                    [shareFilenameHeader]: encodeURIComponent(file.name || 'geteilt.pdf'),
                },
            }));
        }
    } catch (err) {
        // Nicht lesbar oder Cache voll: die App startet dann einfach ohne Datei,
        // statt die Freigabe mit einem Netzwerkfehler zu beantworten.
        console.warn('Service worker: Freigabe nicht übernommen', err);
    }
    // Absolute URL: Response.redirect verlangt sie, relativ wirft es.
    return Response.redirect(new URL('/reader', self.origin).href, 303);
}

async function onFetch(event) {
    const url = new URL(event.request.url);

    if (event.request.method === 'POST' && url.pathname === '/share-target') {
        return onShareTarget(event.request);
    }

    if (event.request.method !== 'GET') {
        return fetch(event.request);
    }

    const cache = await caches.open(cacheName);

    // i18n-Bundles immer frisch vom Netz holen (s.o.), damit der nächste Boot nach
    // einem Sprachwechsel garantiert das richtige Bundle bekommt — aber mit
    // Cache-Fallback, falls offline, statt hart zu scheitern.
    // Die App lädt resources/{lang}.json?v=<Zeitstempel> (Cache-Bust) und fällt
    // offline auf die URL OHNE Query zurück (LocalizationService). Deshalb jede
    // frische Antwort unter der Query-freien URL ablegen — so steht offline immer
    // der zuletzt online gesehene Stand bereit.
    if (url.pathname.startsWith('/resources/') && url.pathname.endsWith('.json')) {
        const cacheKey = new URL(url.pathname, url.origin).href;
        try {
            const response = await fetch(event.request);
            if (response.ok) {
                try { await cache.put(cacheKey, response.clone()); } catch { /* Cache voll o. ä. — Antwort trotzdem liefern */ }
            }
            return response;
        } catch {
            return (await cache.match(cacheKey)) ?? Response.error();
        }
    }

    // Statische Unterseiten mit eigenem index.html (Aufgaben-Landingpages wie
    // /pdf-unterschreiben/): Navigationen dorthin bekommen IHRE Seite, nicht die
    // SPA-Shell — sonst zeigt der Router nach dem ersten Besuch „nicht gefunden".
    const staticPageUrl = event.request.mode === 'navigate' ? staticIndexFor(url) : null;
    if (staticPageUrl) {
        const page = await cache.match(staticPageUrl);
        if (page) return page;
        try {
            return await fetch(event.request);
        } catch (err) {
            const fallback = await cache.match('index.html');
            if (fallback) return fallback;
            throw err;
        }
    }

    // For all navigation requests, try to serve index.html from cache,
    // unless that request is for an offline resource.
    const shouldServeIndexHtml = event.request.mode === 'navigate'
        && !manifestUrlList.some(u => u === event.request.url);

    const cachedResponse = await cache.match(shouldServeIndexHtml ? 'index.html' : event.request);
    if (cachedResponse) {
        return cachedResponse;
    }

    // Nicht im Cache → Netz. Scheitert das (Update-Race während eines Deploys /
    // offline), für Navigationen auf gecachtes index.html zurückfallen, statt die
    // Navigation mit "Failed to fetch" crashen zu lassen — genau dieser unbehandelte
    // Reject hat Nutzer auf altem/kaputtem Stand hängen lassen.
    try {
        return await fetch(event.request);
    } catch (err) {
        if (shouldServeIndexHtml) {
            const fallback = await cache.match('index.html');
            if (fallback) {
                return fallback;
            }
        }
        throw err;
    }
}
