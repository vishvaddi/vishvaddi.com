// Deferred "Add to home screen" chip. Chrome fires beforeinstallprompt once
// the manifest + service worker (public/sw.js, registered by chrome.js)
// qualify the page; we hold the event and only show a chip once the visitor
// has shown real intent, so it never interrupts a first-ever page view.
(function () {
  var DISMISS_KEY = "vv_install_dismissed";
  var INSTALLED_KEY = "vv_installed";
  var VISITS_KEY = "vv_visits";
  var SESSION_VISIT_GUARD = "vv_visit_counted";
  var OUTCOME_KEY = "vv_install_outcome";
  var DISMISS_DAYS = 30;
  var RESUME_KEYS = ["programme_v1", "lattice_sheets_v1", "vv_rates", "vv_cutlist_1d_v2", "site-calc-notepad"];

  var deferredPrompt = null;
  var chipEl = null;

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage is optional */
    }
  }

  function isTWA() {
    try {
      return sessionStorage.getItem("vv_twa") === "1";
    } catch (e) {
      return false;
    }
  }

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches;
    } catch (e) {
      return false;
    }
  }

  function isBlockedPage() {
    var path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/studio") return true;
    return document.body.classList.contains("immersive-page");
  }

  function dismissedRecently() {
    var raw = safeGet(DISMISS_KEY);
    if (!raw) return false;
    var then = new Date(raw).getTime();
    if (!then) return false;
    return Date.now() - then < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  function isToolPage() {
    var path = location.pathname.replace(/\/+$/, "") || "/";
    return /^\/site\//.test(path);
  }

  function hasResumeState() {
    for (var i = 0; i < RESUME_KEYS.length; i++) {
      var raw = safeGet(RESUME_KEYS[i]);
      if (!raw) continue;
      if (raw === "[]" || raw === "{}") continue;
      return true;
    }
    return false;
  }

  function countVisit() {
    try {
      if (sessionStorage.getItem(SESSION_VISIT_GUARD)) return;
      sessionStorage.setItem(SESSION_VISIT_GUARD, "1");
    } catch (e) {
      return;
    }
    var visits = parseInt(safeGet(VISITS_KEY) || "0", 10);
    if (!isFinite(visits) || visits < 0) visits = 0;
    safeSet(VISITS_KEY, String(visits + 1));
  }

  function visitCount() {
    var visits = parseInt(safeGet(VISITS_KEY) || "0", 10);
    return isFinite(visits) ? visits : 0;
  }

  function removeChip() {
    if (chipEl && chipEl.parentNode) chipEl.parentNode.removeChild(chipEl);
    chipEl = null;
  }

  function dismiss() {
    safeSet(DISMISS_KEY, new Date().toISOString());
    removeChip();
  }

  function buildChip() {
    var chip = document.createElement("div");
    chip.className = "vv-install";
    chip.setAttribute("role", "status");

    var text = document.createElement("span");
    text.className = "vv-install-text";
    text.textContent = "Add to home screen";
    chip.appendChild(text);

    var actions = document.createElement("span");
    actions.className = "vv-install-actions";

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "vv-install-add";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", function () {
      if (!deferredPrompt) {
        removeChip();
        return;
      }
      var prompted = deferredPrompt;
      deferredPrompt = null;
      prompted.prompt();
      prompted.userChoice
        .then(function (choice) {
          safeSet(OUTCOME_KEY, (choice && choice.outcome ? choice.outcome : "unknown") + "@" + new Date().toISOString());
        })
        .catch(function () {})
        .then(function () {
          removeChip();
        });
    });

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "vv-install-close";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", dismiss);

    actions.appendChild(addBtn);
    actions.appendChild(closeBtn);
    chip.appendChild(actions);
    return chip;
  }

  function maybeShowChip() {
    if (chipEl) return;
    if (!deferredPrompt) return;
    if (safeGet(INSTALLED_KEY)) return;
    if (dismissedRecently()) return;
    if (isTWA() || isStandalone()) return;
    if (isBlockedPage()) return;
    if (!(visitCount() >= 2 || (isToolPage() && hasResumeState()))) return;

    chipEl = buildChip();
    document.body.appendChild(chipEl);
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    maybeShowChip();
  });

  window.addEventListener("appinstalled", function () {
    safeSet(INSTALLED_KEY, "1");
    removeChip();
  });

  countVisit();
})();
