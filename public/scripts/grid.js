// Reactive blueprint grid: brightens the .blueprint graph-paper lines near the
// pointer by tracking viewport coordinates into --mx/--my (read by site.css).
// Skipped where a pointer glow makes no sense (touch, reduced motion) or
// where there's no grid to light up.
(function () {
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Cards opt in with data-glow: the pointer position in card coordinates feeds
  // a radial highlight (skin-v2.css). Cheap: one listener per card, rAF-free
  // because a card only repaints while the pointer is inside it.
  document.querySelectorAll("[data-glow]").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--gx", (e.clientX - r.left).toFixed(0) + "px");
      card.style.setProperty("--gy", (e.clientY - r.top).toFixed(0) + "px");
    }, { passive: true });
  });

  if (!document.querySelector(".blueprint")) return;
  var root = document.documentElement;
  var nextX = 0;
  var nextY = 0;
  var queued = false;

  function apply() {
    queued = false;
    root.style.setProperty("--mx", nextX + "px");
    root.style.setProperty("--my", nextY + "px");
  }

  document.addEventListener(
    "pointermove",
    function (e) {
      nextX = e.clientX;
      nextY = e.clientY;
      if (!queued) {
        queued = true;
        requestAnimationFrame(apply);
      }
    },
    { passive: true }
  );
})();
