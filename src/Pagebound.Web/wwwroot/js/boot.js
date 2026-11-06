// =============================================================================
// Pagebound — Boot-Bildschirm (läuft VOR Blazor, bewusst kleines Plain-JS)
// ----------------------------------------------------------------------------
// Bis die .NET-WASM-Laufzeit geladen ist, vergehen je nach Netz mehrere
// Sekunden (gemessen: ~12 s bei 4G, ~5 s bei DSL, kalter Cache). Statt nur
// eines Spinners zeigt der Splash:
//   1. echten Ladefortschritt (Blazor setzt --blazor-load-percentage auf <html>)
//   2. eine Drop-Zone: eine PDF kann sofort abgelegt/ausgewählt werden. Sie
//      wird (nach MIME-/Magic-Byte-Prüfung) im Speicher gehalten, die Route auf
//      /reader gestellt, und der Reader öffnet sie, sobald er bereit ist
//      (ReaderPage → pageboundBoot.takePendingFile).
// Alles lokal: keine Requests, die Datei verlässt den Browser nicht.
// Der Splash steht in #app und verschwindet mit dem ersten Blazor-Render.
// =============================================================================
(function () {
  "use strict";

  var MAX_BYTES = 100 * 1024 * 1024; // = ReaderPane.MaxFileSize
  var lang = (document.documentElement.getAttribute("lang") || navigator.language || "de").toLowerCase();
  var de = lang.indexOf("de") === 0;
  var T = de
    ? {
        loading: "Lädt …",
        loadingPct: "Lädt … {p}",
        drop: "PDF hier ablegen oder auswählen",
        dropSub: "Öffnet sich, sobald Pagebound bereit ist.",
        queued: "„{n}“ wird geöffnet, sobald Pagebound bereit ist.",
        notPdf: "Das ist keine PDF-Datei.",
        tooBig: "Die Datei ist größer als 100 MB.",
      }
    : {
        loading: "Loading …",
        loadingPct: "Loading … {p}",
        drop: "Drop a PDF here or choose one",
        dropSub: "It opens as soon as Pagebound is ready.",
        queued: "“{n}” will open as soon as Pagebound is ready.",
        notPdf: "That is not a PDF file.",
        tooBig: "The file is larger than 100 MB.",
      };

  var pending = null; // File

  // Schnittstelle für Blazor (ReaderPage). Uint8Array kommt in .NET als byte[]
  // an (binär, ohne base64-Umweg).
  window.pageboundBoot = {
    pendingFileName: function () {
      return pending ? pending.name : null;
    },
    takePendingFile: function () {
      if (!pending) return Promise.resolve(null);
      var f = pending;
      pending = null;
      return f.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    },
    /** Für Tests/Diagnose: eine Datei so übernehmen, als wäre sie abgelegt worden. */
    offer: function (file) { return accept(file); },
  };

  function el(id) { return document.getElementById(id); }

  function setStatus(text, isError) {
    var s = el("pb-boot-drop-sub");
    if (!s) return;
    s.textContent = text;
    s.classList.toggle("is-error", !!isError);
  }

  // PDF-Header muss in den ersten 1024 Bytes stehen (ISO 32000-1, 7.5.2).
  function looksLikePdf(file) {
    return file.slice(0, 1024).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      for (var i = 0; i + 4 < b.length; i++) {
        if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true; // %PDF-
      }
      return false;
    });
  }

  function accept(file) {
    if (!file) return Promise.resolve(false);
    var mimeOk = !file.type || file.type === "application/pdf" || file.type === "application/x-pdf";
    if (!mimeOk) { setStatus(T.notPdf, true); return Promise.resolve(false); }
    if (file.size > MAX_BYTES) { setStatus(T.tooBig, true); return Promise.resolve(false); }
    return looksLikePdf(file).then(function (ok) {
      if (!ok) { setStatus(T.notPdf, true); return false; }
      pending = file;
      setStatus(T.queued.replace("{n}", file.name), false);
      var zone = el("pb-boot-drop");
      if (zone) zone.classList.add("is-queued");
      // Blazor liest die Route erst beim Start — vor dem Boot umstellen genügt.
      if (location.pathname !== "/reader") {
        try { history.replaceState(null, "", "/reader"); } catch (e) { /* ignorieren */ }
      }
      return true;
    }, function () { setStatus(T.notPdf, true); return false; });
  }

  function booting() { return !!el("pb-boot"); }

  // Werkzeug-Links auf dem Boot-Bildschirm: bei englischer App-Sprache die EN-Fassung.
  function localizeTools() {
    if (de) return;
    var nodes = document.querySelectorAll("#pb-boot [data-en-text], #pb-boot [data-en-href], #pb-boot [data-en-aria-label]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.getAttribute("data-en-text")) n.textContent = n.getAttribute("data-en-text");
      if (n.getAttribute("data-en-href")) n.setAttribute("href", n.getAttribute("data-en-href"));
      if (n.getAttribute("data-en-aria-label")) n.setAttribute("aria-label", n.getAttribute("data-en-aria-label"));
    }
  }

  function wire() {
    localizeTools();
    var zone = el("pb-boot-drop");
    var input = el("pb-boot-file");
    if (!zone || !input) return;
    el("pb-boot-drop-title").textContent = T.drop;
    setStatus(T.dropSub, false);
    var st = el("pb-boot-status");
    if (st) st.textContent = T.loading;
    zone.hidden = false;

    input.addEventListener("change", function () {
      if (input.files && input.files[0]) accept(input.files[0]);
    });
    // Ablegen auf der ganzen Seite, solange der Boot-Bildschirm steht.
    window.addEventListener("dragover", function (e) {
      if (!booting()) return;
      e.preventDefault();
      zone.classList.add("is-over");
    });
    window.addEventListener("dragleave", function (e) {
      if (!booting()) return;
      if (e.target === document.documentElement || e.target === document.body) zone.classList.remove("is-over");
    });
    window.addEventListener("drop", function (e) {
      if (!booting()) return;
      e.preventDefault();
      zone.classList.remove("is-over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) accept(f);
    });

    // Ladefortschritt: Blazor schreibt --blazor-load-percentage(-text) auf <html>.
    var bar = el("pb-boot-progress");
    var root = document.documentElement;
    var obs = new MutationObserver(function () {
      if (!booting()) { obs.disconnect(); return; }
      var pct = parseFloat(getComputedStyle(root).getPropertyValue("--blazor-load-percentage")) || 0;
      if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
      if (st) st.textContent = pct >= 1 ? T.loadingPct.replace("{p}", Math.floor(pct) + " %") : T.loading;
    });
    obs.observe(root, { attributes: true, attributeFilter: ["style"] });
  }

  // Das Splash-Markup steht in index.html VOR diesem Skript, ist also schon
  // geparst. Nicht auf DOMContentLoaded warten: das käme erst, wenn alle
  // folgenden Bridge-Skripte (~1,5 MB) geladen sind.
  if (el("pb-boot-drop")) wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
