var CURATED_STATIONS = [
  { name: "Smooth FM", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/SMOOTH953.mp3", tags: "easy listening sydney", source: "AU", category: "chill", preset: true },
  { name: "FBi Radio", url: "https://streamer.fbiradio.com/stream", tags: "indie sydney", source: "AU", category: "music", preset: true },
  { name: "Gold 104.3", url: "https://ais-arn.streamguys1.com/au_004_icy", tags: "classic hits melbourne", source: "AU", category: "music", preset: true },
  { name: "Fresh 92.7", url: "https://live.fresh927.com.au/freshaac", tags: "electronic adelaide", source: "AU", category: "music", preset: true },
  { name: "NTS 1", url: "https://stream-relay-geo.ntslive.net/stream", tags: "experimental london", source: "WORLD", category: "music" },
  { name: "Radio Paradise", url: "https://stream.radioparadise.com/aac-320", tags: "eclectic listener supported", source: "WORLD", category: "music" },
  { name: "Groove Salad", url: "https://ice1.somafm.com/groovesalad-128-mp3", tags: "ambient downtempo", source: "WORLD", category: "chill" },
  { name: "Perth 6IX", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/6IX.mp3", tags: "oldies perth", source: "AU", category: "music" },
  { name: "3AW", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/3AW.mp3", tags: "talk melbourne", source: "AU", category: "talk" },
  { name: "Sky News Radio", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/NOVA_SKYNEWSAAC.aac", tags: "news australia", source: "AU", category: "talk" },
  { name: "Curtin Radio", url: "https://usa7.fastcast4u.com/proxy/curtinfm?mp=/1", tags: "community perth", source: "AU", category: "music" },
  { name: "2SM Sydney", url: "https://cast4.asurahosting.com/proxy/2sm1269/stream", tags: "talk news sydney", source: "AU", category: "talk" },
  { name: "917 The Wave", url: "https://tls3.coastdev.net/6mm-mp3", tags: "easy listening mandurah", source: "AU", category: "chill" },
  { name: "Fox 101.9", url: "https://legacy.scahw.com.au/3fox_128", tags: "hits melbourne", source: "AU", category: "music" },
  { name: "2MBS Fine Music", url: "https://radio12.shoutcast.net.au:2020/stream/2MBS-ICE", tags: "classical jazz sydney", source: "AU", category: "music" },
  { name: "Coast FM", url: "https://tls1.coastdev.net/coast-mp3?_=370422", tags: "community central coast", source: "AU", category: "music" },
  { name: "Systrum SSR1", url: "https://systrum.net:8443/SSR1", tags: "electronic experimental", source: "AU", category: "music" },
  { name: "SBS PopAsia", url: "https://sbs-ice.streamguys1.com/sbs-popasia-sbs-web", tags: "asian pop australia", source: "AU", category: "music" },
];

var API = "https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/AU?limit=100&order=votes&reverse=true&hidebroken=true";

var audio = document.getElementById("radio-audio");
var lcdStation = document.getElementById("lcd-station");
var lcdStatus = document.getElementById("lcd-status");
var lcdSignal = document.getElementById("lcd-signal");
var lcdBars = document.getElementById("lcd-bars");
var tunerNeedle = document.getElementById("tuner-needle");
var playPauseBtn = document.getElementById("play-pause-btn");
var volumeSlider = document.getElementById("volume-slider");
var stationToggle = document.getElementById("station-toggle");
var stationBay = document.getElementById("station-bay");
var stationClose = document.getElementById("station-close");
var stationSearch = document.getElementById("station-search");
var stationCount = document.getElementById("station-count");
var directoryStatus = document.getElementById("station-directory-status");
var stationEmpty = document.getElementById("station-empty");
var spTrigger = document.getElementById("sp-trigger");
var spList = document.getElementById("sp-list");

var currentStation = null;
var currentUrl = null;
var directoryStations = [];
var activeFilter = "all";
var eqRunning = false;
var eqRaf = null;

audio.volume = parseFloat(volumeSlider.value);

/* ── EQ animation ── */
var barTargets = [3,3,3,3,3,3,3,3];
var barCurrent = [3,3,3,3,3,3,3,3];
var barTimers = [0,0,0,0,0,0,0,0];

function randomBarHeight() {
  return Math.floor(Math.random() * 15) + 2;
}

function tickEq(ts) {
  var bars = lcdBars.querySelectorAll(".lbar");
  for (var i = 0; i < 8; i++) {
    if (ts > barTimers[i]) {
      barTargets[i] = randomBarHeight();
      barTimers[i] = ts + 80 + Math.random() * 220;
    }
    barCurrent[i] += (barTargets[i] - barCurrent[i]) * 0.18;
    if (bars[i]) bars[i].style.height = barCurrent[i].toFixed(1) + "px";
  }
  if (eqRunning) eqRaf = requestAnimationFrame(tickEq);
}

function startEq() {
  if (eqRunning) return;
  eqRunning = true;
  eqRaf = requestAnimationFrame(tickEq);
}

function stopEq() {
  eqRunning = false;
  if (eqRaf) cancelAnimationFrame(eqRaf);
  var bars = lcdBars.querySelectorAll(".lbar");
  for (var i = 0; i < 8; i++) {
    barCurrent[i] = barTargets[i] = 3;
    if (bars[i]) bars[i].style.height = "3px";
  }
}

/* ── Tuner and signal ── */
function getStations() {
  return CURATED_STATIONS.concat(directoryStations);
}

function animateNeedle(station) {
  var stations = getStations();
  var index = stations.findIndex(function(item) { return item.url === station.url; });
  var position = index < 0 || stations.length < 2 ? 50 : 8 + (index / (stations.length - 1)) * 84;
  tunerNeedle.style.left = position.toFixed(1) + "%";
}

var SIGNAL_LEVELS = ["▯▯▯▯▯","▮▯▯▯▯","▮▮▯▯▯","▮▮▮▯▯","▮▮▮▮▯","▮▮▮▮▮"];
var signalAnim = null;

function randomSignal() {
  lcdSignal.textContent = SIGNAL_LEVELS[2 + Math.floor(Math.random() * 4)];
}

function startSignalFlicker() {
  stopSignalFlicker();
  function tick() {
    randomSignal();
    signalAnim = setTimeout(tick, 600 + Math.random() * 1400);
  }
  tick();
}

function stopSignalFlicker() {
  if (signalAnim) {
    clearTimeout(signalAnim);
    signalAnim = null;
  }
  lcdSignal.textContent = "▮▮▯▯▯";
}

function setPlayButton(isPlaying) {
  playPauseBtn.innerHTML = isPlaying ? "&#9646;&#9646;" : "&#9654;";
  playPauseBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
}

function showAudioError() {
  lcdStatus.textContent = "STREAM ERROR";
  setPlayButton(false);
  stopEq();
  stopSignalFlicker();
}

/* ── Scrolling display ── */
var scrollAnim = null;
var scrollPos = 0;
var scrollText = "";

function startScroll(name) {
  stopScroll();
  var padded = name.toUpperCase() + "   ";
  if (padded.length <= 14) {
    lcdStation.textContent = padded;
    return;
  }
  scrollText = padded + padded;
  scrollPos = 0;
  function tick() {
    lcdStation.textContent = scrollText.slice(scrollPos, scrollPos + 14);
    scrollPos = (scrollPos + 1) % padded.length;
    scrollAnim = setTimeout(tick, 200);
  }
  tick();
}

function stopScroll() {
  if (scrollAnim) {
    clearTimeout(scrollAnim);
    scrollAnim = null;
  }
}

/* ── Station directory ── */
function inferCategory(name, tags) {
  var text = (name + " " + tags).toLowerCase();
  if (/(talk|news|current affairs|sport)/.test(text)) return "talk";
  if (/(ambient|chill|downtempo|easy listening|lounge|relax)/.test(text)) return "chill";
  return "music";
}

function normaliseKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\/$/, "");
}

function stationMatches(station, query) {
  if (activeFilter === "preset" && !station.preset) return false;
  if (activeFilter === "au" && !station.isAu) return false;
  if (["music", "talk", "chill"].includes(activeFilter) && station.category !== activeFilter) return false;
  if (!query) return true;
  return (station.name + " " + station.tags + " " + station.source).toLowerCase().includes(query);
}

function createSignalBars() {
  var signal = document.createElement("span");
  signal.className = "station-signal";
  signal.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 4; i++) signal.appendChild(document.createElement("span"));
  return signal;
}

function renderStationList() {
  var stations = getStations();
  var query = stationSearch.value.trim().toLowerCase();
  var fragment = document.createDocumentFragment();
  var visibleCount = 0;

  spList.textContent = "";
  stations.forEach(function(station, index) {
    if (!stationMatches(station, query)) return;
    visibleCount++;

    var button = document.createElement("button");
    button.className = "station-row";
    button.type = "button";
    button.dataset.url = station.url;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", station.url === currentUrl ? "true" : "false");
    button.classList.toggle("active", station.url === currentUrl);

    var channel = document.createElement("span");
    channel.className = "station-channel";
    channel.textContent = String(index + 1).padStart(2, "0");

    var copy = document.createElement("span");
    copy.className = "station-row-copy";
    var name = document.createElement("span");
    name.className = "station-row-name";
    name.textContent = station.name;
    var meta = document.createElement("span");
    meta.className = "station-row-meta";
    meta.textContent = station.source + (station.tags ? " / " + station.tags : "");
    copy.appendChild(name);
    copy.appendChild(meta);

    button.appendChild(channel);
    button.appendChild(copy);
    button.appendChild(createSignalBars());
    button.addEventListener("click", function() {
      play(station);
      setDirectoryOpen(false);
    });
    fragment.appendChild(button);
  });

  spList.appendChild(fragment);
  stationEmpty.hidden = visibleCount !== 0;
  stationCount.textContent = stations.length + " CH";
}

function setDirectoryOpen(open) {
  stationBay.hidden = !open;
  stationToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    renderStationList();
    window.setTimeout(function() { stationSearch.focus(); }, 0);
  }
}

function syncStationDisplay() {
  if (!currentStation) {
    spTrigger.textContent = "SELECT STATION";
    stationToggle.classList.remove("has-station");
    return;
  }
  spTrigger.textContent = currentStation.name.toUpperCase();
  stationToggle.classList.add("has-station");
}

function updateActiveItems() {
  spList.querySelectorAll(".station-row").forEach(function(button) {
    var active = button.dataset.url === currentUrl;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

stationToggle.addEventListener("click", function() {
  setDirectoryOpen(stationBay.hidden);
});

stationClose.addEventListener("click", function() {
  setDirectoryOpen(false);
  stationToggle.focus();
});

stationSearch.addEventListener("input", renderStationList);

document.querySelectorAll(".station-filter").forEach(function(button) {
  button.addEventListener("click", function() {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".station-filter").forEach(function(filter) {
      filter.classList.toggle("active", filter === button);
    });
    renderStationList();
  });
});

document.addEventListener("keydown", function(event) {
  if (event.key === "Escape" && !stationBay.hidden) {
    setDirectoryOpen(false);
    stationToggle.focus();
  }
});

document.addEventListener("click", function(event) {
  if (!stationBay.hidden && !event.target.closest(".radio-cabinet")) setDirectoryOpen(false);
});

/* ── Playback ── */
function rememberStation(station) {
  try {
    localStorage.setItem("radio-station", JSON.stringify({
      name: station.name,
      url: station.url,
      tags: station.tags,
      source: station.source,
      category: station.category,
      isAu: station.isAu,
    }));
  } catch (_) {}
}

function play(station) {
  if (currentUrl === station.url && !audio.paused) return;
  currentStation = station;
  currentUrl = station.url;
  audio.src = station.url;
  audio.play().catch(showAudioError);
  startScroll(station.name);
  lcdStatus.textContent = "CONNECTING";
  setPlayButton(true);
  animateNeedle(station);
  syncStationDisplay();
  updateActiveItems();
  updatePresetHighlights();
  rememberStation(station);
}

playPauseBtn.addEventListener("click", function() {
  if (!currentUrl) {
    setDirectoryOpen(true);
    return;
  }
  if (audio.paused) {
    audio.play().catch(showAudioError);
    lcdStatus.textContent = "CONNECTING";
    setPlayButton(true);
  } else {
    audio.pause();
    lcdStatus.textContent = "PAUSED";
    setPlayButton(false);
    stopEq();
    stopSignalFlicker();
  }
});

volumeSlider.addEventListener("input", function() {
  audio.volume = parseFloat(volumeSlider.value);
});

audio.addEventListener("playing", function() {
  lcdStatus.textContent = "PLAYING";
  setPlayButton(true);
  startEq();
  startSignalFlicker();
});

audio.addEventListener("waiting", function() {
  if (currentUrl) lcdStatus.textContent = "BUFFERING";
});

audio.addEventListener("error", showAudioError);

/* ── Preset buttons ── */
function updatePresetHighlights() {
  document.querySelectorAll(".preset-btn").forEach(function(button) {
    button.classList.toggle("active", button.dataset.url === currentUrl);
  });
}

function renderPresets() {
  var list = document.getElementById("favourites-list");
  CURATED_STATIONS.filter(function(station) { return station.preset; }).forEach(function(station, index) {
    var button = document.createElement("button");
    button.className = "preset-btn";
    button.type = "button";
    button.dataset.url = station.url;
    button.textContent = (index + 1) + " · " + station.name.slice(0, 10);
    button.addEventListener("click", function() { play(station); });
    list.appendChild(button);
  });
}

/* ── Live Australian directory ── */
async function loadStations() {
  try {
    var response = await fetch(API);
    if (!response.ok) throw new Error("Directory returned " + response.status);
    var stations = await response.json();
    var seenUrls = new Set(CURATED_STATIONS.map(function(station) { return normaliseKey(station.url); }));
    var seenNames = new Set(CURATED_STATIONS.map(function(station) { return normaliseKey(station.name); }));

    directoryStations = stations.reduce(function(result, station) {
      var url = station.url_resolved || station.url || "";
      var name = String(station.name || "").trim();
      var urlKey = normaliseKey(url);
      var nameKey = normaliseKey(name);
      if (!name || !/^https:\/\//i.test(url) || /\.m3u8(\?|$)/i.test(url)) return result;
      if (seenUrls.has(urlKey) || seenNames.has(nameKey)) return result;
      seenUrls.add(urlKey);
      seenNames.add(nameKey);

      var tags = String(station.tags || "").split(",").filter(Boolean).slice(0, 3).join(" ");
      result.push({
        name: name,
        url: url,
        tags: tags,
        source: "AU LIVE",
        category: inferCategory(name, tags),
        isAu: true,
      });
      return result;
    }, []);

    directoryStatus.textContent = directoryStations.length + " AU CHANNELS LOADED";
    directoryStatus.className = "station-directory-status ready";
    renderStationList();
  } catch (_) {
    directoryStatus.textContent = "AU DIRECTORY OFFLINE / CURATED CHANNELS READY";
    directoryStatus.className = "station-directory-status error";
  }
}

function restoreStation() {
  try {
    var saved = JSON.parse(localStorage.getItem("radio-station"));
    if (!saved || !saved.url || !saved.name) return;
    currentStation = CURATED_STATIONS.find(function(station) { return station.url === saved.url; }) || saved;
    currentUrl = currentStation.url;
    startScroll(currentStation.name);
    lcdStatus.textContent = "READY";
    syncStationDisplay();
    animateNeedle(currentStation);
  } catch (_) {}
}

CURATED_STATIONS.forEach(function(station) {
  station.isAu = station.source === "AU";
});

renderPresets();
restoreStation();
renderStationList();
updatePresetHighlights();
loadStations();
