(function () {
  var source = document.getElementById("knot-data");
  if (!source) return;
  var knots;
  try { knots = JSON.parse(source.textContent || "[]"); } catch (_) { return; }

  knots.forEach(function (knot) {
    var card = document.querySelector('[data-knot="' + knot.id + '"]');
    if (!card) return;
    var index = 0;
    var timer = null;
    var rope = card.querySelector(".rope");
    var shadow = card.querySelector(".rope-shadow");
    var copy = card.querySelector(".knot-step");
    var count = card.querySelector(".knot-count");
    var playButton = card.querySelector('[data-action="play"]');
    var speed = card.querySelector("[data-speed]");

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      playButton.textContent = "Play";
    }

    function show(next) {
      index = (next + knot.steps.length) % knot.steps.length;
      rope.setAttribute("d", knot.steps[index][1]);
      shadow.setAttribute("d", knot.steps[index][1]);
      copy.textContent = knot.steps[index][0];
      count.textContent = (index + 1) + " / " + knot.steps.length;
      card.style.setProperty("--draw-speed", Math.min(1100, Number(speed.value)) + "ms");
      card.classList.remove("animating");
      void card.offsetWidth;
      card.classList.add("animating");
    }

    card.querySelector('[data-action="prev"]').addEventListener("click", function () { stop(); show(index - 1); });
    card.querySelector('[data-action="next"]').addEventListener("click", function () { stop(); show(index + 1); });
    playButton.addEventListener("click", function () {
      if (timer) { stop(); return; }
      show(0);
      playButton.textContent = "Pause";
      timer = setInterval(function () { show(index + 1); }, Number(speed.value));
    });
    speed.addEventListener("change", function () {
      if (!timer) return;
      stop();
      playButton.click();
    });
  });
})();
