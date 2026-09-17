// /site and /audio hub search. The "Recently used" row that used to live
// here was superseded by the site-wide resume strip (resume.js).
(function () {
  var search = document.getElementById("site-hub-search");
  var empty = document.getElementById("site-search-empty");
  if (!search) return;

  search.addEventListener("input", function () {
    var query = search.value.trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll("[data-tool-item]").forEach(function (item) {
      var match = !query || (item.dataset.search || item.textContent || "").toLowerCase().includes(query);
      item.hidden = !match;
      if (match) visible++;
    });
    document.querySelectorAll("[data-tool-group]").forEach(function (group) {
      group.hidden = !group.querySelector("[data-tool-item]:not([hidden])");
    });
    if (empty) empty.hidden = visible !== 0;
  });
})();
