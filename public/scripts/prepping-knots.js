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
    var speed = card.querySelector('[data-knot-speed]');
    var seek = card.querySelector('[data-knot-seek]');
    var status = card.querySelector('[data-playback-status]');
    var pendingSeek = null;

    function applySeek() {
      if (pendingSeek === null || !Number.isFinite(animation.duration) || animation.duration <= 0) return;
      animation.currentTime = animation.duration * pendingSeek / 100;
      pendingSeek = null;
    }

    function stop() {
      animation.pause();
      playButton.textContent = "Play step";
    }

    function show(next) {
      pendingSeek = null;
      index = (next + knot.steps.length) % knot.steps.length;
      copy.textContent = knot.steps[index];
      count.textContent = (index + 1) + " / " + knot.steps.length;
      var base = "/media/knots/" + knot.id + "-step-" + (index + 1);
      animation.poster = base + ".webp";
      animation.src = base + ".mp4";
      animation.setAttribute("aria-label", knot.name + ", step " + (index + 1) + ". " + knot.steps[index]);
      seek.value = "0";
      status.textContent = "Paused. Play when your rope is ready.";
    }

    card.querySelector('[data-action="prev"]').addEventListener("click", function () { stop(); show(index - 1); });
    card.querySelector('[data-action="next"]').addEventListener("click", function () { stop(); show(index + 1); });
    playButton.addEventListener("click", function () {
      if (!animation.paused) { stop(); return; }
      document.querySelectorAll('[data-knot-animation]').forEach(function (other) { if (other !== animation) other.pause(); });
      if (animation.ended) animation.currentTime = 0;
      animation.playbackRate = Number(speed.value);
      animation.play().catch(function (error) {
        if (error.name !== "AbortError") status.textContent = "Could not play this clip. Read the step and use the technique reference below.";
      });
    });
    animation.addEventListener("play", function () { playButton.textContent = "Pause"; status.textContent = "Follow the highlighted working end."; });
    animation.addEventListener("pause", function () {
      playButton.textContent = animation.ended ? "Replay step" : "Play step";
      if (!animation.ended && !animation.error) status.textContent = "Paused. Continue when your rope is ready.";
    });
    animation.addEventListener("ended", function () { status.textContent = "Step complete. Check your rope, then choose the next step."; });
    animation.addEventListener("loadedmetadata", applySeek);
    animation.addEventListener("timeupdate", function () { if (pendingSeek === null && animation.duration) seek.value = String(100 * animation.currentTime / animation.duration); });
    animation.addEventListener("error", function () { status.textContent = "Clip unavailable. The still and written step remain available."; });
    speed.addEventListener("change", function () { animation.playbackRate = Number(speed.value); });
    seek.addEventListener("input", function () {
      stop();
      pendingSeek = Number(seek.value);
      if (animation.readyState >= 1) applySeek();
      else {
        animation.preload = "auto";
        if (animation.networkState === 0) animation.load();
      }
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
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) document.querySelectorAll('[data-knot-animation]').forEach(function (video) { video.pause(); });
  });
  document.getElementById("knot-test-me").addEventListener("click", function () {
    var candidates = knots.filter(function (knot) { return due(mastery[knot.id]); });
    if (!candidates.length) candidates = knots.slice();
    var knot = candidates[Math.floor(Math.random() * candidates.length)];
    var card = document.querySelector('[data-knot="' + knot.id + '"]');
    card.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    card.querySelector('[data-action="practice"]').click();
  });
  document.getElementById("knot-reset").addEventListener("click", function () {
    if (!confirm("Reset all knot practice history?")) return;
    mastery = {}; saveMastery();
  });
  updateSummary();
})();
