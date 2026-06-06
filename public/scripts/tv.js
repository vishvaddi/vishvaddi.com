var CHANNELS = {
  1: { type: "rage", label: "CH 1 · RAGE" },
  2: { type: "yt",   src: "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1&mute=1", label: "CH 2 · LOFI" },
  3: { type: "yt",   src: "https://www.youtube-nocookie.com/embed/21X5lGlDOfg?autoplay=1&mute=1", label: "CH 3 · NASA" },
  4: { type: "yt",   src: "https://www.youtube-nocookie.com/embed/Q-GFHiuNXoI?autoplay=1&mute=1", label: "CH 4 · CALM" },
  5: { type: "yt",   src: "https://www.youtube-nocookie.com/embed/dp8PhLsUcFE?autoplay=1&mute=1", label: "CH 5 · BBG" },
  6: { type: "off",  label: "CH 6 · OFF" }
};

var currentCh = 2;
var loaded = {};
var noiseAnim = null;

var iframeYt   = document.getElementById("iframe-yt");
var iframeRage = document.getElementById("iframe-rage");
var noiseCanvas = document.getElementById("noise-canvas");
var noiseLabel = document.getElementById("noise-label");
var rageFallback = document.getElementById("rage-fallback");
var indicator = document.getElementById("ch-indicator");
var flash = document.getElementById("tv-flash");

function showFlash(cb) {
  flash.classList.add("on");
  setTimeout(function () {
    flash.classList.remove("on");
    cb();
  }, 130);
}

function stopNoise() {
  if (noiseAnim) { cancelAnimationFrame(noiseAnim); noiseAnim = null; }
  noiseCanvas.style.display = "none";
  noiseLabel.style.display = "none";
}

function startNoise() {
  noiseCanvas.style.display = "block";
  noiseLabel.style.display = "block";
  var ctx = noiseCanvas.getContext("2d");
  var W = noiseCanvas.parentElement.clientWidth;
  var H = noiseCanvas.parentElement.clientHeight;
  noiseCanvas.width = W;
  noiseCanvas.height = H;
  var cols = Math.ceil(W / 3);
  var rows = Math.ceil(H / 3);

  function tick() {
    var img = ctx.createImageData(cols, rows);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = Math.random() * 200 | 0;
      img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
    }
    var offscreen = document.createElement("canvas");
    offscreen.width = cols; offscreen.height = rows;
    offscreen.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, W, H);
    noiseAnim = requestAnimationFrame(tick);
  }
  tick();
}

function switchTo(ch) {
  if (ch === currentCh) return;
  showFlash(function () { applyChannel(ch); });
  currentCh = ch;
  document.querySelectorAll(".ch-btn").forEach(function (b) {
    b.classList.toggle("active", Number(b.dataset.ch) === ch);
  });
}

function applyChannel(ch) {
  var conf = CHANNELS[ch];
  indicator.textContent = conf.label;

  iframeYt.style.display = "none";
  iframeRage.style.display = "none";
  rageFallback.style.display = "none";
  stopNoise();

  if (conf.type === "rage") {
    iframeRage.style.display = "block";
    if (!loaded[ch]) {
      iframeRage.src = "https://www.rageagain.com";
      loaded[ch] = true;
    }
    rageFallback.style.display = "block";

  } else if (conf.type === "yt") {
    iframeYt.style.display = "block";
    if (!loaded[ch]) {
      iframeYt.src = conf.src;
      loaded[ch] = true;
    } else if (iframeYt.src !== conf.src) {
      iframeYt.src = conf.src;
    }

  } else if (conf.type === "off") {
    startNoise();
  }
}

document.querySelectorAll(".ch-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    switchTo(Number(btn.dataset.ch));
  });
});

applyChannel(2);
loaded[2] = true;
