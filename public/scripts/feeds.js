(function () {
  var DEFAULT_FEEDS = [
    { name: "ABC News", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
    { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { name: "AP News", url: "https://news.google.com/rss/search?q=site%3Aapnews.com&hl=en-AU&gl=AU&ceid=AU%3Aen" },
    { name: "Reuters", url: "https://news.google.com/rss/search?q=site%3Areuters.com&hl=en-AU&gl=AU&ceid=AU%3Aen" },
    { name: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
    { name: "PBS NewsHour", url: "https://www.pbs.org/newshour/feeds/rss/headlines" },
    { name: "The Conversation AU", url: "https://theconversation.com/au/articles.atom" },
    { name: "DW World", url: "https://rss.dw.com/rdf/rss-en-world" },
    { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { name: "ABC Business", url: "https://www.abc.net.au/news/feed/51892/rss.xml" },
    { name: "Reuters Business", url: "https://news.google.com/rss/search?q=site%3Areuters.com%2Fbusiness&hl=en-AU&gl=AU&ceid=AU%3Aen" },
    { name: "ABC Australian Construction", url: "https://news.google.com/rss/search?q=site%3Aabc.net.au%2Fnews%20construction%20Australia&hl=en-AU&gl=AU&ceid=AU%3Aen" },
    { name: "Australian Constructors Association", url: "https://www.constructors.com.au/feed/" },
    { name: "Construction Dive", url: "https://www.constructiondive.com/feeds/news/" },
  ];
  var DEFAULT_FEED_VERSION = "2026-06-13-free-world-news-v3";

  var SOURCE_COLOURS = [
    "#2563eb", "#16a34a", "#9333ea", "#b45309",
    "#0891b2", "#c026d3", "#dc2626", "#0d9488",
  ];
  var REFRESH_MS = 10 * 60 * 1000;
  var READ_KEY = "rss_read_items";
  var visibleItems = [];
  var speechQueue = [];
  var speechIndex = 0;
  var speechPaused = false;

  function $(id) { return document.getElementById(id); }

  function loadFeeds() {
    try {
      var seenVersion = localStorage.getItem("rss_feeds_version");
      if (seenVersion !== DEFAULT_FEED_VERSION) {
        localStorage.setItem("rss_feeds_version", DEFAULT_FEED_VERSION);
        localStorage.setItem("rss_feeds", JSON.stringify(DEFAULT_FEEDS));
      }
      var raw = localStorage.getItem("rss_feeds");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(function (f) { return { name: f.name, url: f.url, enabled: f.enabled !== false }; });
      }
    } catch (_) {}
    return DEFAULT_FEEDS.map(function (f) { return { name: f.name, url: f.url, enabled: true }; });
  }

  function saveFeeds(feeds) {
    localStorage.setItem("rss_feeds", JSON.stringify(feeds));
  }

  function loadRead() {
    try { return JSON.parse(localStorage.getItem(READ_KEY) || "{}"); } catch (_) { return {}; }
  }

  function markRead(link) {
    var read = loadRead();
    read[link] = Date.now();
    var keys = Object.keys(read).sort(function (a, b) { return read[b] - read[a]; }).slice(0, 1000);
    var trimmed = {}; keys.forEach(function (key) { trimmed[key] = read[key]; });
    localStorage.setItem(READ_KEY, JSON.stringify(trimmed));
  }

  function colourForIndex(i) {
    return SOURCE_COLOURS[i % SOURCE_COLOURS.length];
  }

  function text(parent, cls, value) {
    var el = document.createElement("div");
    if (cls) el.className = cls;
    el.textContent = value || "";
    parent.appendChild(el);
    return el;
  }

  function textFrom(node, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var found = node.querySelector(selectors[i]);
      var value = found && found.textContent && found.textContent.trim();
      if (value) return value;
    }
    return "";
  }

  function linkFrom(node) {
    var link = node.querySelector("link[href]");
    if (link) return link.getAttribute("href") || "#";
    return textFrom(node, ["link"]) || "#";
  }

  function parseDate(value) {
    var d = value ? new Date(value) : new Date(0);
    return Number.isFinite(d.valueOf()) ? d : new Date(0);
  }

  function getSegment(date) {
    var hour = (date || new Date()).getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 18) return "afternoon";
    return "night";
  }

  function segmentLabel(segment) {
    if (segment === "morning") return "MORNING";
    if (segment === "afternoon") return "AFTERNOON";
    return "NIGHT";
  }

  function parseFeed(xml, feedName) {
    var doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid XML");
    var nodes = Array.prototype.slice.call(doc.querySelectorAll("item"));
    if (!nodes.length) nodes = Array.prototype.slice.call(doc.querySelectorAll("entry"));
    return nodes.map(function (item) {
      return {
        title: textFrom(item, ["title"]) || "(no title)",
        link: linkFrom(item),
        date: parseDate(textFrom(item, ["pubDate", "updated", "published"])),
        description: textFrom(item, ["description", "summary", "content"]).replace(/<[^>]*>/g, ""),
        source: feedName,
      };
    });
  }

  async function fetchFeed(feed) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    try {
      var res = await fetch("/api/feed?url=" + encodeURIComponent(feed.url), { signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return parseFeed(await res.text(), feed.name);
    } finally {
      clearTimeout(timer);
    }
  }

  var dateFmt = new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });

  function safeLink(raw) {
    try {
      var u = new URL(raw, location.href);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : "#";
    } catch (_) {
      return "#";
    }
  }

  function renderItems(items) {
    visibleItems = items.slice();
    var read = loadRead();
    if ($("feed-unread-only") && $("feed-unread-only").checked) items = items.filter(function (item) { return !read[item.link]; });
    var container = $("feed-items");
    container.textContent = "";
    if (!items.length) {
      var empty = document.createElement("p");
      empty.style.cssText = "color: var(--muted); font-size: 0.875rem;";
      empty.textContent = "No items.";
      container.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement("a");
      row.className = "note-row";
      row.href = safeLink(item.link);
      row.target = "_blank";
      row.rel = "noopener";
      row.dataset.feedLink = item.link;
      row.style.alignItems = "flex-start";
      if (read[item.link]) row.classList.add("is-read");
      row.addEventListener("click", function () { markRead(item.link); row.classList.add("is-read"); });

      var left = document.createElement("div");
      left.className = "feed-row-left";
      var label = document.createElement("span");
      label.className = "source-label";
      label.style.background = item._colour;
      label.textContent = item.source;
      var body = document.createElement("div");
      text(body, "note-title", item.title);
      if (item.description) text(body, "note-desc", item.description.slice(0, 120));
      left.append(label, body);

      var date = document.createElement("span");
      date.className = "note-date";
      date.textContent = item.date.valueOf() ? dateFmt.format(item.date) : "";
      row.append(left, date);
      container.appendChild(row);
    });
  }

  function renderDailySummary(items) {
    var segment = getSegment();
    var label = $("daily-summary-segment");
    var lead = $("daily-summary-lead");
    var list = $("daily-summary-list");
    var updated = $("daily-summary-updated");

    if (!label || !lead || !list || !updated) return;

    label.textContent = segmentLabel(segment);
    list.textContent = "";

    var seen = {};
    var recent = [];
    items.forEach(function (item) {
      var key = (item.title || "").trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      recent.push(item);
    });

    var top = recent.slice(0, 4);
    if (!top.length) {
      lead.textContent = "No summary available right now.";
      var empty = document.createElement("li");
      empty.textContent = "No recent items were returned by the free feeds.";
      list.appendChild(empty);
      updated.textContent = "";
      return;
    }

    lead.textContent = top[0].title;
    if (top[0].source) {
      lead.textContent = top[0].source + " leads with " + top[0].title;
    }

    top.slice(1).forEach(function (item) {
      var li = document.createElement("li");
      li.textContent = item.source + ": " + item.title;
      list.appendChild(li);
    });

    if (top.length === 1) {
      var single = document.createElement("li");
      single.textContent = top[0].source + ": " + top[0].title;
      list.appendChild(single);
    }

    updated.textContent =
      "Updated " +
      new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }) +
      " · " +
      segmentLabel(segment).toLowerCase() +
      " cycle";
  }

  function renderFeedList(feeds) {
    var list = $("feed-list");
    list.textContent = "";
    feeds.forEach(function (feed, i) {
      var row = document.createElement("div");
      row.className = "feed-manage-row";
      var left = document.createElement("span");
      left.style.cssText = "display: flex; align-items: center; gap: 0.5rem; min-width: 0;";
      var dot = document.createElement("span");
      dot.style.cssText = "width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block;";
      dot.style.background = colourForIndex(i);
      var enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.className = "feed-enabled";
      enabled.checked = feed.enabled !== false;
      enabled.setAttribute("aria-label", "Enable " + feed.name);
      enabled.addEventListener("change", function () {
        var next = loadFeeds();
        if (next[i]) next[i].enabled = enabled.checked;
        saveFeeds(next);
        loadAll();
      });
      var label = document.createElement("span");
      label.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      label.textContent = feed.name + " — " + feed.url;
      var remove = document.createElement("button");
      remove.className = "feed-remove-btn";
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + feed.name);
      remove.textContent = "x";
      remove.addEventListener("click", function () {
        var next = loadFeeds();
        next.splice(i, 1);
        saveFeeds(next);
        renderFeedList(next);
        loadAll();
      });
      left.append(enabled, dot, label);
      row.append(left, remove);
      list.appendChild(row);
    });
  }

  async function loadAll() {
    var status = $("feed-status");
    var feeds = loadFeeds();
    renderFeedList(feeds);
    status.textContent = "Loading...";

    var activeFeeds = feeds.filter(function (f) { return f.enabled !== false; });
    var results = await Promise.allSettled(activeFeeds.map(function (f) { return fetchFeed(f); }));
    var all = [];
    var failed = 0;
    results.forEach(function (r, i) {
      if (r.status === "fulfilled") {
        r.value.forEach(function (item) {
          item._colour = colourForIndex(feeds.indexOf(activeFeeds[i]));
          all.push(item);
        });
      } else {
        failed++;
      }
    });

    all.sort(function (a, b) { return b.date - a.date; });
    renderDailySummary(all);
    renderItems(all);

    var now = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    status.textContent =
      all.length + " items · updated " + now + (failed ? " · " + failed + " feed(s) failed" : "");
  }

  $("feed-add-btn").addEventListener("click", function () {
    var input = $("feed-url-input");
    var url = input.value.trim();
    if (!url) return;
    var parsed;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch (_) {
      $("feed-status").textContent = "Enter a valid https:// feed URL.";
      return;
    }
    var feeds = loadFeeds();
    feeds.push({ name: parsed.hostname.replace(/^www\./, "").split(".")[0], url: parsed.href, enabled: true });
    saveFeeds(feeds);
    input.value = "";
    renderFeedList(feeds);
    loadAll();
  });

  $("feed-refresh-btn").addEventListener("click", loadAll);

  function stopSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speechQueue = []; speechIndex = 0; speechPaused = false;
    document.querySelectorAll(".is-speaking").forEach(function (row) { row.classList.remove("is-speaking"); });
    $("speak-pause").disabled = true; $("speak-stop").disabled = true; $("speak-pause").textContent = "Pause"; $("speak-status").textContent = "";
  }

  function speakNext() {
    if (!speechQueue.length || speechPaused) return;
    if (speechIndex >= speechQueue.length) { stopSpeech(); return; }
    document.querySelectorAll(".is-speaking").forEach(function (row) { row.classList.remove("is-speaking"); });
    var entry = speechQueue[speechIndex];
    if (entry.link) {
      var row = Array.from(document.querySelectorAll("[data-feed-link]")).find(function (candidate) { return candidate.dataset.feedLink === entry.link; });
      if (row) row.classList.add("is-speaking");
    }
    $("speak-status").textContent = (speechIndex + 1) + " of " + speechQueue.length;
    var utterance = new SpeechSynthesisUtterance(entry.text);
    utterance.lang = navigator.language || "en-AU";
    utterance.rate = 0.9;
    utterance.onend = function () { speechIndex += 1; speakNext(); };
    utterance.onerror = stopSpeech;
    window.speechSynthesis.speak(utterance);
  }

  function startSpeech(entries) {
    stopSpeech();
    if (!("speechSynthesis" in window)) { $("speak-status").textContent = "Speech is not supported in this browser."; return; }
    speechQueue = entries.filter(function (entry) { return entry.text; });
    if (!speechQueue.length) return;
    $("speak-pause").disabled = false; $("speak-stop").disabled = false;
    speakNext();
  }

  $("speak-summary").addEventListener("click", function () {
    var parts = [$("daily-summary-lead").textContent].concat(Array.from($("daily-summary-list").querySelectorAll("li")).map(function (li) { return li.textContent; }));
    startSpeech(parts.map(function (value) { return { text: value }; }));
  });
  $("speak-headlines").addEventListener("click", function () {
    startSpeech(visibleItems.map(function (item) { return { text: item.source + ". " + item.title, link: item.link }; }));
  });
  $("speak-pause").addEventListener("click", function () {
    if (speechPaused) { speechPaused = false; speechSynthesis.resume(); this.textContent = "Pause"; }
    else { speechPaused = true; speechSynthesis.pause(); this.textContent = "Resume"; }
  });
  $("speak-stop").addEventListener("click", stopSpeech);
  $("feed-unread-only").addEventListener("change", function () { renderItems(visibleItems); });
  $("feed-mark-read").addEventListener("click", function () { visibleItems.forEach(function (item) { markRead(item.link); }); renderItems(visibleItems); });
  $("feed-export-btn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ version: 1, feeds: loadFeeds() }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "vishvaddi-feeds.json"; a.click(); URL.revokeObjectURL(a.href);
  });
  $("feed-import-input").addEventListener("change", async function () {
    var file = this.files && this.files[0]; if (!file) return;
    try {
      var data = JSON.parse(await file.text());
      var imported = Array.isArray(data) ? data : data.feeds;
      if (!Array.isArray(imported)) throw new Error("No feeds array");
      var clean = imported.map(function (f) { var u = new URL(f.url); if (u.protocol !== "https:") throw new Error("Only HTTPS feeds are accepted"); return { name: String(f.name || u.hostname).slice(0, 80), url: u.href, enabled: f.enabled !== false }; });
      saveFeeds(clean); renderFeedList(clean); loadAll();
    } catch (_) { $("feed-status").textContent = "That file is not a valid feed export."; }
    this.value = "";
  });
  loadAll();
  setInterval(loadAll, REFRESH_MS);
})();
