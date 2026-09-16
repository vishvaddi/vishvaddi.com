// Site chrome: theme toggle with a state-aware sun/moon icon, and closing the
// "More" nav dropdown on outside-click or Escape. Served as a static /public
// asset so the strict CSP covers it via script-src 'self' (no inline hash, and
// Astro won't inline it). The pre-paint theme-init stays inline in <head>.
(function () {
  function effectiveTheme() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyIcon(btn) {
    var dark = effectiveTheme() === "dark";
    btn.textContent = dark ? "☾" : "☀"; // ☾ / ☀
    var label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }

  // Private nav groups and homepage cards are owner-only. The PIN session
  // sets a plain (non-HttpOnly) vv_owner marker alongside it at login, purely
  // so chrome can hide these before first paint without a round trip.
  try {
    var owner = /(?:^|; )vv_owner=1(?:;|$)/.test(document.cookie);
    if (!owner) {
      document.querySelectorAll("[data-private]").forEach(function (el) { el.hidden = true; });
    }
  } catch (e) {
    /* ignore */
  }

  var btn = document.getElementById("theme-toggle");
  if (btn) {
    applyIcon(btn);
    btn.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* private mode — ignore */
      }
      applyIcon(btn);
    });
  }

  // Remember recently used /site tools (most-recent first, capped) so the hub
  // can surface them. Stays in this browser.
  try {
    var p = location.pathname.replace(/\/+$/, "");
    var hub = /^\/(site|audio)\/[^/]+$/.exec(p);
    if (hub) {
      var key = hub[1] === "audio" ? "vv_audio_recents" : "vv_site_recents";
      var arr = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(arr)) arr = [];
      arr = arr.filter(function (x) { return x !== p; });
      arr.unshift(p);
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 6)));
    }
  } catch (e) {
    /* ignore */
  }

  var more = document.querySelector(".nav-more");
  if (more) {
    document.addEventListener("click", function (e) {
      if (more.open && !more.contains(e.target)) more.open = false;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && more.open) more.open = false;
    });
  }

  document.querySelectorAll("[data-site-tool-search]").forEach(function (input) {
    input.addEventListener("input", function () {
      var scope = input.closest(".site-rail, .site-picker-panel");
      if (!scope) return;
      var query = input.value.trim().toLowerCase();
      scope.querySelectorAll("[data-site-tool-link]").forEach(function (link) {
        link.hidden = query !== "" && !(link.dataset.search || link.textContent || "").toLowerCase().includes(query);
      });
      scope.querySelectorAll("[data-site-tool-group]").forEach(function (group) {
        group.hidden = !group.querySelector("[data-site-tool-link]:not([hidden])");
      });
    });
  });

  // public/sw.js only serves an offline page for failed navigations (needed by the
  // Play Store app); it caches nothing else.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
  }
  // Inside the Play Store app (Trusted Web Activity) the referrer is android-app://;
  // remember it for the session so Pro checkout can stay out of the app.
  try {
    if (document.referrer.indexOf("android-app://com.vishvaddi.sitetools") === 0) sessionStorage.setItem("vv_twa", "1");
  } catch (error) {}
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });
})();

// Free-tier nudge + tool_view funnel counter (Addendum 3, docs/PRO_PLAN.md).
// Site-wide script, so this duplicates the small track() helper in
// src/scripts/site/pro.ts rather than importing it (this file is a plain
// /public asset, not a module).
(function () {
  var METRIC_ENDPOINT = "/api/metric";
  function track(event) {
    var payload = JSON.stringify({ event: event });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(METRIC_ENDPOINT, new Blob([payload], { type: "application/json" }))) return;
    } catch (e) {
      /* fall through to fetch */
    }
    try {
      fetch(METRIC_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
    } catch (e) {
      /* ignore — a lost metric isn't worth surfacing */
    }
  }

  var path = location.pathname.replace(/\/+$/, "") || "/";
  function isToolPath(p) {
    return /^\/site\//.test(p) || /^\/audio\//.test(p) || p === "/studio" || /^\/studio\//.test(p) || p === "/money" || /^\/money\//.test(p);
  }
  if (!isToolPath(path)) return;

  track("tool_view");
  if (path === "/pro") return; // never on /pro itself

  try {
    var seen = JSON.parse(sessionStorage.getItem("vv_tool_views") || "[]");
    if (!Array.isArray(seen)) seen = [];
    if (seen.indexOf(path) === -1) seen.push(path);
    sessionStorage.setItem("vv_tool_views", JSON.stringify(seen));

    var hasOwner = /(?:^|; )vv_owner=1(?:;|$)/.test(document.cookie);
    var hasPro = /(?:^|; )vv_pro=1(?:;|$)/.test(document.cookie);
    var dismissed = sessionStorage.getItem("vv_nudge_dismissed") === "1";
    if (seen.length !== 3 || hasOwner || hasPro || dismissed) return;

    var main = document.querySelector("main");
    if (!main) return;
    var bar = document.createElement("div");
    bar.className = "vv-nudge";
    bar.setAttribute("role", "note");
    var text = document.createElement("span");
    text.textContent = "Pro is A$100 a year — your business name on every export, plus sync. ";
    var link = document.createElement("a");
    link.href = "/pro";
    link.textContent = "See Pro";
    link.addEventListener("click", function () { track("nudge_click"); });
    text.appendChild(link);
    var close = document.createElement("button");
    close.type = "button";
    close.className = "vv-nudge-dismiss";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", function () {
      bar.remove();
      try { sessionStorage.setItem("vv_nudge_dismissed", "1"); } catch (e) { /* ignore */ }
    });
    bar.append(text, close);
    main.insertBefore(bar, main.firstChild);
    track("nudge_shown");
  } catch (e) {
    /* sessionStorage unavailable (private mode) — skip the nudge, tool_view already fired */
  }
})();
