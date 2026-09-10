// Shared narrator for Reader and Feeds. Tries the site's ElevenLabs route
// (/api/tts) first and drops to the browser's own voice for the rest of the
// session the moment that route says no — no key, budget spent, rate limited,
// offline. One utterance at a time; callers chain sentences through onend.
(function () {
  var remoteOk = true;
  var current = null; // { kind: "audio", el } | { kind: "synth", u }
  var next = null;    // prefetched Audio for the sentence after this one

  function url(text) { return "/api/tts?text=" + encodeURIComponent(text); }

  function synthSpeak(text, opts) {
    if (!("speechSynthesis" in window)) { if (opts.onerror) opts.onerror(new Error("no speech")); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-AU";
    u.rate = opts.rate || 1;
    u.onend = function () { current = null; if (opts.onend) opts.onend(); };
    u.onerror = function (e) { current = null; if (opts.onerror) opts.onerror(e); };
    current = { kind: "synth", u: u };
    window.speechSynthesis.speak(u);
  }

  function audioSpeak(text, opts) {
    var el = next && next.text === text ? next.el : new Audio(url(text));
    next = null;
    el.playbackRate = opts.rate || 1;
    el.onended = function () { current = null; if (opts.onend) opts.onend(); };
    el.onerror = function () {
      // A JSON error body (503/429/413) is not playable media and lands here.
      remoteOk = false;
      current = null;
      synthSpeak(text, opts);
    };
    current = { kind: "audio", el: el };
    var p = el.play();
    if (p && p.catch) p.catch(function (err) { if (err && err.name === "AbortError") return; if (el.onerror) el.onerror(); });
  }

  window.SiteVoice = {
    speak: function (text, opts) {
      opts = opts || {};
      this.cancel();
      if (remoteOk && window.fetch) audioSpeak(text, opts); else synthSpeak(text, opts);
    },
    prefetch: function (text) {
      if (!remoteOk || !text) return;
      var el = new Audio(url(text));
      el.preload = "auto";
      next = { text: text, el: el };
    },
    pause: function () {
      if (!current) return;
      if (current.kind === "audio") current.el.pause(); else window.speechSynthesis.pause();
    },
    resume: function () {
      if (!current) return;
      if (current.kind === "audio") current.el.play().catch(function () {}); else window.speechSynthesis.resume();
    },
    cancel: function () {
      if (current && current.kind === "audio") {
        current.el.onended = null;
        current.el.onerror = null;
        current.el.pause();
        current.el.removeAttribute("src");
        current.el.load();
      }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      current = null;
    },
    // Live rate change only works on the audio path; returns false so the
    // caller can restart a browser-voice utterance instead.
    setRate: function (rate) {
      if (current && current.kind === "audio") { current.el.playbackRate = rate; return true; }
      return false;
    },
    supported: function () { return remoteOk || "speechSynthesis" in window; },
    usingRemote: function () { return remoteOk; }
  };
})();
