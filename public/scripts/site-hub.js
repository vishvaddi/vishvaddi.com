// Renders a "Recently used" row on the /site hub from the paths recorded by
// chrome.js. Static /public asset (CSP 'self'); clones the matching tool cards.
(function () {
  var sec = document.getElementById("site-recent");
  var grid = document.getElementById("site-recent-grid");
  if (!sec || !grid) return;

  var recents;
  try {
    recents = JSON.parse(localStorage.getItem("vv_site_recents") || "[]");
  } catch (e) {
    recents = [];
  }
  if (!Array.isArray(recents)) recents = [];

  var added = 0;
  recents.forEach(function (href) {
    if (added >= 4) return;
    var card = document.querySelector('.tool-card[data-tool="' + href + '"]');
    if (!card) return;
    var li = document.createElement("li");
    li.appendChild(card.cloneNode(true));
    grid.appendChild(li);
    added++;
  });

  if (added) sec.hidden = false;

  var search = document.getElementById("site-hub-search");
  var empty = document.getElementById("site-search-empty");
  if (search) {
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
      if (sec) sec.hidden = true;
    });
  }
})();
