(function () {
  var DEFAULT_FEEDS = [
    { name: "ABC News", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
    { name: "Hacker News", url: "https://hnrss.org/frontpage" },
    { name: "Kottke", url: "https://feeds.kottke.org/main" },
    { name: "The Prepared", url: "https://theprepared.com/feed/" },
  ];

  var SOURCE_COLOURS = [
    "#2563eb", "#16a34a", "#9333ea", "#b45309",
    "#0891b2", "#c026d3", "#dc2626", "#0d9488",
  ];
  var REFRESH_MS = 10 * 60 * 1000;

  function $(id) { return document.getElementById(id); }

  function loadFeeds() {
    try {
      var raw = localStorage.getItem("rss_feeds");
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return DEFAULT_FEEDS.map(function (f) { return { name: f.name, url: f.url }; });
  }

  function saveFeeds(feeds) {
    localStorage.setItem("rss_feeds", JSON.stringify(feeds));
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
      row.style.alignItems = "flex-start";

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
      left.append(dot, label);
      row.append(left, remove);
      list.appendChild(row);
    });
  }

  async function loadAll() {
    var status = $("feed-status");
    var feeds = loadFeeds();
    renderFeedList(feeds);
    status.textContent = "Loading...";

    var results = await Promise.allSettled(feeds.map(function (f) { return fetchFeed(f); }));
    var all = [];
    var failed = 0;
    results.forEach(function (r, i) {
      if (r.status === "fulfilled") {
        r.value.forEach(function (item) {
          item._colour = colourForIndex(i);
          all.push(item);
        });
      } else {
        failed++;
      }
    });

    all.sort(function (a, b) { return b.date - a.date; });
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
    feeds.push({ name: parsed.hostname.replace(/^www\./, "").split(".")[0], url: parsed.href });
    saveFeeds(feeds);
    input.value = "";
    renderFeedList(feeds);
    loadAll();
  });

  $("feed-refresh-btn").addEventListener("click", loadAll);
  loadAll();
  setInterval(loadAll, REFRESH_MS);
})();
