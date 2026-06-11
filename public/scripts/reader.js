var PAGE_SIZE = 1800;

var books = [];
var libraryBooks = [];
var pages = [];
var currentSpread = 0;
var currentBook = null;
var annotations = {};
var noteSelection = null;
var noteColor = "yellow";

var currentRawText = null;
var DEFAULT_FONT = "'Source Serif 4',Georgia,serif";

function $(id) { return document.getElementById(id); }

function snapSpread(spread) {
  spread = Math.max(0, Math.min(spread, pages.length - 1));
  if (window.innerWidth > 640) spread -= spread % 2;
  return spread;
}

function restorePosition(bookId) {
  var frac = 0;
  try { frac = parseFloat(localStorage.getItem("reader-pos-" + bookId)) || 0; } catch (_) {}
  return snapSpread(Math.round(frac * pages.length));
}

/* ── Offline shelf (IndexedDB) — survives cache eviction, visible to the user ── */
function openShelfDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open("reader-shelf", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("books", { keyPath: "id" }); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function shelfOp(mode, fn) {
  return openShelfDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("books", mode);
      var req = fn(tx.objectStore("books"));
      tx.oncomplete = function () { resolve(req ? req.result : undefined); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function shelfAll() { return shelfOp("readonly", function (s) { return s.getAll(); }); }
function shelfGet(id) { return shelfOp("readonly", function (s) { return s.get(id); }); }
function shelfPut(rec) { return shelfOp("readwrite", function (s) { return s.put(rec); }); }
function shelfRemove(id) { return shelfOp("readwrite", function (s) { return s.delete(id); }); }

function updateSaveBtn(saved, disabled) {
  var btn = $("save-btn");
  btn.textContent = saved ? "✓ Saved offline" : "↓ Save offline";
  btn.disabled = !!disabled;
}

function renderShelf() {
  shelfAll().then(function (recs) {
    var section = $("shelf-section");
    var grid = $("shelf-grid");
    grid.innerHTML = "";
    if (!recs || !recs.length) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    recs.sort(function (a, b) { return b.savedAt - a.savedAt; });
    recs.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "book-card shelf-card";

      var del = document.createElement("button");
      del.className = "bk-del";
      del.textContent = "✕";
      del.title = "Remove download";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        shelfRemove(r.id).then(renderShelf);
      });

      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      if (r.cover) img.src = r.cover;
      img.addEventListener("error", function () { img.style.visibility = "hidden"; });

      var title = document.createElement("div");
      title.className = "bk-title";
      title.textContent = r.title;

      var author = document.createElement("div");
      author.className = "bk-author";
      author.textContent = r.author;

      card.appendChild(del);
      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(author);
      card.addEventListener("click", function () {
        openBook({ id: r.id, title: r.title, authors: [{ name: r.author }], formats: { "image/jpeg": r.cover } });
      });
      grid.appendChild(card);
    });
  }).catch(function () {});
}

function loadAnnotations(bookId) {
  var raw = localStorage.getItem("reader-ann-" + bookId);
  annotations = raw ? JSON.parse(raw) : {};
}
function saveAnnotations(bookId) {
  localStorage.setItem("reader-ann-" + bookId, JSON.stringify(annotations));
}

async function fetchBooks(url) {
  $("status").textContent = "Loading…";
  $("status").className = "loading";
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    var r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    var data = await r.json();
    libraryBooks = data.results || [];
    books = libraryBooks.slice();
    renderGrid();
    $("status").textContent = books.length ? "" : "No results.";
  } catch (e) {
    $("status").textContent = "Failed to load books.";
    $("status").className = "error-msg";
  } finally {
    clearTimeout(timer);
  }
}

function renderGrid() {
  var grid = $("book-grid");
  grid.innerHTML = "";
  books.forEach(function (b) {
    var img = b.formats["image/jpeg"] || "";
    var author = b.authors[0] ? b.authors[0].name : "Unknown";
    var card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML =
      '<img src="' + img + '" alt="" loading="lazy" />' +
      '<div class="bk-title">' + b.title + '</div>' +
      '<div class="bk-author">' + author + '</div>';
    card.addEventListener("click", function () { openBook(b); });
    grid.appendChild(card);
  });
}

function toDirectUrl(textUrl) {
  var m = textUrl.match(/gutenberg\.org\/(?:ebooks|cache\/epub)\/(\d+)/);
  if (m) return "https://www.gutenberg.org/cache/epub/" + m[1] + "/pg" + m[1] + ".txt";
  return textUrl;
}

async function tryFetch(url, ms) {
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, ms);
  try {
    var r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) throw new Error(r.status);
    var text = await r.text();
    if (text.length < 1000) throw new Error("too short");
    return text;
  } catch(e) { clearTimeout(t); throw e; }
}

async function fetchBookText(textUrl) {
  var direct = toDirectUrl(textUrl);
  var endpoint = "/api/book?url=" + encodeURIComponent(direct);
  try {
    return await tryFetch(endpoint, 25000);
  } catch (_) {
    return tryFetch(endpoint + "&retry=" + Date.now(), 25000);
  }
}

async function openBook(b) {
  currentBook = b;
  currentRawText = null;
  loadAnnotations(String(b.id));
  $("book-title-label").textContent = b.title;
  $("library-ui").style.display = "none";
  $("reader-ui").style.display = "block";
  $("left-panel").innerHTML = '<span class="loading">Fetching text…</span>';
  $("right-panel").innerHTML = "";
  updateSaveBtn(false, true);

  var saved = null;
  try { saved = await shelfGet(b.id); } catch (_) {}

  try {
    var raw;
    if (saved) {
      raw = saved.text;
    } else {
      var textUrl = b.formats["text/plain; charset=utf-8"]
        || b.formats["text/plain; charset=us-ascii"]
        || b.formats["text/plain"]
        || "";
      if (!textUrl) {
        $("left-panel").innerHTML = '<span class="error-msg">No plain text available for this book.</span>';
        return;
      }
      raw = await fetchBookText(textUrl);
    }
    currentRawText = raw;
    updateSaveBtn(!!saved, false);
    $("left-panel").innerHTML = '<span class="loading">Laying out pages…</span>';
    pages = await paginateText(raw);
    if (!pages.length) throw new Error("Book contained no readable pages");
    currentSpread = restorePosition(b.id);
    renderSpread(false);
  } catch (e) {
    $("left-panel").innerHTML = '<span class="error-msg">Failed to load text. Try another book.</span>';
  }
}

function isHeading(t) {
  if (t.length > 80) return false;
  if (/^(chapter|book|part|volume|canto|act|scene|stave|prologue|epilogue|preface|introduction|contents|appendix)\b/i.test(t)) return true;
  var letters = t.replace(/[^a-z]/gi, "");
  return letters.length > 1 && letters === letters.toUpperCase();
}

function paraHTML(p) {
  if (!p.cont && isHeading(p.text)) return '<p class="bk-hd">' + p.text + "</p>";
  return "<p" + (p.cont ? ' class="cont"' : "") + ">" + p.text + "</p>";
}

// Kindle-style pagination: fill each page to the bottom, splitting paragraphs
// at word boundaries. Pages are stored as ready HTML strings. Measured with
// the user's current font settings — repaginate() reruns this when they change.
async function paginateText(raw) {
  var start = raw.search(/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG/i);
  var end = raw.search(/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start !== -1) raw = raw.slice(raw.indexOf("\n", start) + 1);
  if (end !== -1) raw = raw.slice(0, end);
  raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  var paras = raw.split(/\n\n+/)
    .map(function (p) { return p.replace(/[ \t]+/g, " ").trim(); })
    .filter(Boolean);

  var s = loadReaderSettings();
  var pct = (s.size || 100) / 100;
  var lh = (s.lh || 175) / 100;
  var font = s.font || DEFAULT_FONT;

  // Measure the actual panel so pagination matches what fits on screen
  var panel = $("left-panel");
  var H = panel ? panel.clientHeight : 520;
  var W = panel ? panel.clientWidth : 380;

  var probe = document.createElement("div");
  probe.className = "page-probe";
  probe.style.cssText = [
    "position:absolute", "top:-9999px", "left:0",
    "visibility:hidden", "pointer-events:none",
    "width:" + W + "px", "height:auto", "overflow:visible",
    "padding:2.5rem 2rem", "box-sizing:border-box",
    "font-size:" + (0.95 * pct).toFixed(3) + "rem",
    "line-height:" + lh,
    "font-family:" + font
  ].join(";");
  document.body.appendChild(probe);

  var limit = H - 32; // leave room for page number
  function fits(html) {
    probe.innerHTML = html;
    return probe.offsetHeight <= limit;
  }

  var out = [];
  var pageHtml = "";
  var queue = paras.map(function (t) { return { text: t, cont: false }; });

  for (var qi = 0; qi < queue.length; qi++) {
    var item = queue[qi];
    var html = paraHTML(item);
    if (fits(pageHtml + html)) {
      pageHtml += html;
    } else if (isHeading(item.text) || item.text.indexOf(" ") === -1) {
      if (pageHtml) out.push(pageHtml);
      pageHtml = html;
    } else {
      // largest word count that still fits in the remaining space
      var words = item.text.split(" ");
      var lo = 0, hi = words.length - 1, best = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var head = paraHTML({ text: words.slice(0, mid + 1).join(" "), cont: item.cont });
        if (fits(pageHtml + head)) { best = mid + 1; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (best < 12 && pageHtml) {
        // a stub of a few words looks worse than a slightly short page
        out.push(pageHtml);
        pageHtml = "";
        qi--;
      } else if (best === 0) {
        out.push(paraHTML(item));
        pageHtml = "";
      } else {
        out.push(pageHtml + paraHTML({ text: words.slice(0, best).join(" "), cont: item.cont }));
        pageHtml = "";
        queue.splice(qi + 1, 0, { text: words.slice(best).join(" "), cont: true });
      }
    }
    if (qi > 0 && qi % 60 === 0) {
      await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    }
  }
  if (pageHtml) out.push(pageHtml);

  document.body.removeChild(probe);
  return out;
}

function applyAnnotations(html, pageIdx) {
  var key = String(currentBook.id) + ":" + pageIdx;
  var anns = annotations[key] || [];
  anns.forEach(function (ann) {
    var escaped = ann.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var rx = new RegExp("(" + escaped + ")", "g");
    html = html.replace(rx, '<mark class="ann-' + ann.color + '" title="' + (ann.note || "") + '">$1</mark>');
  });
  return html;
}

function pageHTML(idx) {
  if (idx < 0 || idx >= pages.length) return "";
  return applyAnnotations(pages[idx], idx);
}

function renderSpread(animate, direction) {
  var isMobile = window.innerWidth <= 640;
  var leftIdx = currentSpread;
  var rightIdx = isMobile ? -1 : currentSpread + 1;

  var leftNum = document.createElement("span");
  leftNum.className = "page-num";
  leftNum.textContent = leftIdx + 1;

  var rightNum = document.createElement("span");
  rightNum.className = "page-num";
  rightNum.textContent = rightIdx >= 0 ? rightIdx + 1 : "";

  if (!animate || isMobile) {
    var lp = $("left-panel");
    lp.innerHTML = pageHTML(leftIdx);
    lp.appendChild(leftNum);

    var rp = $("right-panel");
    rp.innerHTML = rightIdx >= 0 ? pageHTML(rightIdx) : "";
    if (rightIdx >= 0) rp.appendChild(rightNum);
  } else {
    doFlip(leftIdx, rightIdx, direction);
  }

  $("prev-btn").disabled = currentSpread === 0;
  $("next-btn").disabled = isMobile
    ? currentSpread >= pages.length - 1
    : currentSpread + 2 >= pages.length;

  var lastShown = isMobile ? currentSpread + 1 : Math.min(currentSpread + 2, pages.length);
  var pct = Math.round((lastShown / pages.length) * 100);
  $("page-info").textContent = "Page " + (currentSpread + 1) + " of " + pages.length + " · " + pct + "%";

  if (currentBook && pages.length) {
    try { localStorage.setItem("reader-pos-" + currentBook.id, String(currentSpread / pages.length)); } catch (_) {}
  }
}

function doFlip(leftIdx, rightIdx, direction) {
  var flipper = $("page-flipper");
  var face = $("flipper-face");
  var back = $("flipper-back");

  face.innerHTML = direction === "next" ? pageHTML(leftIdx - 2) : pageHTML(rightIdx + 2);
  back.innerHTML = direction === "next" ? pageHTML(leftIdx + 1) : pageHTML(leftIdx - 1);

  flipper.style.display = "block";
  flipper.classList.remove("flip-fwd", "flip-back");
  flipper.getBoundingClientRect();

  if (direction === "next") {
    flipper.classList.add("flip-fwd");
  } else {
    flipper.style.transform = "rotateY(-180deg)";
    flipper.getBoundingClientRect();
    flipper.classList.add("flip-back");
  }

  setTimeout(function () {
    var lp = $("left-panel");
    lp.innerHTML = pageHTML(leftIdx);
    var ln = document.createElement("span");
    ln.className = "page-num";
    ln.textContent = leftIdx + 1;
    lp.appendChild(ln);

    var rp = $("right-panel");
    rp.innerHTML = rightIdx >= 0 ? pageHTML(rightIdx) : "";
    if (rightIdx >= 0) {
      var rn = document.createElement("span");
      rn.className = "page-num";
      rn.textContent = rightIdx + 1;
      rp.appendChild(rn);
    }

    flipper.style.display = "none";
    flipper.style.transform = "";
    flipper.classList.remove("flip-fwd", "flip-back");
  }, 520);
}

/* ── Page-turn sound (procedural paper rustle — no audio files) ── */
var sfxOn = true;
var _actx = null;

function playPageTurn() {
  if (!sfxOn) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_actx) _actx = new AC();
    var ctx = _actx;
    if (ctx.state === "suspended") ctx.resume();

    var dur = 0.26;
    var frames = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      var t = i / frames;
      // fast attack, quick decay, with a double-swish so it reads as paper
      var env = Math.pow(1 - t, 2.3) * (0.55 + 0.45 * Math.sin(t * 34));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2700;
    bp.Q.value = 0.6;
    var g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start();
  } catch (_) {}
}

function goNext() {
  var isMobile = window.innerWidth <= 640;
  var step = isMobile ? 1 : 2;
  if (currentSpread + step < pages.length) {
    currentSpread += step;
    playPageTurn();
    renderSpread(true, "next");
  }
}

function goPrev() {
  var isMobile = window.innerWidth <= 640;
  var step = isMobile ? 1 : 2;
  if (currentSpread - step >= 0) {
    currentSpread -= step;
    playPageTurn();
    renderSpread(true, "prev");
  }
}

var noteBtn = $("note-btn");
var notePopup = $("note-popup");

document.addEventListener("mouseup", function (e) {
  if (notePopup.contains(e.target)) return;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed) { noteBtn.style.display = "none"; return; }
  var str = sel.toString().trim();
  if (!str) { noteBtn.style.display = "none"; return; }

  var spread = $("spread");
  if (!spread.contains(sel.anchorNode)) { noteBtn.style.display = "none"; return; }

  noteSelection = { text: str };
  var range = sel.getRangeAt(0);
  var rect = range.getBoundingClientRect();
  noteBtn.style.display = "block";
  noteBtn.style.top = (window.scrollY + rect.bottom + 8) + "px";
  noteBtn.style.left = (window.scrollX + rect.left) + "px";
});

noteBtn.addEventListener("click", function () {
  noteBtn.style.display = "none";
  notePopup.style.display = "block";
  notePopup.style.top = noteBtn.style.top;
  notePopup.style.left = noteBtn.style.left;
  $("note-text").value = "";
  $("note-text").focus();
});

document.querySelectorAll(".note-colors button").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".note-colors button").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    noteColor = btn.dataset.color;
  });
});

$("note-cancel").addEventListener("click", function () {
  notePopup.style.display = "none";
  noteSelection = null;
});

$("note-save").addEventListener("click", function () {
  if (!noteSelection || !currentBook) return;
  var key = String(currentBook.id) + ":" + currentSpread;
  if (!annotations[key]) annotations[key] = [];
  annotations[key].push({ text: noteSelection.text, color: noteColor, note: $("note-text").value });
  saveAnnotations(String(currentBook.id));
  notePopup.style.display = "none";
  noteSelection = null;
  renderSpread(false);
});

$("prev-btn").addEventListener("click", goPrev);
$("next-btn").addEventListener("click", goNext);
$("back-btn").addEventListener("click", function () {
  $("reader-ui").style.display = "none";
  $("library-ui").style.display = "block";
  currentBook = null;
  currentRawText = null;
  pages = [];
  renderShelf();
});

$("save-btn").addEventListener("click", async function () {
  if (!currentBook || !currentRawText) return;
  var id = currentBook.id;
  updateSaveBtn(false, true);
  try {
    var saved = await shelfGet(id);
    if (saved) {
      await shelfRemove(id);
      updateSaveBtn(false, false);
    } else {
      await shelfPut({
        id: id,
        title: currentBook.title,
        author: currentBook.authors && currentBook.authors[0] ? currentBook.authors[0].name : "Unknown",
        cover: (currentBook.formats && currentBook.formats["image/jpeg"]) || "",
        text: currentRawText,
        savedAt: Date.now(),
      });
      updateSaveBtn(true, false);
    }
  } catch (_) {
    updateSaveBtn(false, false);
  }
});

document.addEventListener("keydown", function (e) {
  if ($("reader-ui").style.display === "none") return;
  if (e.key === "ArrowRight") goNext();
  if (e.key === "ArrowLeft") goPrev();
});

$("search-btn").addEventListener("click", function () {
  var q = $("search-input").value.trim().toLowerCase();
  books = q ? libraryBooks.filter(function (b) {
    var authors = (b.authors || []).map(function (a) { return a.name || ""; }).join(" ");
    return (b.title + " " + authors).toLowerCase().includes(q);
  }) : libraryBooks.slice();
  renderGrid();
  $("status").textContent = books.length ? "" : "No matching books in this library.";
  $("status").className = books.length ? "loading" : "error-msg";
});
$("search-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("search-btn").click();
});

/* ── Reader settings ── */
var RS_KEY = "reader-settings";

function applyReaderSettings(s) {
  var spread  = $("spread");
  var panels  = document.querySelectorAll(".page-panel, .flipper-face, .flipper-back");
  var pct     = (s.size || 100) / 100;
  var lh      = (s.lh || 175) / 100;
  var font    = s.font || DEFAULT_FONT;
  var theme   = (s.theme || "#faf7f0,#3a2e20").split(",");
  var bg      = theme[0], fg = theme[1];
  if (spread) spread.style.background = bg;
  panels.forEach(function (p) {
    p.style.fontSize   = (0.95 * pct).toFixed(3) + "rem";
    p.style.lineHeight = String(lh);
    p.style.fontFamily = font;
    p.style.background = bg;
    p.style.color      = fg;
  });
}

var lastMetricsKey = "";
var repagTimer = null;

function metricsKey(s) {
  return (s.size || 100) + "|" + (s.lh || 175) + "|" + (s.font || DEFAULT_FONT);
}

// Layout-affecting settings (and window size) change what fits on a page,
// so the book has to be re-laid-out; keep the same relative position.
function repaginate() {
  if (!currentRawText) return;
  clearTimeout(repagTimer);
  repagTimer = setTimeout(async function () {
    var frac = pages.length ? currentSpread / pages.length : 0;
    pages = await paginateText(currentRawText);
    if (!pages.length) return;
    currentSpread = snapSpread(Math.round(frac * pages.length));
    renderSpread(false);
  }, 250);
}

function saveReaderSettings() {
  var s = {
    size:  parseInt($("rs-size").value),
    lh:    parseInt($("rs-lh").value),
    font:  $("rs-font").value,
    theme: $("rs-theme").value,
    sound: $("rs-sound") ? $("rs-sound").value : "1",
  };
  sfxOn = s.sound !== "0";
  localStorage.setItem(RS_KEY, JSON.stringify(s));
  applyReaderSettings(s);
  var key = metricsKey(s);
  if (key !== lastMetricsKey) {
    lastMetricsKey = key;
    repaginate();
  } else if (pages.length) {
    renderSpread(false);
  }
}

function loadReaderSettings() {
  try {
    var raw = localStorage.getItem(RS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) { return {}; }
}

function initSettings() {
  var s = loadReaderSettings();
  if (s.size)  { $("rs-size").value = s.size;   $("rs-size-val").textContent = s.size + "%"; }
  if (s.lh)    { $("rs-lh").value   = s.lh;     $("rs-lh-val").textContent  = (s.lh / 100).toFixed(2); }
  if (s.font)  $("rs-font").value   = s.font;
  if (s.theme) $("rs-theme").value  = s.theme;
  if (s.sound !== undefined) $("rs-sound").value = s.sound;
  sfxOn = (s.sound === undefined) ? true : (s.sound !== "0");
  lastMetricsKey = metricsKey(s);
  applyReaderSettings(s);

  $("rs-size").addEventListener("input", function () {
    $("rs-size-val").textContent = this.value + "%"; saveReaderSettings();
  });
  $("rs-lh").addEventListener("input", function () {
    $("rs-lh-val").textContent = (this.value / 100).toFixed(2); saveReaderSettings();
  });
  $("rs-font").addEventListener("change",  saveReaderSettings);
  $("rs-theme").addEventListener("change", saveReaderSettings);
  $("rs-sound").addEventListener("change", saveReaderSettings);

  $("settings-btn").addEventListener("click", function () {
    $("reader-settings").classList.toggle("open");
  });
}

initSettings();

window.addEventListener("resize", repaginate);

renderShelf();
fetchBooks("/data/reader-classics.json");
