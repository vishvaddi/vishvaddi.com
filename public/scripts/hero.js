// Homepage instrument (v2 skin): the sweep is a CSS animation; this only
// pauses it while the hero is scrolled out of view.
(function () {
  var hero = document.querySelector(".home-instrument");
  if (!hero || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { hero.classList.toggle("is-paused", !e.isIntersecting); });
  }, { threshold: 0.05 }).observe(hero);
})();
