// "Pick up where you left off" strip: reads small per-tool localStorage
// summaries (never the multi-MB studio/money/training keys) and renders up
// to 4 cards. First-time visitors have none of these keys, so the section
// stays hidden — there is no empty state to design for.
(function () {
  var section = document.getElementById("vv-resume");
  var grid = document.getElementById("vv-resume-grid");
  if (!section || !grid) return;

  // Every tool the strip can name. Tools without saved state still appear when
  // they are in the recents list, with a plain "Recently used" line.
  var TITLES = {
    "/site/calc": "Calculator",
    "/site/notepad": "Calc Notepad",
    "/site/convert": "Unit Converter",
    "/site/materials": "Material Calculators",
    "/site/geometry": "Geometry & Setout",
    "/site/rate": "Rate Builder",
    "/site/charge-rate": "Charge-Out Rate",
    "/site/prices": "Price Tracker",
    "/site/programme": "Programme Builder",
    "/site/cut-list": "Cut List",
    "/site/sheet": "Sheet Nesting",
    "/site/lattice": "Lattice",
    "/site/span": "Timber Span Lookup",
    "/site/records": "Site Records",
    "/site/voice": "Voice Notes",
    "/site/sketch": "Sketchpad",
    "/site/gauges": "Phone Tools",
    "/site/pdf": "PDF Toolkit",
    "/site/quickref": "Quick Reference",
    "/site/resources": "Resources",
    "/audio/chords": "Chord & Scale Lab",
    "/audio/prep": "Sample Prep",
    "/audio/bpm": "BPM Maths",
    "/audio/metronome": "Tuner & Metronome",
    "/audio/lofi": "Lo-fi Processor",
    "/audio/ear": "Ear Training",
    "/audio/analyser": "Track Analyser",
    "/studio": "Studio",
    "/radio": "Radio",
  };

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  // Every branch is independently try/caught by the caller — a bad value
  // for one tool must never stop the others from rendering.
  function summarise(href) {
    if (href === "/site/programme") {
      var programmes = safeParse(localStorage.getItem("programme_v1"));
      if (!Array.isArray(programmes) || !programmes.length) return null;
      var latest = programmes.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); })[0];
      var tasks = Array.isArray(latest.tasks) ? latest.tasks.length : 0;
      return plural(programmes.length, "programme") + " · " + latest.title + " · " + plural(tasks, "task");
    }
    if (href === "/site/lattice") {
      var sheets = safeParse(localStorage.getItem("lattice_sheets_v1"));
      if (!Array.isArray(sheets) || !sheets.length) return null;
      var latestSheet = sheets.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); })[0];
      return plural(sheets.length, "sheet") + " · " + latestSheet.name;
    }
    if (href === "/site/rate") {
      var rates = safeParse(localStorage.getItem("vv_rates"));
      if (!Array.isArray(rates) || !rates.length) return null;
      return plural(rates.length, "saved rate");
    }
    if (href === "/site/cut-list") {
      var cutlist = safeParse(localStorage.getItem("vv_cutlist_1d_v2"));
      if (!cutlist || !Array.isArray(cutlist.pieces) || !cutlist.pieces.length) return null;
      return (cutlist.name || "Cut list") + " · " + plural(cutlist.pieces.length, "piece");
    }
    if (href === "/site/sheet") {
      var sheetProject = safeParse(localStorage.getItem("vv_cutlist_2d_v2"));
      if (!sheetProject || !Array.isArray(sheetProject.parts) || !sheetProject.parts.length) return null;
      return (sheetProject.name || "Cut list") + " · " + plural(sheetProject.parts.length, "part");
    }
    if (href === "/site/notepad") {
      var raw = localStorage.getItem("site-calc-notepad");
      if (!raw) return null;
      var lines = raw.split("\n");
      var first = "";
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (line.charAt(0) === "#") line = line.slice(1).trim();
        if (line) {
          first = line;
          break;
        }
      }
      if (!first) return null;
      if (first.length > 40) first = first.slice(0, 40);
      return first + " · " + plural(lines.length, "line");
    }
    if (href === "/site/records") {
      var registers = ["variations", "punch", "deliveries", "contacts", "log"];
      var total = 0;
      for (var r = 0; r < registers.length; r++) {
        var entries = safeParse(localStorage.getItem("vv_rec_" + registers[r]));
        if (Array.isArray(entries)) total += entries.length;
      }
      if (!total) return null;
      return total + " entr" + (total === 1 ? "y" : "ies");
    }
    if (href === "/audio/chords") {
      var chordState = safeParse(localStorage.getItem("vv_audio_chords_v1"));
      if (!chordState || !Array.isArray(chordState.slots) || !chordState.slots.length) return null;
      return "saved progression";
    }
    if (href === "/audio/ear") {
      var stats = safeParse(localStorage.getItem("vv_audio_ear_stats_v1"));
      if (!stats || typeof stats !== "object") return null;
      var keys = Object.keys(stats);
      if (!keys.length) return null;
      var asked = 0;
      for (var k = 0; k < keys.length; k++) {
        var s = stats[keys[k]];
        if (s && typeof s.asked === "number") asked += s.asked;
      }
      return asked ? plural(asked, "drill") : "stats saved";
    }
    if (href === "/audio/bpm") {
      var bpm = Number(localStorage.getItem("vv_audio_tempo"));
      if (!bpm || !isFinite(bpm)) return null;
      return bpm + " BPM";
    }
    if (href === "/studio") {
      var name = localStorage.getItem("vv_studio_name");
      if (!name) return null;
      return "Studio · " + name;
    }
    if (href === "/radio") {
      var favourites = safeParse(localStorage.getItem("vv_radio_favourites_v1"));
      if (!Array.isArray(favourites) || !favourites.length) return null;
      return plural(favourites.length, "favourite station");
    }
    return null;
  }

  function safeSummarise(href) {
    try {
      return summarise(href);
    } catch (e) {
      return null;
    }
  }

  function recents(key) {
    var arr = safeParse(localStorage.getItem(key));
    return Array.isArray(arr) ? arr : [];
  }

  var scope = grid.dataset.scope || "home";
  var recentLists = scope === "site" ? [recents("vv_site_recents")]
    : scope === "audio" ? [recents("vv_audio_recents")]
    : [recents("vv_site_recents"), recents("vv_audio_recents")];

  var pool = Object.keys(TITLES).filter(function (href) {
    if (scope === "site") return href.indexOf("/site/") === 0;
    if (scope === "audio") return href.indexOf("/audio/") === 0;
    return true;
  });

  var seen = {};
  var cards = [];

  function tryAdd(href, fromRecents) {
    if (cards.length >= 4 || seen[href] || pool.indexOf(href) === -1) return;
    var summary = safeSummarise(href) || (fromRecents ? "Recently used" : null);
    if (!summary) return;
    cards.push({ href: href, title: TITLES[href], summary: summary });
    seen[href] = true;
  }

  recentLists.forEach(function (list) {
    list.forEach(function (href) {
      if (cards.length < 4) tryAdd(href, true);
    });
  });
  pool.forEach(function (href) {
    if (cards.length < 4) tryAdd(href);
  });

  if (!cards.length) return;

  cards.forEach(function (card) {
    var a = document.createElement("a");
    a.className = "vv-resume-card";
    a.href = card.href;
    var title = document.createElement("span");
    title.className = "t";
    title.textContent = card.title;
    var summary = document.createElement("span");
    summary.className = "d";
    summary.textContent = card.summary;
    a.appendChild(title);
    a.appendChild(summary);
    grid.appendChild(a);
  });

  section.hidden = false;
})();
