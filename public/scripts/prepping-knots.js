(function () {
  var source = document.getElementById("knot-data");
  if (!source) return;
  var knots;
  try { knots = JSON.parse(source.textContent || "[]"); } catch (_) { return; }
  var STORAGE_KEY = "vv_knot_mastery_v1";
  var DAY = 86400000;
  var intervals = [1, 3, 7, 21, 45];
  var mastery = {};
  try { mastery = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (_) {}

  function saveMastery() { localStorage.setItem(STORAGE_KEY, JSON.stringify(mastery)); updateSummary(); }
  function due(record) { return !record || !record.due || record.due <= Date.now(); }
  function updateSummary() {
    var dueCount = knots.filter(function (knot) { return due(mastery[knot.id]); }).length;
    var learnt = knots.filter(function (knot) { return mastery[knot.id] && mastery[knot.id].streak > 0; }).length;
    var summary = document.getElementById("knot-mastery-summary");
    if (summary) summary.textContent = dueCount + " due now · " + learnt + " of " + knots.length + " recalled correctly";
    knots.forEach(function (knot) {
      var card = document.querySelector('[data-knot="' + knot.id + '"]');
      var status = card && card.querySelector("[data-mastery-status]");
      var record = mastery[knot.id];
      if (status) status.textContent = record ? (due(record) ? "Due now · streak " : "Next review " + new Date(record.due).toLocaleDateString("en-AU") + " · streak ") + record.streak : "Not practised";
    });
  }

  knots.forEach(function (knot) {
    var card = document.querySelector('[data-knot="' + knot.id + '"]');
    if (!card) return;
    var index = 0;
    var animation = card.querySelector("[data-knot-animation]");
    var copy = card.querySelector(".knot-step");
    var count = card.querySelector(".knot-count");
    var playButton = card.querySelector('[data-action="play"]');
    var practice = card.querySelector('[data-action="practice"]');
    var correct = card.querySelector('[data-action="correct"]');
    var reveal = card.querySelector('[data-action="reveal"]');

    function stop() {
      playButton.textContent = "Play step";
    }

    function show(next) {
      index = (next + knot.steps.length) % knot.steps.length;
      copy.textContent = knot.steps[index][0];
      count.textContent = (index + 1) + " / " + knot.steps.length;
      animation.src = "/media/knots/" + knot.id + "-step-" + (index + 1) + ".webp";
    }

    card.querySelector('[data-action="prev"]').addEventListener("click", function () { stop(); show(index - 1); });
    card.querySelector('[data-action="next"]').addEventListener("click", function () { stop(); show(index + 1); });
    playButton.addEventListener("click", function () {
      animation.src = "/media/knots/" + knot.id + "-step-" + (index + 1) + ".webp?replay=" + Date.now();
    });
    practice.addEventListener("click", function () {
      stop();
      card.classList.add("practice-blind");
      practice.hidden = true; correct.hidden = false; reveal.hidden = false;
    });
    reveal.addEventListener("click", function () {
      card.classList.remove("practice-blind");
      practice.hidden = false; correct.hidden = true; reveal.hidden = true;
      var record = mastery[knot.id] || { streak: 0 };
      record.streak = 0; record.due = Date.now() + DAY; mastery[knot.id] = record; saveMastery();
    });
    correct.addEventListener("click", function () {
      card.classList.remove("practice-blind");
      practice.hidden = false; correct.hidden = true; reveal.hidden = true;
      var record = mastery[knot.id] || { streak: 0 };
      record.streak = Math.min(record.streak + 1, intervals.length);
      record.due = Date.now() + intervals[record.streak - 1] * DAY;
      mastery[knot.id] = record; saveMastery();
    });
  });
  document.getElementById("knot-test-me").addEventListener("click", function () {
    var candidates = knots.filter(function (knot) { return due(mastery[knot.id]); });
    if (!candidates.length) candidates = knots.slice();
    var knot = candidates[Math.floor(Math.random() * candidates.length)];
    var card = document.querySelector('[data-knot="' + knot.id + '"]');
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.querySelector('[data-action="practice"]').click();
  });
  document.getElementById("knot-reset").addEventListener("click", function () {
    if (!confirm("Reset all knot practice history?")) return;
    mastery = {}; saveMastery();
  });
  updateSummary();
})();
