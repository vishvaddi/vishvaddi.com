// Homepage blueprint instrument (v2 skin): pointer parallax on the SVG layers
// and a pause when the hero scrolls out of view. The draw-on and sweep are
// CSS animations, so with reduced motion or no pointer this script does
// nothing beyond the offscreen pause.
(function () {
  var hero = document.querySelector(".home-instrument");
  if (!hero) return;
  var layers = hero.querySelectorAll("[data-layer]");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hover = !(window.matchMedia && window.matchMedia("(hover: none)").matches);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { hero.classList.toggle("is-paused", !e.isIntersecting); });
    }, { threshold: 0.05 }).observe(hero);
  }

  if (reduced || !hover || !layers.length) return;

  var queued = false;
  var px = 0;
  var py = 0;
  function apply() {
    queued = false;
    layers.forEach(function (layer) {
      var depth = Number(layer.getAttribute("data-layer")) || 0;
      layer.style.transform = "translate(" + (px * depth).toFixed(1) + "px, " + (py * depth).toFixed(1) + "px)";
    });
  }
  window.addEventListener("pointermove", function (e) {
    var r = hero.getBoundingClientRect();
    // -1..1 from the hero centre, damped so the far layer moves ~8px at most.
    px = ((e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1)) * 8;
    py = ((e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1)) * 8;
    if (!queued) { queued = true; requestAnimationFrame(apply); }
  }, { passive: true });
})();
