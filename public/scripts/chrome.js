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

  // Only update existing registrations; the retirement worker unregisters itself.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration("/").then(function (registration) {
      if (registration) return registration.update();
    }).catch(function () {});
  }
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });
})();
