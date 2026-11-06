// =============================================================================
// Pagebound — große JS-Bridges erst bei Bedarf laden (Bean PDF-Tool-brg1)
// ----------------------------------------------------------------------------
// pdf-manipulator (≈ 540 KB br), sign (≈ 230 KB) und pdfjs (≈ 120 KB) machen
// ~94 % aller Bridge-Bytes aus, werden aber auf der Startseite, in der Library
// oder im Designer gar nicht gebraucht. Statt sie vor dem Blazor-Start synchron
// zu laden, steht hier für jede ein Platzhalter mit demselben globalen Namen:
//
//   pageboundPdf.renderPage(...)   // aus C#: JS.InvokeAsync("pageboundPdf.renderPage", ...)
//
// Der erste Zugriff auf eine Funktion lädt das echte Skript und ruft dann die
// echte Funktion auf — die C#-Seite merkt nichts (sie ruft ohnehin asynchron).
// Das echte Bundle (esbuild-IIFE: `var pageboundPdf = (...)()`) überschreibt
// beim Laden den Platzhalter, danach laufen Aufrufe direkt.
//
// Sobald die App gestartet ist (Boot-Bildschirm weg), werden alle drei im
// Leerlauf vorab geladen: der erste Klick bleibt schnell, und sie liegen danach
// im Service-Worker-Cache für offline.
//
// NICHT für Bridges, die synchron aus anderem JS benutzt werden — z. B.
// pageboundMind (wysiwyg-editor ruft renderMindmapDataUrl synchron): dort käme
// ein Promise statt eines Werts an. Solche bleiben in index.html direkt geladen.
// =============================================================================
(function () {
  "use strict";

  var LAZY = {
    pageboundPdf: "js/pdfjs-bridge.js",
    pageboundPdfManipulator: "js/pdf-manipulator-bridge.js",
    pageboundSign: "js/sign-bridge.js",
  };
  var pending = {};
  var placeholders = {};

  function load(name) {
    if (pending[name]) return pending[name];
    pending[name] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = LAZY[name];
      s.async = true;
      s.onload = function () {
        var real = window[name];
        if (!real || real === placeholders[name]) {
          reject(new Error("Bridge " + name + " wurde geladen, hat sich aber nicht registriert"));
          return;
        }
        resolve(real);
      };
      s.onerror = function () {
        delete pending[name]; // erneuter Versuch beim nächsten Aufruf (z. B. nach Netzausfall)
        reject(new Error("Bridge " + name + " konnte nicht geladen werden (" + LAZY[name] + ")"));
      };
      document.head.appendChild(s);
    });
    return pending[name];
  }

  Object.keys(LAZY).forEach(function (name) {
    var cache = {};
    var placeholder = new Proxy({}, {
      get: function (_t, fn) {
        if (typeof fn !== "string" || fn === "then") return undefined; // kein Thenable vortäuschen
        if (!cache[fn]) {
          cache[fn] = function () {
            var args = arguments;
            return load(name).then(function (real) {
              if (typeof real[fn] !== "function") throw new Error(name + "." + fn + " ist keine Funktion");
              return real[fn].apply(real, args);
            });
          };
        }
        return cache[fn];
      },
    });
    placeholders[name] = placeholder;
    window[name] = placeholder;
  });

  // Für Diagnose/Tests: welche Bridges sind schon echt geladen?
  window.pageboundLazyBridges = {
    loaded: function () {
      return Object.keys(LAZY).filter(function (n) { return window[n] !== placeholders[n]; });
    },
    preload: function () { return Promise.all(Object.keys(LAZY).map(function (n) { return load(n).catch(function () {}); })); },
  };

  // Vorab laden, sobald die App läuft — im Leerlauf, damit es den Start nicht bremst.
  function preloadWhenIdle() {
    var go = function () { window.pageboundLazyBridges.preload(); };
    if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 5000 });
    else setTimeout(go, 1500);
  }
  function waitForApp() {
    if (!document.getElementById("pb-boot")) { preloadWhenIdle(); return; }
    var obs = new MutationObserver(function () {
      if (!document.getElementById("pb-boot")) { obs.disconnect(); preloadWhenIdle(); }
    });
    obs.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForApp);
  else waitForApp();
})();
