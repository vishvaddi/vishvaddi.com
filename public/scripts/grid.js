// Reactive blueprint grid: brightens the .blueprint graph-paper lines near the
// pointer by tracking viewport coordinates into --mx/--my (read by site.css).
// Skipped where a pointer glow makes no sense (touch, reduced motion) or
// where there's no grid to light up.
(function () {
  if (!document.querySelector(".blueprint")) return;
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
