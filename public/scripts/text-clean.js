// Cleans text that came out of a scanner or OCR pass before the Reader lays
// it out: rejoins hard-wrapped lines and end-of-line hyphenation, drops page
// numbers and running heads, fixes ligatures. Pure; exposed on window.TextClean
// so the node test can load it the same way the page does.
(function () {
  var LIGATURES = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "ft", "ﬆ": "st" };

  function isPageNumber(line) {
    var t = line.trim();
    return /^[\[\(]?\d{1,4}[\]\)]?$/.test(t) || /^[\[\(]?[ivxlc]{1,7}[\]\)]?$/i.test(t) || /^(page|p\.)\s*\d{1,4}$/i.test(t) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(t);
  }

  // Running heads (book/chapter title repeated at the top of every page) show
  // up as the same short line many times; three repeats of a line that never
  // ends a sentence is enough to be sure.
  // Short heads carry the page number ("PRIDE AND PREJUDICE 43"); fold digits
  // only there so ordinary body lines with numbers are never grouped.
  function headKey(t) {
    var k = t.replace(/\s+/g, " ").toLowerCase();
    return k.length <= 40 ? k.replace(/\d+/g, "#") : k;
  }
  function runningHeads(lines) {
    var counts = {};
    lines.forEach(function (line) {
      var t = line.trim().replace(/\s+/g, " ");
      if (!t || t.length > 60 || /[.!?,;:]$/.test(t)) return;
      counts[headKey(t)] = (counts[headKey(t)] || 0) + 1;
    });
    var heads = {};
    Object.keys(counts).forEach(function (key) { if (counts[key] >= 3) heads[key] = true; });
    return heads;
  }

  function looksWrapped(lines) {
    // Hard-wrapped text has most lines of similar length ending mid-sentence.
    var content = lines.filter(function (l) { return l.trim().length > 0; });
    if (content.length < 8) return false;
    var midSentence = content.filter(function (l) { return !/[.!?:"”'’)\]]$/.test(l.trim()); }).length;
    return midSentence / content.length > 0.45;
  }

  function clean(raw, opts) {
    opts = opts || {};
    var text = String(raw || "").replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").replace(/ /g, " ");
    text = text.replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, function (ch) { return LIGATURES[ch] || ch; });
    var lines = text.split("\n");
    var heads = opts.keepRunningHeads ? {} : runningHeads(lines);
    lines = lines.filter(function (line) {
      var t = line.trim();
      if (!t) return true;
      if (isPageNumber(t)) return false;
      if (heads[headKey(t)]) return false;
      return true;
    });

    var wrapped = opts.unwrap === undefined ? looksWrapped(lines) : !!opts.unwrap;
    var paras = [], buf = [];
    function flush() { if (buf.length) { paras.push(buf.join(wrapped ? " " : "\n")); buf = []; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/[ \t]+/g, " ").trim();
      if (!line) { flush(); continue; }
      // A blank-line-free heading (short, no terminal punctuation, all caps or
      // Title Case) starts its own paragraph so it is not swallowed by the
      // previous one when unwrapping.
      if (wrapped && buf.length && line.length < 60 && !/[.!?,;:]$/.test(line) && (line === line.toUpperCase() || /^(chapter|part|book)\b/i.test(line))) { flush(); paras.push(line); continue; }
      if (buf.length && wrapped) {
        var prev = buf[buf.length - 1];
        var hy = prev.match(/^(.*\S)[-‐‑]$/);
        if (hy && /^[a-z]/.test(line)) { buf[buf.length - 1] = hy[1] + line; continue; }
      }
      buf.push(line);
    }
    flush();
    return paras.map(function (p) { return p.replace(/ {2,}/g, " ").replace(/ ([,.;:!?])/g, "$1"); }).join("\n\n").trim() + "\n";
  }

  var api = { clean: clean, isPageNumber: isPageNumber, looksWrapped: looksWrapped };
  if (typeof window !== "undefined") window.TextClean = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
