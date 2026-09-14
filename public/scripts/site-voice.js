// Shared narrator for Reader and Feeds. Tries the site's ElevenLabs route
// (/api/tts) first and drops to the browser's own voice for the rest of the
// session the moment that route says no — no key, budget spent, rate limited,
// offline. One utterance at a time; callers chain sentences through onend.
//
// Two extras every caller gets for free:
//  - normalise(): text goes to the voice with numbers, abbreviations and
//    symbols spelled out the way a narrator would read them, so the TTS
//    doesn't say "one thousand nine hundred and eighty four" for a year or
//    "S T" for "St".
//  - segment(): turns raw text into a queue of { text, pauseAfter } with
//    audiobook-style gaps — 2 s at chapter/scene breaks, 0.8 s between
//    paragraphs, 0.25 s on a change of speaker — plus explicit "(150ms)"
//    markers for the author's own timing.
(function () {
  var remoteOk = true;
  var current = null; // { kind: "audio", el } | { kind: "synth", u } | { kind: "gap", t }
  var next = null;    // prefetched Audio for the sentence after this one

  var PAUSE = { chapter: 2000, scene: 2000, paragraph: 800, speaker: 250, sentence: 0 };

  function url(text) { return "/api/tts?text=" + encodeURIComponent(text); }

  // ---- text normalisation ---------------------------------------------------
  var ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  function words999(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + " hundred"); n %= 100; if (n) out.push("and"); }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")); }
    else if (n > 0) out.push(ONES[n]);
    return out.join(" ");
  }
  function numberWords(n) {
    if (n === 0) return "zero";
    if (n < 0) return "minus " + numberWords(-n);
    var scales = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
    var out = [];
    for (var i = 0; i < scales.length; i++) {
      var s = scales[i];
      if (n >= s[0]) { out.push(words999(Math.floor(n / s[0])) + " " + s[1]); n %= s[0]; }
    }
    if (n) { if (out.length && n < 100) out.push("and"); out.push(words999(n)); }
    return out.join(" ");
  }
  function yearWords(y) {
    if (y >= 2000 && y < 2010) return "two thousand" + (y % 100 ? " and " + words999(y % 100) : "");
    if (y >= 1000 && y < 10000) {
      var hi = Math.floor(y / 100), lo = y % 100;
      return words999(hi) + " " + (lo === 0 ? "hundred" : lo < 10 ? "oh " + ONES[lo] : words999(lo));
    }
    return numberWords(y);
  }
  function ordinalWords(n) {
    var w = numberWords(n);
    var irregular = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
    var last = w.split(/[\s-]/).pop();
    if (irregular[last]) return w.slice(0, w.length - last.length) + irregular[last];
    if (/y$/.test(last)) return w.slice(0, -1) + "ieth";
    return w + "th";
  }
  var ABBREV = { "Mr.": "Mister", "Mrs.": "Missus", "Ms.": "Miz", "Dr.": "Doctor", "St.": "Saint", "Mt.": "Mount", "Ave.": "Avenue", "Rd.": "Road", "Prof.": "Professor", "Capt.": "Captain", "Lt.": "Lieutenant", "Sgt.": "Sergeant", "Col.": "Colonel", "Gen.": "General", "Jr.": "Junior", "Sr.": "Senior", "vs.": "versus", "etc.": "et cetera", "e.g.": "for example", "i.e.": "that is", "No.": "Number", "Ch.": "Chapter", "ch.": "chapter", "Vol.": "Volume", "Hon.": "Honourable", "Rev.": "Reverend" };
  var UNITS = { km: "kilometres", m: "metres", cm: "centimetres", mm: "millimetres", kg: "kilograms", g: "grams", L: "litres", ml: "millilitres", mL: "millilitres", "%": "per cent", "°C": "degrees Celsius", "°F": "degrees Fahrenheit", "°": "degrees" };

  function normalise(text) {
    var t = String(text || "");
    t = t.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
    t = t.replace(/\s*(?:—|--)\s*/g, ", ").replace(/…/g, "...");
    // Abbreviations before sentence splitting stops the trailing dot ending a sentence.
    t = t.replace(/\b(Mr|Mrs|Ms|Dr|St|Mt|Ave|Rd|Prof|Capt|Lt|Sgt|Col|Gen|Jr|Sr|vs|etc|No|Ch|ch|Vol|Hon|Rev)\.(?=\s|$)/g, function (m) { return ABBREV[m] || m; });
    t = t.replace(/\b(e\.g\.|i\.e\.)/g, function (m) { return ABBREV[m] || m; });
    t = t.replace(/\b([A-Z])\.(?=\s?[A-Z]\.)/g, "$1 ").replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, "$1 ");
    // Money and units.
    t = t.replace(/\$(\d[\d,]*)(?:\.(\d{2}))?/g, function (_, d, c) {
      var n = Number(d.replace(/,/g, ""));
      var out = numberWords(n) + (n === 1 ? " dollar" : " dollars");
      if (c && Number(c)) out += " and " + numberWords(Number(c)) + (Number(c) === 1 ? " cent" : " cents");
      return out;
    });
    t = t.replace(/£(\d[\d,]*)/g, function (_, d) { var n = Number(d.replace(/,/g, "")); return numberWords(n) + (n === 1 ? " pound" : " pounds"); });
    t = t.replace(/(\d+(?:\.\d+)?)\s?(km|cm|mm|kg|mL|ml|L|m|g|%|°C|°F|°)(?![A-Za-z])/g, function (_, n, u) { return n + " " + (UNITS[u] || u); });
    // Times like 7:30 → "seven thirty"; 12:05 → "twelve oh five".
    t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, function (_, h, m) { return numberWords(Number(h)) + " " + (m === "00" ? "o'clock" : m[0] === "0" ? "oh " + ONES[Number(m[1])] : words999(Number(m))); });
    // Ordinals, years and plain numbers. Decimals read digit by digit after the point.
    t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, function (_, n) { return ordinalWords(Number(n)); });
    t = t.replace(/\b(1[5-9]\d\d|20\d\d)\b/g, function (m) { return yearWords(Number(m)); });
    t = t.replace(/\b\d{1,3}(?:,\d{3})+\b/g, function (m) { return numberWords(Number(m.replace(/,/g, ""))); });
    t = t.replace(/\b(\d+)\.(\d+)\b/g, function (_, a, b) { return numberWords(Number(a)) + " point " + b.split("").map(function (d) { return d === "0" ? "zero" : ONES[Number(d)]; }).join(" "); });
    t = t.replace(/\b\d+\b/g, function (m) { return m.length > 12 ? m : numberWords(Number(m)); });
    // Roman numeral chapter headings: "CHAPTER XIV" → "Chapter fourteen".
    t = t.replace(/\b(chapter|part|book|act|scene)\s+([IVXLC]+)\b/gi, function (_, w, r) { var n = romanToInt(r); return n ? w + " " + numberWords(n) : w + " " + r; });
    t = t.replace(/&/g, " and ").replace(/\s{2,}/g, " ").trim();
    return t;
  }
  function romanToInt(s) {
    var map = { I: 1, V: 5, X: 10, L: 50, C: 100 }, total = 0, prev = 0;
    s = s.toUpperCase();
    for (var i = s.length - 1; i >= 0; i--) { var v = map[s[i]]; if (!v) return 0; total += v < prev ? -v : v; prev = v; }
    return total;
  }

  // ---- segmentation ----------------------------------------------------------
  function isBreakLine(line) {
    return /^\s*(\*\s*){3,}$/.test(line) || /^\s*(#\s*){3,}$/.test(line) || /^\s*[-–—_]{3,}\s*$/.test(line) || /^\s*[•·~*]\s*$/.test(line) || /^\s*\*\s*\*\s*\*\s*$/.test(line);
  }
  function isChapterLine(line) {
    var t = line.trim();
    if (!t || t.length > 80) return false;
    return /^(chapter|part|book|act|prologue|epilogue|interlude|section)\b/i.test(t) || /^[IVXLC]+\.?$/.test(t) || /^\d{1,3}\.?$/.test(t) || (t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(" ").length <= 8 && !/[.!?]$/.test(t));
  }
  function splitSentences(text) {
    var parts = text.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g) || [];
    return parts.map(function (p) { return p.trim(); }).filter(Boolean);
  }
  function speakerOf(sentence) {
    // A sentence that opens with a quotation mark is dialogue; consecutive
    // quoted sentences after a narrated one imply a change of speaker.
    return /^["“]/.test(sentence) ? "quote" : "prose";
  }

  // text → [{ text, pauseAfter }], honouring "(150ms)" / "(-100ms)" markers and
  // the site-wide pause pattern. Paragraphs are separated by blank lines or,
  // when `singleLineParagraphs` is set, by any newline.
  function segment(text, opts) {
    opts = opts || {};
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var paras = [], buf = [];
    function flush(kind) { if (buf.length) { paras.push({ kind: "para", text: buf.join(" ") }); buf = []; } if (kind) paras.push({ kind: kind }); }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { flush(); continue; }
      if (isBreakLine(line)) { flush("scene"); continue; }
      if (isChapterLine(line) && !buf.length) { flush(); paras.push({ kind: "chapter", text: line.trim() }); continue; }
      if (opts.singleLineParagraphs) { flush(); buf.push(line.trim()); flush(); } else buf.push(line.trim());
    }
    flush();

    var out = [], lastSpeaker = null;
    for (var p = 0; p < paras.length; p++) {
      var para = paras[p];
      if (para.kind === "scene") { if (out.length) out[out.length - 1].pauseAfter = Math.max(out[out.length - 1].pauseAfter, PAUSE.scene); continue; }
      if (para.kind === "chapter") {
        if (out.length) out[out.length - 1].pauseAfter = Math.max(out[out.length - 1].pauseAfter, PAUSE.chapter);
        out.push({ text: para.text, pauseAfter: PAUSE.chapter, kind: "chapter" });
        lastSpeaker = null;
        continue;
      }
      var sentences = splitSentences(para.text);
      for (var s = 0; s < sentences.length; s++) {
        var sentence = sentences[s], extra = 0;
        sentence = sentence.replace(/\(\s*(-?\d+)\s*ms\s*\)/g, function (_, ms) { extra += Number(ms); return " "; }).replace(/\s{2,}/g, " ").trim();
        if (!sentence) { if (out.length) out[out.length - 1].pauseAfter += extra; continue; }
        var speaker = speakerOf(sentence);
        // The speaker gap goes in front of the line that changes voice, so it
        // lands on the previous sentence's tail.
        if (lastSpeaker && speaker !== lastSpeaker && out.length) out[out.length - 1].pauseAfter = Math.max(out[out.length - 1].pauseAfter, PAUSE.speaker);
        var isLast = s === sentences.length - 1;
        lastSpeaker = speaker;
        out.push({ text: sentence, pauseAfter: Math.max(0, (isLast ? PAUSE.paragraph : PAUSE.sentence) + extra) });
      }
    }
    return out;
  }

  // ---- playback -------------------------------------------------------------
  function synthSpeak(text, opts) {
    if (!("speechSynthesis" in window)) { if (opts.onerror) opts.onerror(new Error("no speech")); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || "en-AU";
    u.rate = opts.rate || 1;
    u.onend = function () { current = null; gapThen(opts); };
    u.onerror = function (e) { current = null; if (opts.onerror) opts.onerror(e); };
    current = { kind: "synth", u: u };
    window.speechSynthesis.speak(u);
  }

  function audioSpeak(text, opts) {
    var el = next && next.text === text ? next.el : new Audio(url(text));
    next = null;
    el.playbackRate = opts.rate || 1;
    el.onended = function () { current = null; gapThen(opts); };
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

  // Silence between utterances is a timer, scaled by the playback rate so a
  // 1.5× listener doesn't sit through full-length gaps.
  function gapThen(opts) {
    var ms = Math.round((opts.pauseAfter || 0) / (opts.rate || 1));
    if (ms <= 0) { if (opts.onend) opts.onend(); return; }
    var t = setTimeout(function () { current = null; if (opts.onend) opts.onend(); }, ms);
    current = { kind: "gap", t: t, remaining: ms, started: Date.now(), opts: opts };
  }

  window.SiteVoice = {
    PAUSE: PAUSE,
    normalise: normalise,
    segment: segment,
    splitSentences: splitSentences,
    speak: function (text, opts) {
      opts = opts || {};
      this.cancel();
      var spoken = opts.raw ? text : normalise(text);
      if (remoteOk && window.fetch) audioSpeak(spoken, opts); else synthSpeak(spoken, opts);
    },
    prefetch: function (text, raw) {
      if (!remoteOk || !text) return;
      var spoken = raw ? text : normalise(text);
      var el = new Audio(url(spoken));
      el.preload = "auto";
      next = { text: spoken, el: el };
    },
    pause: function () {
      if (!current) return;
      if (current.kind === "audio") current.el.pause();
      else if (current.kind === "synth") window.speechSynthesis.pause();
      else if (current.kind === "gap") { clearTimeout(current.t); current.remaining -= Date.now() - current.started; current.paused = true; }
    },
    resume: function () {
      if (!current) return;
      if (current.kind === "audio") current.el.play().catch(function () {});
      else if (current.kind === "synth") window.speechSynthesis.resume();
      else if (current.kind === "gap" && current.paused) { var o = current.opts; var left = Math.max(0, current.remaining); current = null; gapThen({ pauseAfter: left, rate: 1, onend: o.onend }); }
    },
    cancel: function () {
      if (current && current.kind === "audio") {
        current.el.onended = null;
        current.el.onerror = null;
        current.el.pause();
        current.el.removeAttribute("src");
        current.el.load();
      }
      if (current && current.kind === "gap") clearTimeout(current.t);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      current = null;
    },
    // Live rate change only works on the audio path; returns false so the
    // caller can restart a browser-voice utterance instead.
    setRate: function (rate) {
      if (current && current.kind === "audio") { current.el.playbackRate = rate; return true; }
      return current && current.kind === "gap";
    },
    supported: function () { return remoteOk || "speechSynthesis" in window; },
    usingRemote: function () { return remoteOk; }
  };
})();
