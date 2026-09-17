// Site-wide command palette (Ctrl/Cmd+K or "/"). Plain /public asset — see
// chrome.js header comment for why (CSP script-src 'self', no inline JS).
// The index itself lives in a non-executing <script type="application/json">
// block in Base.astro so this file needs no build step and no fetch.
(function () {
  var RECENT_KEY = "vv_palette_recent";
  var MAX_RESULTS = 8;
  var MAX_RECENT = 5;

  var overlay = document.getElementById("vv-palette");
  var toggleBtn = document.getElementById("palette-toggle");
  if (!overlay) return; // immersive pages render no palette markup

  var input = document.getElementById("vv-palette-input");
  var list = document.getElementById("vv-palette-results");
  var index = loadIndex();
  var byHref = {};
  for (var i = 0; i < index.length; i++) byHref[index[i].href] = index[i];

  var currentResults = [];
  var activeIndex = -1;
  var lastFocused = null;

  function loadIndex() {
    var node = document.getElementById("vv-palette-index");
    if (!node) return [];
    try {
      return JSON.parse(node.textContent || "[]");
    } catch (e) {
      return [];
    }
  }

  function getRecent() {
    try {
      var raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function pushRecent(href) {
    try {
      var next = getRecent().filter(function (h) { return h !== href; });
      next.unshift(href);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
    } catch (e) {
      /* private mode — ignore */
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  // Cheap "characters appear in order" fallback so a query like "ctlst" still
  // finds Cut List without a real fuzzy-matching library.
  function isSubsequence(q, s) {
    var qi = 0;
    for (var si = 0; si < s.length && qi < q.length; si++) {
      if (s[si] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function scoreItem(item, q) {
    var title = item.title.toLowerCase();
    if (title.indexOf(q) === 0) return 4;
    var words = title.split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      if (words[w].indexOf(q) === 0) return 3;
    }
    var keywords = (item.keywords || "").toLowerCase();
    if (title.indexOf(q) !== -1 || keywords.indexOf(q) !== -1) return 2;
    if (isSubsequence(q, title)) return 1;
    return 0;
  }

  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      var recent = getRecent();
      var out = [];
      for (var r = 0; r < recent.length; r++) {
        var found = byHref[recent[r]];
        if (found) out.push({ href: found.href, title: found.title, group: "Recent" });
      }
      return out;
    }

    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var s = scoreItem(index[i], q);
      if (s > 0) scored.push({ item: index[i], score: s });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.title.localeCompare(b.item.title);
    });

    // Best-scoring group first, so same-group rows land together — that plus
    // the per-row group tag is what "grouped by group label" means here.
    var groupBest = {};
    scored.forEach(function (s) {
      if (!(s.item.group in groupBest) || s.score > groupBest[s.item.group]) groupBest[s.item.group] = s.score;
    });
    var groupOrder = Object.keys(groupBest).sort(function (a, b) { return groupBest[b] - groupBest[a]; });
    var byGroup = {};
    scored.forEach(function (s) {
      (byGroup[s.item.group] = byGroup[s.item.group] || []).push(s.item);
    });

    var results = [];
    groupOrder.forEach(function (g) {
      byGroup[g].forEach(function (item) {
        if (results.length < MAX_RESULTS) results.push(item);
      });
    });
    return results;
  }

  function paint(results) {
    currentResults = results;
    list.innerHTML = "";
    results.forEach(function (item, i) {
      var row = document.createElement("li");
      row.id = "vv-palette-opt-" + i;
      row.className = "vv-palette-row" + (i === 0 ? " active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === 0 ? "true" : "false");

      var title = document.createElement("span");
      title.className = "vv-palette-title";
      title.textContent = item.title;

      var tag = document.createElement("span");
      tag.className = "vv-palette-tag";
      tag.textContent = item.group;

      row.appendChild(title);
      row.appendChild(tag);
      row.addEventListener("mousemove", function () { setActive(i); });
      row.addEventListener("click", function () { choose(item.href); });
      list.appendChild(row);
    });
    activeIndex = results.length ? 0 : -1;
    input.setAttribute("aria-expanded", results.length ? "true" : "false");
    input.removeAttribute("aria-activedescendant");
    if (results.length) input.setAttribute("aria-activedescendant", "vv-palette-opt-0");
  }

  function setActive(i) {
    var rows = list.querySelectorAll(".vv-palette-row");
    if (!rows.length) {
      activeIndex = -1;
      return;
    }
    if (i < 0) i = rows.length - 1;
    if (i >= rows.length) i = 0;
    rows.forEach(function (row, idx) {
      var isActive = idx === i;
      row.classList.toggle("active", isActive);
      row.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    activeIndex = i;
    input.setAttribute("aria-activedescendant", rows[i].id);
    rows[i].scrollIntoView({ block: "nearest" });
  }

  function choose(href) {
    pushRecent(href);
    close();
    location.assign(href);
  }

  function open() {
    if (!overlay.hidden) return;
    lastFocused = document.activeElement;
    input.value = "";
    paint(search(""));
    overlay.hidden = false;
    document.body.classList.add("vv-palette-open");
    input.focus();
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove("vv-palette-open");
    var restore = lastFocused;
    lastFocused = null;
    if (restore && typeof restore.focus === "function") restore.focus();
  }

  function toggle() {
    if (overlay.hidden) open();
    else close();
  }

  if (toggleBtn) toggleBtn.addEventListener("click", open);

  input.addEventListener("input", function () {
    paint(search(input.value));
  });

  overlay.addEventListener("mousedown", function (e) {
    if (e.target === overlay) close();
  });

  overlay.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && currentResults[activeIndex]) choose(currentResults[activeIndex].href);
    }
  });

  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      toggle();
      return;
    }
    if (overlay.hidden && e.key === "/" && !isTypingTarget(document.activeElement) && location.pathname.indexOf("/studio") !== 0) {
      e.preventDefault();
      open();
    }
  });
})();
