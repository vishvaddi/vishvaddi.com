var CLASSICS = "1342,84,11,2701,345,174,1661,98,1400,2600,1514,16";
var PAGE_SIZE = 1800;

var books = [];
var pages = [];
var currentSpread = 0;
var currentBook = null;
var annotations = {};
var noteSelection = null;
var noteColor = "yellow";

function $(id) { return document.getElementById(id); }

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
  try {
    var r = await fetch(url);
    var data = await r.json();
    books = data.results || [];
    renderGrid();
    $("status").textContent = books.length ? "" : "No results.";
  } catch (e) {
    $("status").textContent = "Failed to load books.";
    $("status").className = "error-msg";
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

async function openBook(b) {
  currentBook = b;
  loadAnnotations(String(b.id));
  $("book-title-label").textContent = b.title;
  $("library-ui").style.display = "none";
  $("reader-ui").style.display = "block";
  $("left-panel").innerHTML = '<span class="loading">Fetching text…</span>';
  $("right-panel").innerHTML = "";

  var textUrl = b.formats["text/plain; charset=utf-8"]
    || b.formats["text/plain; charset=us-ascii"]
    || b.formats["text/plain"]
    || "";

  if (!textUrl) {
    $("left-panel").innerHTML = '<span class="error-msg">No plain text available for this book.</span>';
    return;
  }

  try {
    var proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(textUrl);
    var r = await fetch(proxyUrl);
    var raw = await r.text();
    pages = paginateText(raw);
    currentSpread = 0;
    renderSpread(false);
  } catch (e) {
    $("left-panel").innerHTML = '<span class="error-msg">Failed to load text. Try another book.</span>';
  }
}

function paginateText(raw) {
  var start = raw.search(/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG/i);
  var end = raw.search(/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start !== -1) raw = raw.slice(raw.indexOf("\n", start) + 1);
  if (end !== -1) raw = raw.slice(0, end);

  var paras = raw.split(/\n\n+/).map(function (p) { return p.replace(/\s+/g, " ").trim(); }).filter(Boolean);
  var result = [];
  var cur = "";
  for (var i = 0; i < paras.length; i++) {
    var para = paras[i];
    var candidate = cur ? cur + "\n\n" + para : para;
    if (candidate.length > PAGE_SIZE && cur) {
      result.push(cur);
      cur = para;
    } else {
      cur = candidate;
    }
  }
  if (cur) result.push(cur);
  return result;
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
  var text = pages[idx];
  var html = text.split(/\n\n/).map(function (p) { return "<p>" + p + "</p>"; }).join("");
  return applyAnnotations(html, idx);
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

  var total = isMobile ? pages.length : Math.ceil(pages.length / 2);
  var current = isMobile ? currentSpread + 1 : Math.floor(currentSpread / 2) + 1;
  $("page-info").textContent = "Spread " + current + " / " + total;
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

function goNext() {
  var isMobile = window.innerWidth <= 640;
  var step = isMobile ? 1 : 2;
  if (currentSpread + step < pages.length) {
    currentSpread += step;
    renderSpread(true, "next");
  }
}

function goPrev() {
  var isMobile = window.innerWidth <= 640;
  var step = isMobile ? 1 : 2;
  if (currentSpread - step >= 0) {
    currentSpread -= step;
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
  pages = [];
});

document.addEventListener("keydown", function (e) {
  if ($("reader-ui").style.display === "none") return;
  if (e.key === "ArrowRight") goNext();
  if (e.key === "ArrowLeft") goPrev();
});

$("search-btn").addEventListener("click", function () {
  var q = $("search-input").value.trim();
  if (!q) return;
  fetchBooks("https://gutendex.com/books/?search=" + encodeURIComponent(q));
});
$("search-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("search-btn").click();
});

fetchBooks("https://gutendex.com/books/?ids=" + CLASSICS);
