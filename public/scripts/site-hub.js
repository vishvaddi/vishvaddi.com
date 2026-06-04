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
  if (!Array.isArray(recents) || !recents.length) return;

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
})();
