var PAGE_SIZE = 1800;

var books = [];
var topBooks = [];
var libraryBooks = [];
var nextCursor = null;
var topCursor = null;
var pages = [];
var currentSpread = 0;
var currentBook = null;
var annotations = {};
var noteSelection = null;
var noteColor = "yellow";
var currentSource = "gutenberg";
var currentAudioBook = null;
var currentChapter = 0;

var currentRawText = null;
var DEFAULT_FONT = "'Source Serif 4',Georgia,serif";
var COVER_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360">' +
    '<rect width="240" height="360" fill="#ece5d6"/>' +
    '<rect x="18" y="18" width="204" height="324" rx="10" fill="none" stroke="#6f604d" stroke-width="3"/>' +
    '<text x="120" y="150" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#3a2e20">BOOK</text>' +
    '<text x="120" y="192" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" letter-spacing="2" fill="#6f604d">PUBLIC DOMAIN</text>' +
    "</svg>"
  );

function $(id) { return document.getElementById(id); }

var SOURCE_META = {
  gutenberg: { label: "Project Gutenberg", placeholder: "Search Project Gutenberg…" },
  librivox: { label: "LibriVox audiobooks", placeholder: "Search LibriVox audiobooks…" },
  folktexts: { label: "Ashliman folktexts", placeholder: "Search folk and fairy tales…" },
  wikisource: { label: "Wikisource", placeholder: "Search Wikisource…" },
};

var FOLKTEXTS = [
  // Classic fairy tales
  { id: "ashliman-grimm", title: "Grimm Brothers' Children's and Household Tales", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/grimm.html" },
  { id: "ashliman-cinderella", title: "Cinderella Tales", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0510a.html" },
  { id: "ashliman-beauty", title: "Beauty and the Beast", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/beauty.html" },
  { id: "ashliman-snowwhite", title: "Snow White", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0709.html" },
  { id: "ashliman-sleeping", title: "Sleeping Beauty", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0410.html" },
  { id: "ashliman-redridinghood", title: "Little Red Riding Hood", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0333.html" },
  { id: "ashliman-hanselgretel", title: "Hansel and Gretel", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0327.html" },
  { id: "ashliman-rapunzel", title: "Rapunzel", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0310.html" },
  { id: "ashliman-bluebeard", title: "Bluebeard", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0312.html" },
  { id: "ashliman-rumpelstiltskin", title: "Rumpelstiltskin", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/type0500.html" },
  { id: "ashliman-frogking", title: "The Frog King", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/frogking.html" },
  // Fables
  { id: "ashliman-aesop", title: "Aesop's Fables", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/aesop.html" },
  // Myth, legend and the supernatural
  { id: "ashliman-creation", title: "Creation Myths", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/creation.html" },
  { id: "ashliman-arthur", title: "King Arthur Legends", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/arthur.html" },
  { id: "ashliman-stars", title: "Star Lore and Myths", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/stars.html" },
  { id: "ashliman-werewolf", title: "Werewolf Legends", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/werewolf.html" },
  { id: "ashliman-vampire", title: "Vampire Legends", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/vampire.html" },
  { id: "ashliman-legends", title: "Folktexts: Legends, Folklore, Mythology", author: "D. L. Ashliman", url: "https://sites.pitt.edu/~dash/folktexts.html" },
];

function shuffleArray(list) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// Single-page (Kindle-style) reader: every index is one page, no even-snapping.
function snapSpread(spread) {
  return Math.max(0, Math.min(spread, pages.length - 1));
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
      img.src = r.cover || COVER_PLACEHOLDER;
      img.addEventListener("error", function () { img.src = COVER_PLACEHOLDER; });

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

function normaliseBooks(data) {
  var items = (data && data.results) || [];
  return items.map(function (book) {
    return {
      source: "gutenberg",
      kind: "text",
      id: "gutenberg:" + book.id,
      rawId: book.id,
      title: book.title,
      authors: Array.isArray(book.authors) ? book.authors : [],
      author: book.authors && book.authors[0] ? book.authors[0].name : "Unknown",
      cover: (book.formats && book.formats["image/jpeg"]) || COVER_PLACEHOLDER,
      formats: book.formats || {},
    };
  });
}

function normaliseLibriVox(data) {
  var items = (data && data.results) || [];
  return items.map(function (book) {
    var author = "LibriVox";
    if (Array.isArray(book.authors) && book.authors[0]) {
      author = [book.authors[0].first_name, book.authors[0].last_name].filter(Boolean).join(" ") || author;
    }
    return {
      source: "librivox",
      kind: "audio",
      id: "librivox:" + book.id,
      rawId: book.id,
      title: book.title,
      author: author,
      cover: book.coverart_jpg || book.coverart_thumbnail || COVER_PLACEHOLDER,
      description: book.description || "",
      url: book.url_librivox || book.url_project || "",
      license: "Public domain LibriVox recording",
      chapters: Array.isArray(book.sections) ? book.sections.map(function (s, idx) {
        return {
          title: s.title || ("Chapter " + (idx + 1)),
          url: s.listen_url || s.url || s.url_for_download || "",
          seconds: parseInt(s.playtime || s.playtime_secs || "0", 10) || 0,
        };
      }).filter(function (s) { return !!s.url; }) : [],
    };
  }).filter(function (book) { return book.chapters.length; });
}

function localItems(source, q) {
  var needle = (q || "").trim().toLowerCase();
  return FOLKTEXTS
    .filter(function (item) {
      return !needle || (item.title + " " + item.author).toLowerCase().indexOf(needle) !== -1;
    })
    .map(function (item) {
      return {
        source: source,
        kind: "text",
        id: source + ":" + item.id,
        rawId: item.id,
        title: item.title,
        author: item.author,
        cover: COVER_PLACEHOLDER,
        url: item.url,
        license: "Source text from D. L. Ashliman's folktexts collection",
      };
    });
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
    libraryBooks = normaliseBooks(data);
    topBooks = libraryBooks.slice();
    books = libraryBooks.slice();
    nextCursor = data.next || null;
    topCursor = nextCursor;
    updateLoadMore();
    renderGrid();
    $("status").textContent = books.length ? "" : "No results.";
  } catch (e) {
    $("status").textContent = "Failed to load books.";
    $("status").className = "error-msg";
    nextCursor = null;
    updateLoadMore();
  } finally {
    clearTimeout(timer);
  }
}

async function searchSource(source, query, cursor, append) {
  currentSource = source;
  $("status").textContent = "Loading " + SOURCE_META[source].label + "…";
  $("status").className = "loading";
  nextCursor = null;
  if (source === "gutenberg") {
    var url = cursor
      ? "/api/gutenberg-opds?cursor=" + encodeURIComponent(cursor)
      : "/api/gutenberg-opds?" + (query ? "query=" + encodeURIComponent(query) : "sort_order=downloads");
    var r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    var data = await r.json();
    var incoming = normaliseBooks(data);
    libraryBooks = append ? libraryBooks.concat(incoming) : incoming;
    books = libraryBooks.slice();
    nextCursor = data.next || null;
  } else if (source === "librivox") {
    var lvUrl = cursor
      ? "/api/librivox?offset=" + encodeURIComponent(cursor) + (query ? "&query=" + encodeURIComponent(query) : "")
      : "/api/librivox" + (query ? "?query=" + encodeURIComponent(query) : "");
    var lv = await fetch(lvUrl);
    if (!lv.ok) throw new Error(String(lv.status));
    var lvData = await lv.json();
    var lvIncoming = normaliseLibriVox(lvData);
    libraryBooks = append ? libraryBooks.concat(lvIncoming) : lvIncoming;
    books = libraryBooks.slice();
    nextCursor = lvData.next || null;
  } else if (source === "wikisource") {
    var wsUrl = "/api/wikisource" + (query ? "?query=" + encodeURIComponent(query) : "");
    var ws = await fetch(wsUrl);
    if (!ws.ok) throw new Error(String(ws.status));
    var wsData = await ws.json();
    libraryBooks = normaliseWikisource(wsData);
    books = libraryBooks.slice();
    nextCursor = null;
  } else {
    libraryBooks = localItems(source, query);
    books = libraryBooks.slice();
    nextCursor = null;
  }
  updateLoadMore();
  renderGrid();
  $("status").textContent = books.length ? "" : "No results.";
}

function updateLoadMore() {
  var btn = $("load-more");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "Load more";
  btn.style.display = nextCursor ? "inline-block" : "none";
}

function renderGrid() {
  var grid = $("book-grid");
  grid.innerHTML = "";
  books.forEach(function (b) {
    var card = document.createElement("div");
    card.className = "book-card";
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = b.cover || COVER_PLACEHOLDER;
    img.addEventListener("error", function () { img.src = COVER_PLACEHOLDER; });
    var title = document.createElement("div");
    title.className = "bk-title";
    title.textContent = b.title;
    var author = document.createElement("div");
    author.className = "bk-author";
    author.textContent = (b.author || "Unknown") + " · " + SOURCE_META[b.source].label;
    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(author);
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

async function fetchFolkText(url) {
  var endpoint = "/api/folktext?url=" + encodeURIComponent(url);
  return tryFetch(endpoint, 25000);
}

async function fetchWikisource(title) {
  return tryFetch("/api/wikisource?title=" + encodeURIComponent(title), 25000);
}

function normaliseWikisource(data) {
  return (data.results || []).map(function (item) {
    return {
      source: "wikisource",
      kind: "text",
      id: "wikisource:" + item.title,
      title: item.title,
      author: "Wikisource",
      cover: COVER_PLACEHOLDER,
      url: "https://en.wikisource.org/wiki/" + encodeURIComponent(item.title.replace(/ /g, "_")),
      license: "Public domain text from Wikisource",
    };
  });
}

async function openBook(b) {
  if (b.kind === "audio") {
    return openAudioBook(b);
  }
  var player = $("audio-player");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  currentAudioBook = null;
  if (b.kind === "link") {
    return openLinkBook(b);
  }
  currentBook = b;
  loadPageSound();
  currentRawText = null;
  loadAnnotations(String(b.id));
  $("book-title-label").textContent = b.title;
  $("library-ui").style.display = "none";
  $("reader-ui").style.display = "block";
  setTextMode(true);
  $("left-panel").innerHTML = '<span class="loading">Fetching text…</span>';
  $("right-panel").innerHTML = "";
  updateSaveBtn(false, true);

  var saved = null;
  try { saved = await shelfGet(b.id); } catch (_) {}

  try {
    var raw;
    if (saved) {
      raw = saved.text;
    } else if (b.source === "folktexts") {
      raw = await fetchFolkText(b.url);
    } else if (b.source === "wikisource") {
      raw = await fetchWikisource(b.title);
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

function setTextMode(on) {
  var audio = $("audio-reader");
  var spread = document.querySelector(".spread-wrap");
  var nav = document.querySelector(".nav-row");
  if (audio) audio.classList.toggle("open", !on);
  if ($("reader-settings")) $("reader-settings").classList.remove("open");
  if (spread) spread.style.display = on ? "" : "none";
  if (nav) nav.style.display = on ? "" : "none";
  if ($("save-btn")) $("save-btn").style.display = on ? "" : "none";
  if ($("dl-btn")) $("dl-btn").style.display = on ? "" : "none";
  if ($("settings-btn")) $("settings-btn").style.display = on ? "" : "none";
  if ($("font-sel")) $("font-sel").style.display = on ? "" : "none";
  if ($("font-dec")) $("font-dec").style.display = on ? "" : "none";
  if ($("font-inc")) $("font-inc").style.display = on ? "" : "none";
}

function openLinkBook(b) {
  currentBook = b;
  currentRawText = null;
  pages = [];
  $("book-title-label").textContent = b.title;
  $("library-ui").style.display = "none";
  $("reader-ui").style.display = "block";
  setTextMode(true);
  updateSaveBtn(false, true);
  $("left-panel").innerHTML =
    '<p class="bk-hd">' + escapeHtml(b.title) + '</p>' +
    '<p>' + escapeHtml(b.license || "Free textbook") + '</p>' +
    '<p><a href="' + encodeURI(b.url) + '" target="_blank" rel="noopener">Open on OpenStax →</a></p>';
  $("right-panel").innerHTML = "";
  $("page-info").textContent = "External textbook";
  $("prev-btn").disabled = true;
  $("next-btn").disabled = true;
}

function openAudioBook(b) {
  currentBook = b;
  currentAudioBook = b;
  currentRawText = null;
  $("book-title-label").textContent = b.title;
  $("library-ui").style.display = "none";
  $("reader-ui").style.display = "block";
  setTextMode(false);
  var player = $("audio-player");
  var chapterList = $("chapter-list");
  $("audio-meta").textContent = b.author + " · " + b.license + (b.url ? " · " + b.url : "");
  chapterList.innerHTML = "";
  b.chapters.forEach(function (ch, idx) {
    var btn = document.createElement("button");
    btn.className = "chapter-btn";
    btn.type = "button";
    btn.textContent = String(idx + 1).padStart(2, "0") + " · " + ch.title + (ch.seconds ? " · " + formatTime(ch.seconds) : "");
    btn.addEventListener("click", function () { playChapter(idx, true); });
    chapterList.appendChild(btn);
  });
  var saved = loadAudioPosition(b.id);
  currentChapter = Math.min(saved.chapter || 0, b.chapters.length - 1);
  playChapter(currentChapter, false);
  player.onloadedmetadata = function () {
    if (saved.time && currentAudioBook && currentAudioBook.id === b.id) {
      player.currentTime = saved.time;
    }
  };
  player.onended = function () {
    if (currentChapter + 1 < currentAudioBook.chapters.length) playChapter(currentChapter + 1, true);
  };
  player.ontimeupdate = function () {
    if (!currentAudioBook) return;
    saveAudioPosition(currentAudioBook.id, currentChapter, player.currentTime || 0);
  };
}

function playChapter(index, autoplay) {
  if (!currentAudioBook || !currentAudioBook.chapters[index]) return;
  currentChapter = index;
  var player = $("audio-player");
  player.src = currentAudioBook.chapters[index].url;
  document.querySelectorAll(".chapter-btn").forEach(function (btn, i) {
    btn.classList.toggle("active", i === index);
  });
  saveAudioPosition(currentAudioBook.id, currentChapter, 0);
  if (autoplay) player.play().catch(function () {});
}

function loadAudioPosition(id) {
  try { return JSON.parse(localStorage.getItem("reader-audio-pos-" + id) || "{}"); } catch (_) { return {}; }
}

function saveAudioPosition(id, chapter, time) {
  try { localStorage.setItem("reader-audio-pos-" + id, JSON.stringify({ chapter: chapter, time: time })); } catch (_) {}
}

function formatTime(seconds) {
  var s = Math.max(0, Math.floor(seconds));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0") : m + ":" + String(r).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
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
  var isMobile = true; // single-page Kindle mode (one page at a time)
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

/* ── Page-turn sound — a real recorded paper turn (same-origin), with a
   procedural rustle as fallback if the sample can't load. ── */
var sfxOn = true;
var _actx = null;
var pageBuf = null;
var pageBufTried = false;

function ensureCtx() {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!_actx) _actx = new AC();
  if (_actx.state === "suspended") _actx.resume();
  return _actx;
}

function loadPageSound() {
  if (pageBuf || pageBufTried) return;
  var ctx = ensureCtx();
  if (!ctx) return;
  pageBufTried = true;
  fetch("/sounds/page-turn.wav")
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (b) { return ctx.decodeAudioData(b); })
    .then(function (decoded) { pageBuf = decoded; })
    .catch(function () { /* keep the procedural fallback */ });
}

function synthRustle(ctx) {
  var dur = 0.26;
  var frames = Math.floor(ctx.sampleRate * dur);
  var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < frames; i++) {
    var t = i / frames;
    var env = Math.pow(1 - t, 2.3) * (0.55 + 0.45 * Math.sin(t * 34));
    data[i] = (Math.random() * 2 - 1) * env;
  }
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 2700; bp.Q.value = 0.6;
  var g = ctx.createGain(); g.gain.value = 0.16;
  src.connect(bp); bp.connect(g); g.connect(ctx.destination);
  src.start();
}

function playPageTurn() {
  if (!sfxOn) return;
  try {
    var ctx = ensureCtx();
    if (!ctx) return;
    if (pageBuf) {
      var src = ctx.createBufferSource();
      src.buffer = pageBuf;
      // small random pitch/level so repeated turns don't sound mechanical
      src.playbackRate.value = 0.95 + Math.random() * 0.1;
      var g = ctx.createGain();
      g.gain.value = 0.55 + Math.random() * 0.1;
      src.connect(g); g.connect(ctx.destination);
      src.start();
    } else {
      synthRustle(ctx);
      loadPageSound();
    }
  } catch (_) {}
}

function goNext() {
  var isMobile = true; // single-page Kindle mode (one page at a time)
  var step = isMobile ? 1 : 2;
  if (currentSpread + step < pages.length) {
    currentSpread += step;
    playPageTurn();
    renderSpread(true, "next");
  }
}

function goPrev() {
  var isMobile = true; // single-page Kindle mode (one page at a time)
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
  var audio = $("audio-player");
  if (audio) audio.pause();
  $("reader-ui").style.display = "none";
  $("library-ui").style.display = "block";
  currentBook = null;
  currentAudioBook = null;
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
        author: currentBook.author || (currentBook.authors && currentBook.authors[0] ? currentBook.authors[0].name : "Unknown"),
        cover: currentBook.cover || (currentBook.formats && currentBook.formats["image/jpeg"]) || "",
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
  var q = $("search-input").value.trim();
  var source = $("source-select").value;
  searchSource(source, q, null, false)
    .catch(function () {
      $("status").textContent = "Failed to search " + SOURCE_META[source].label + ".";
      $("status").className = "error-msg";
      nextCursor = null;
      updateLoadMore();
    });
});

$("load-more").addEventListener("click", function () {
  if (!nextCursor) return;
  var btn = $("load-more");
  btn.disabled = true;
  btn.textContent = "Loading…";
  searchSource(currentSource, $("search-input").value.trim(), nextCursor, true)
    .catch(function () {
      btn.disabled = false;
      btn.textContent = "Load more — retry";
    });
});
$("search-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("search-btn").click();
});

$("source-select").addEventListener("change", function () {
  currentSource = this.value;
  $("search-input").placeholder = SOURCE_META[currentSource].placeholder;
  $("search-input").value = "";
  searchSource(currentSource, "", null, false).catch(function () {
    $("status").textContent = "Failed to load " + SOURCE_META[currentSource].label + ".";
    $("status").className = "error-msg";
  });
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

// Repaginate only when the *width* changes (rotation, desktop resize). Mobile
// browser chrome (address bar) changes height on scroll — ignoring that stops
// the reader re-laying-out and flashing on every interaction.
var lastW = window.innerWidth;
window.addEventListener("resize", function () {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  repaginate();
});

/* ── Fullscreen / immersive (works on every device, incl. iOS) ── */
function inImmersive() {
  return document.body.classList.contains("reader-immersive");
}
function setImmersive(on) {
  document.body.classList.toggle("reader-immersive", on);
  var btn = $("fs-btn");
  if (btn) btn.textContent = on ? "✕ Exit" : "⛶ Full screen";
  // size changed — relayout once to fill the new viewport
  repaginate();
}
function toggleFullscreen() {
  var elem = document.documentElement;
  var goingIn = !inImmersive();
  setImmersive(goingIn);
  try {
    if (goingIn) {
      var rq = elem.requestFullscreen || elem.webkitRequestFullscreen;
      if (rq) rq.call(elem).catch(function () {});
    } else {
      var ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex && (document.fullscreenElement || document.webkitFullscreenElement)) ex.call(document);
    }
  } catch (_) {
    /* native FS unavailable (e.g. iOS) — CSS immersive still applies */
  }
}
document.addEventListener("fullscreenchange", function () {
  // keep CSS state in sync if the user exits native FS with Esc
  if (!document.fullscreenElement && inImmersive()) setImmersive(false);
});
if ($("fs-btn")) $("fs-btn").addEventListener("click", toggleFullscreen);

/* ── Quick font-size controls in the header ── */
function bumpFont(delta) {
  var input = $("rs-size");
  if (!input) return;
  var v = Math.max(80, Math.min(220, (parseInt(input.value, 10) || 100) + delta));
  input.value = v;
  $("rs-size-val").textContent = v + "%";
  saveReaderSettings();
}
if ($("font-dec")) $("font-dec").addEventListener("click", function () { bumpFont(-10); });
if ($("font-inc")) $("font-inc").addEventListener("click", function () { bumpFont(10); });

/* ── Font family in the header (mirrors the settings dropdown) ── */
if ($("font-sel")) {
  var rsFont = $("rs-font");
  if (rsFont) $("font-sel").value = rsFont.value;
  $("font-sel").addEventListener("change", function () {
    if (rsFont) rsFont.value = this.value;
    saveReaderSettings();
  });
}

/* ── Download the open book as a .txt file ── */
function downloadBook() {
  if (!currentRawText || !currentBook) return;
  var name = (currentBook.title || "book").replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "");
  var blob = new Blob([currentRawText], { type: "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (name || "book") + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}
if ($("dl-btn")) $("dl-btn").addEventListener("click", downloadBook);

renderShelf();
searchSource("gutenberg", "", null, false).catch(function () {
  $("status").textContent = "Failed to load Project Gutenberg.";
  $("status").className = "error-msg";
});
