var CHANNELS = {
  1: { type: "lofi",    label: "CH 1 · LOFI" },
  2: { type: "explore", label: "CH 2 · WILD" },
  3: { type: "windy",   label: "CH 3 · WIND" },
  4: { type: "fire",    label: "CH 4 · FIRE" },
  5: { type: "stars",   label: "CH 5 · STARS" },
  6: { type: "off",     label: "CH 6 · OFF" }
};

var currentCh = 1;
var exploredLoaded = false;
var windyLoaded = false;
var noiseAnim = null;
var fireAnim = null;
var starsAnim = null;
var lofiAnim = null;

var lofiAudio   = document.getElementById("lofi-audio");
var lofiCanvas  = document.getElementById("lofi-canvas");
var iframeExplore = document.getElementById("iframe-explore");
var iframeWindy = document.getElementById("iframe-windy");
var fireCanvas  = document.getElementById("fire-canvas");
var starsCanvas = document.getElementById("stars-canvas");
var noiseCanvas = document.getElementById("noise-canvas");
var noiseLabel  = document.getElementById("noise-label");
var indicator   = document.getElementById("ch-indicator");
var flash       = document.getElementById("tv-flash");

var LOFI_STREAM = "https://ice1.somafm.com/groovesalad-128-mp3";
var EXPLORE_URL = "https://explore.org/embed/livecams/african-watering-hole";
var WINDY_URL   = "https://embed.windy.com/embed2.html?lat=-33.87&lon=151.21&zoom=5&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1";

// ── Flash transition ──
function showFlash(cb) {
  flash.classList.add("on");
  setTimeout(function () { flash.classList.remove("on"); cb(); }, 130);
}

// ── Helpers ──
function hideAll() {
  lofiCanvas.style.display    = "none";
  iframeExplore.style.display = "none";
  iframeWindy.style.display   = "none";
  fireCanvas.style.display    = "none";
  starsCanvas.style.display   = "none";
  noiseCanvas.style.display   = "none";
  noiseLabel.style.display    = "none";
  stopLofi(); stopFire(); stopStars(); stopNoise();
}

// ── Switch ──
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
  hideAll();

  if (conf.type === "lofi") {
    startLofi();
  } else if (conf.type === "explore") {
    iframeExplore.style.display = "block";
    if (!exploredLoaded) { iframeExplore.src = EXPLORE_URL; exploredLoaded = true; }
  } else if (conf.type === "windy") {
    iframeWindy.style.display = "block";
    if (!windyLoaded) { iframeWindy.src = WINDY_URL; windyLoaded = true; }
  } else if (conf.type === "fire") {
    startFire();
  } else if (conf.type === "stars") {
    startStars();
  } else if (conf.type === "off") {
    startNoise();
  }
}

// ── Lofi visualiser ──
var BAR_COUNT = 28;
var barH = new Float32Array(BAR_COUNT);
var barT = new Float32Array(BAR_COUNT);
var barTick = 0;

function randomiseTargets() {
  var mid = BAR_COUNT / 2;
  for (var i = 0; i < BAR_COUNT; i++) {
    var bell = 1 - Math.abs(i - mid) / mid * 0.35;
    barT[i] = (0.08 + Math.random() * 0.82) * bell;
  }
}

function startLofi() {
  lofiCanvas.style.display = "block";
  var p = lofiCanvas.parentElement;
  lofiCanvas.width = p.clientWidth;
  lofiCanvas.height = p.clientHeight;
  lofiAudio.src = LOFI_STREAM;
  lofiAudio.play().catch(function () {});
  randomiseTargets();
  lofiAnim = requestAnimationFrame(tickLofi);
}

function tickLofi() {
  var ctx = lofiCanvas.getContext("2d");
  var W = lofiCanvas.width, H = lofiCanvas.height;
  ctx.fillStyle = "#0d0d0a";
  ctx.fillRect(0, 0, W, H);

  barTick++;
  if (barTick % 22 === 0) randomiseTargets();

  var bw = W / BAR_COUNT;
  var maxH = H * 0.52;
  var baseY = H * 0.6;

  for (var i = 0; i < BAR_COUNT; i++) {
    barH[i] += (barT[i] - barH[i]) * 0.07;
    var bh = barH[i] * maxH;
    var x = i * bw + bw * 0.18;
    var w = bw * 0.64;
    var grad = ctx.createLinearGradient(x, baseY - bh, x, baseY);
    grad.addColorStop(0, "rgba(100,190,130,0.95)");
    grad.addColorStop(0.6, "rgba(60,140,90,0.6)");
    grad.addColorStop(1, "rgba(30,80,50,0.3)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, baseY - bh, w, bh);
  }

  ctx.fillStyle = "rgba(100,190,130,0.35)";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("GROOVE SALAD · SOMAFM", W / 2, H * 0.78);
  ctx.font = "9px monospace";
  ctx.fillStyle = "rgba(100,190,130,0.18)";
  ctx.fillText("ambient / electronica", W / 2, H * 0.84);

  lofiAnim = requestAnimationFrame(tickLofi);
}

function stopLofi() {
  if (lofiAnim) { cancelAnimationFrame(lofiAnim); lofiAnim = null; }
  lofiAudio.pause();
  lofiAudio.src = "";
}

// ── Fire (Doom algorithm) ──
var FIRE_PAL = [];
var fireBuf, fireW, fireH;
(function initPalette() {
  for (var i = 0; i < 256; i++) {
    var r, g, b;
    if (i < 85)       { r = i * 3;        g = 0;            b = 0; }
    else if (i < 170) { r = 255;          g = (i - 85) * 3; b = 0; }
    else              { r = 255;          g = 255;           b = (i - 170) * 3; }
    FIRE_PAL[i] = [r, g, b];
  }
})();

function startFire() {
  fireCanvas.style.display = "block";
  var p = fireCanvas.parentElement;
  var W = p.clientWidth, H = p.clientHeight;
  fireCanvas.width = W; fireCanvas.height = H;
  fireW = Math.ceil(W / 2); fireH = Math.ceil(H / 2);
  fireBuf = new Uint8Array(fireW * fireH);
  for (var x = 0; x < fireW; x++) fireBuf[(fireH - 1) * fireW + x] = 255;
  fireAnim = requestAnimationFrame(tickFire);
}

function tickFire() {
  var ctx = fireCanvas.getContext("2d");
  for (var y = 0; y < fireH - 1; y++) {
    for (var x = 0; x < fireW; x++) {
      var below = fireBuf[(y + 1) * fireW + x];
      var rand = (Math.random() * 3) | 0;
      var nx = x - rand + 1;
      if (nx < 0) nx = 0;
      if (nx >= fireW) nx = fireW - 1;
      fireBuf[y * fireW + nx] = Math.max(0, below - (rand & 1));
    }
  }
  var img = ctx.createImageData(fireW, fireH);
  for (var i = 0; i < fireBuf.length; i++) {
    var c = FIRE_PAL[fireBuf[i]];
    var p = i * 4;
    img.data[p] = c[0]; img.data[p+1] = c[1]; img.data[p+2] = c[2]; img.data[p+3] = 255;
  }
  var off = document.createElement("canvas");
  off.width = fireW; off.height = fireH;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, fireCanvas.width, fireCanvas.height);
  fireAnim = requestAnimationFrame(tickFire);
}

function stopFire() {
  if (fireAnim) { cancelAnimationFrame(fireAnim); fireAnim = null; }
  fireCanvas.style.display = "none";
}

// ── Starfield ──
var starPool = [];
var STAR_COUNT = 260;

function newStar(scatter) {
  var W = starsCanvas.width, H = starsCanvas.height;
  return {
    x: Math.random() * W - W / 2,
    y: Math.random() * H - H / 2,
    z: scatter ? Math.random() * W : W
  };
}

function startStars() {
  starsCanvas.style.display = "block";
  var p = starsCanvas.parentElement;
  starsCanvas.width = p.clientWidth; starsCanvas.height = p.clientHeight;
  starPool = [];
  for (var i = 0; i < STAR_COUNT; i++) starPool.push(newStar(true));
  starsAnim = requestAnimationFrame(tickStars);
}

function tickStars() {
  var ctx = starsCanvas.getContext("2d");
  var W = starsCanvas.width, H = starsCanvas.height;
  var cx = W / 2, cy = H / 2;
  ctx.fillStyle = "#0d0d0a";
  ctx.fillRect(0, 0, W, H);
  for (var i = 0; i < starPool.length; i++) {
    var s = starPool[i];
    s.z -= 7;
    if (s.z <= 0) { starPool[i] = newStar(false); continue; }
    var px = (s.x / s.z) * W + cx;
    var py = (s.y / s.z) * H + cy;
    if (px < 0 || px > W || py < 0 || py > H) { starPool[i] = newStar(false); continue; }
    var sz = Math.max(0.5, (1 - s.z / W) * 2.8);
    var br = Math.floor((1 - s.z / W) * 255);
    ctx.fillStyle = "rgb(" + br + "," + br + "," + Math.min(255, br + 25) + ")";
    ctx.beginPath();
    ctx.arc(px, py, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  starsAnim = requestAnimationFrame(tickStars);
}

function stopStars() {
  if (starsAnim) { cancelAnimationFrame(starsAnim); starsAnim = null; }
  starsCanvas.style.display = "none";
}

// ── Noise (OFF) ──
function startNoise() {
  noiseCanvas.style.display = "block";
  noiseLabel.style.display = "block";
  var ctx = noiseCanvas.getContext("2d");
  var p = noiseCanvas.parentElement;
  var W = p.clientWidth, H = p.clientHeight;
  noiseCanvas.width = W; noiseCanvas.height = H;
  var cols = Math.ceil(W / 3), rows = Math.ceil(H / 3);
  function tick() {
    var img = ctx.createImageData(cols, rows);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = Math.random() * 200 | 0;
      img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
    }
    var off = document.createElement("canvas");
    off.width = cols; off.height = rows;
    off.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);
    noiseAnim = requestAnimationFrame(tick);
  }
  tick();
}

function stopNoise() {
  if (noiseAnim) { cancelAnimationFrame(noiseAnim); noiseAnim = null; }
  noiseCanvas.style.display = "none";
  noiseLabel.style.display = "none";
}

// ── Init ──
document.querySelectorAll(".ch-btn").forEach(function (btn) {
  btn.addEventListener("click", function () { switchTo(Number(btn.dataset.ch)); });
});

applyChannel(1);
