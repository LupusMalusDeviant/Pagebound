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
        shareFailed: "Die geteilte Datei konnte nicht übernommen werden.",
        onlyFirst: "Mehrere geteilte Dateien — geöffnet wird die erste.",
      }
    : {
        loading: "Loading …",
        loadingPct: "Loading … {p}",
        drop: "Drop a PDF here or choose one",
        dropSub: "It opens as soon as Pagebound is ready.",
        queued: "“{n}” will open as soon as Pagebound is ready.",
        notPdf: "That is not a PDF file.",
        tooBig: "The file is larger than 100 MB.",
        shareFailed: "The shared file could not be taken over.",
        onlyFirst: "Several shared files — the first one opens.",
      };

  var pending = null; // File — PDF
  var pendingDesign = null; // string — Inhalt einer .pbdesign.json

  // Freigabe-Parkplatz des Service Workers (POST /share-target). Je Freigabe
  // ein eigener Schlüssel unter dem Präfix, damit zwei Freigaben kurz
  // hintereinander sich nicht überschreiben und keine gelöscht wird, die noch
  // niemand gelesen hat.
  var SHARE_CACHE = "pb-share";
  var SHARE_PREFIX = "/__pb-share/";
  var SHARE_NAME_HEADER = "X-Pagebound-Filename";
  // Ein Entwurf ist eine Textdatei mit Layout, keine Mediendatei. Die
  // 100-MB-Grenze der PDFs taugt dafür nicht: der Inhalt wird als String
  // gelesen und als zweite Kopie nach .NET gereicht — bei WASM ist das der
  // schnellste Weg in einen Speicherfehler.
  var MAX_DESIGN_BYTES = 5 * 1024 * 1024;

  // Die Abholungen (Freigabe-Cache, launchQueue) sind asynchron, die Seiten
  // fragen aber irgendwann einfach. Deshalb hängt jede Abholung sich hier an,
  // und die Schnittstelle wartet darauf, BEVOR sie „keine Datei" antwortet —
  // sonst bricht ReaderPage ab (es prüft zuerst den Namen) und die Datei ist
  // still verloren. Siehe docs/contracts/datei-eintritt.md, Nachtrag 1.
  var ready = Promise.resolve();
  function also(p) {
    // Auch nach einem Fehlschlag weiterwarten: ein kaputter Eintrag darf die
    // Schnittstelle nicht dauerhaft blockieren.
    var next = Promise.resolve(p).then(null, function () {});
    ready = ready.then(function () { return next; }, function () { return next; });
  }

  // Schnittstelle für Blazor (ReaderPage, DesignerPage). Uint8Array kommt in
  // .NET als byte[] an (binär, ohne base64-Umweg). JS.InvokeAsync löst ein
  // zurückgegebenes Promise auf — an den Razor-Seiten ändert das nichts.
  window.pageboundBoot = {
    pendingFileName: function () {
      return ready.then(function () { return pending ? pending.name : null; });
    },
    takePendingFile: function () {
      return ready.then(function () {
        if (!pending) return null;
        var f = pending;
        pending = null;
        return f.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      });
    },
    /** Inhalt einer gestarteten .pbdesign.json, einmalig. */
    takePendingDesign: function () {
      return ready.then(function () {
        var t = pendingDesign;
        pendingDesign = null;
        return t;
      });
    },
    /** Der einzige Prüfpunkt: MIME, Größe, Magic Bytes. Jede Quelle geht hier durch. */
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

  // --- Die beiden neuen Eintrittswege -------------------------------------
  // Beide landen über accept() bzw. im Design-Parkplatz, nicht auf einem
  // eigenen Pfad daneben (docs/contracts/datei-eintritt.md).

  // Ein Entwurf wird NUR geparkt, wenn das Ziel auch der Designer ist.
  //
  // Sonst passiert Folgendes: eine Freigabe landet immer auf /reader; ein JSON
  // darin käme in den Design-Parkplatz, der Reader fragt nur nach einer PDF und
  // bekommt nichts — die Datei öffnet sich nicht. Sie bliebe aber im Speicher
  // liegen und würde beim nächsten Wechsel in den Designer dessen Dokument
  // ersetzen, ohne dass der Nutzer in diesem Moment eine Datei gewählt hat.
  // Dasselbe gilt für ein JSON, das über den PDF-Handler hereinkommt.
  function designWanted() {
    return location.pathname.indexOf("/editor") === 0;
  }

  // Eine gestartete Datei wird nach ihrem INHALT sortiert, nicht nach der
  // Endung: eine falsch benannte Datei soll nicht im falschen Werkzeug landen.
  // Der Inhalt ist an dieser Stelle geprüft (%PDF- in den ersten 1024 Bytes).
  // Ein davon abweichender MIME-Typ wäre eine BEHAUPTUNG des Betriebssystems
  // oder des Teilen-Menüs — Android gibt für eine PDF regelmäßig
  // application/octet-stream, und accept() würde sie deshalb verwerfen. Also
  // den geprüften Typ setzen statt den behaupteten. Die MIME-Prüfung in
  // accept() bleibt für die Drop-Zone unverändert, wo der Typ vom Browser
  // kommt und etwas wert ist.
  function asVerifiedPdf(file, name) {
    var n = name || file.name || "geteilt.pdf";
    if (file.type === "application/pdf" && file.name === n) return file;
    try {
      return new File([file], n, { type: "application/pdf" });
    } catch (e) {
      return file; // File-Konstruktor nicht verfügbar: dann eben der Originaltyp
    }
  }

  function sortLaunched(file, name) {
    if (!file) return Promise.resolve(false);
    return looksLikePdf(file).then(function (isPdf) {
      if (isPdf) {
        if (pending) { setStatus(T.onlyFirst, false); return false; } // erste gewinnt
        return accept(asVerifiedPdf(file, name));
      }
      if (!designWanted()) { setStatus(T.notPdf, true); return false; }
      if (file.size > MAX_DESIGN_BYTES) { setStatus(T.tooBig, true); return false; }
      return file.text().then(function (text) {
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          setStatus(T.notPdf, true); // dieselbe Meldung wie eine abgelehnte Drop-Datei
          return false;
        }
        // Nicht jedes gültige JSON ist ein Entwurf: `1`, `[]` und `null` sind
        // es auch. Grob prüfen, bevor der Inhalt nach .NET gereicht wird.
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setStatus(T.notPdf, true);
          return false;
        }
        pendingDesign = text;
        return true;
      }, function () { setStatus(T.notPdf, true); return false; });
    });
  }

  // launchQueue nimmt GENAU EINEN Empfänger: setConsumer ersetzt den
  // vorherigen. Deshalb steht er hier und nur hier — boot.js läuft ohne Bundle
  // und vor Blazor, eine gestartete Datei darf nicht davon abhängen, wie weit
  // der WASM-Start gekommen ist. Ein zweiter Empfänger in einem Bundle würde
  // diesen still überschreiben, je nach Ladereihenfolge.
  if (window.launchQueue && typeof window.launchQueue.setConsumer === "function") {
    // Gestapelte Startparameter werden nicht beim setConsumer zugestellt,
    // sondern in einer eigenen Aufgabe danach. Deshalb hält ready erst einmal
    // einen Makrotask an: sonst antwortet pendingFileName() „keine Datei",
    // während die Datei gerade zugestellt wird — bei warmem Cache startet
    // Blazor schnell genug dafür.
    //
    // Was das NICHT abdeckt: eine Datei, die SPÄTER in derselben Sitzung
    // gestartet wird (zweites „Öffnen mit" ohne neuen Tab). Dafür müsste
    // boot.js die Seite benachrichtigen; das ändert ReaderPage und steht
    // deshalb nicht hier, sondern als offener Punkt im Vertrag.
    also(new Promise(function (resolve) { setTimeout(resolve, 0); }));
    window.launchQueue.setConsumer(function (params) {
      if (!params || !params.files || params.files.length === 0) return;
      // Nur die erste Datei: file_handlers läuft als single-client, mehrere
      // ausgewählte Dateien kämen in EINEM Start an. Die übrigen werden
      // gemeldet, nicht stillschweigend verworfen.
      if (params.files.length > 1) setStatus(T.onlyFirst, false);
      also(params.files[0].getFile().then(function (f) { return sortLaunched(f); }));
    });
  }

  // Freigabe über das Teilen-Menü: der Service Worker hat die Datei geparkt
  // (POST /share-target) und auf /reader umgeleitet.
  //
  // Konnte er sie NICHT übernehmen (Speicher voll, Formular unlesbar), hängt er
  // ?share=failed an — ohne das käme der Reader leer hoch und die Freigabe sähe
  // auf Android einfach kaputt aus, ohne ein Wort.
  function shareFailed() {
    return (location.search || "").indexOf("share=failed") >= 0;
  }

  function takeShared(cache, pfad) {
    return cache.match(pfad).then(function (res) {
      if (!res) return;
      // Erst den Eintrag löschen, dann verarbeiten: eine Datei, die accept()
      // ablehnt, darf nicht bei jedem Start erneut auftauchen. Der Body bleibt
      // nach dem Löschen lesbar — die Response hält ihn selbst.
      return cache.delete(pfad).then(function () {
        var name = "geteilt.pdf";
        var raw = res.headers.get(SHARE_NAME_HEADER);
        if (raw) { try { name = decodeURIComponent(raw); } catch (e) { /* kaputt kodiert */ } }
        // Über denselben Sortierer wie der Dateihandler: der Inhalt
        // entscheidet, nicht der Content-Type, den der Service Worker aus der
        // Freigabe übernommen hat.
        return res.blob().then(function (blob) { return sortLaunched(blob, name); });
      });
    });
  }

  function pickUpShared() {
    if (shareFailed()) setStatus(T.shareFailed, true);
    if (typeof caches === "undefined" || !caches || typeof caches.has !== "function") return Promise.resolve();
    return caches.has(SHARE_CACHE).then(function (there) {
      if (!there) return;
      return caches.open(SHARE_CACHE).then(function (cache) {
        return cache.keys().then(function (reqs) {
          // ALLE Einträge, in Schlüsselreihenfolge. Mit einem festen Schlüssel
          // ginge bei zwei Freigaben kurz hintereinander eine verloren: die
          // zweite überschreibt die erste, oder dieser Durchlauf löscht eine,
          // die er nie gelesen hat.
          var pfade = [];
          for (var i = 0; i < reqs.length; i++) {
            var p = reqs[i].url;
            try { p = new URL(reqs[i].url).pathname; } catch (e) { /* schon ein Pfad */ }
            if (p.indexOf(SHARE_PREFIX) === 0) pfade.push(p);
          }
          pfade.sort(function (a, b) {
            return (parseInt(a.slice(SHARE_PREFIX.length), 10) || 0) - (parseInt(b.slice(SHARE_PREFIX.length), 10) || 0);
          });
          var chain = Promise.resolve();
          for (var k = 0; k < pfade.length; k++) {
            chain = chain.then(function (p) { return function () { return takeShared(cache, p); }; }(pfade[k]));
          }
          return chain;
        });
      });
    });
  }
  also(pickUpShared());

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
