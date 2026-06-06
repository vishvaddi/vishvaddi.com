var FAVOURITES = [
  { name: "triple j", url: "https://live-radio01.mediahubaustralia.com/2TJW_aac/", tags: "indie alt" },
  { name: "ABC Classic", url: "https://live-radio01.mediahubaustralia.com/FMW_aac/", tags: "classical" },
  { name: "FBI Radio", url: "https://stream.fbiradio.com/fbi-hd.mp3", tags: "indie sydney" },
];

var API = "https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/AU?limit=50&order=votes&reverse=true&hidebroken=true";

var audio = document.getElementById("radio-audio");
var nowBar = document.getElementById("now-bar");
var nowFavicon = document.getElementById("now-favicon");
var nowName = document.getElementById("now-name");
var playPauseBtn = document.getElementById("play-pause-btn");
var volumeSlider = document.getElementById("volume-slider");
var eq = document.getElementById("eq");
var searchInput = document.getElementById("station-search");

var currentUrl = null;
var allStations = [];

audio.volume = parseFloat(volumeSlider.value);

function faviconUrl(stationUrl) {
  try {
    return new URL(stationUrl).origin + "/favicon.ico";
  } catch (_) {
    return "";
  }
}

function play(station) {
  if (currentUrl === station.url && !audio.paused) return;
  currentUrl = station.url;
  audio.src = station.url;
  audio.play().catch(function () {});

  nowBar.style.display = "block";
  nowName.textContent = station.name;
  nowFavicon.src = station.favicon || faviconUrl(station.url);
  nowFavicon.style.display = "inline";
  playPauseBtn.textContent = "⏸";
  setEqPlaying(true);

  document.querySelectorAll(".station-row").forEach(function (row) {
    row.classList.toggle("active", row.dataset.url === station.url);
  });
}

function setEqPlaying(playing) {
  if (playing) {
    eq.classList.add("playing");
    eq.querySelectorAll(".eq-bar").forEach(function (b) { b.style.animationDuration = ""; });
  } else {
    eq.classList.remove("playing");
    eq.querySelectorAll(".eq-bar").forEach(function (b) { b.style.animationDuration = "0s"; });
  }
}

playPauseBtn.addEventListener("click", function () {
  if (audio.paused) {
    audio.play().catch(function () {});
    playPauseBtn.textContent = "⏸";
    setEqPlaying(true);
  } else {
    audio.pause();
    playPauseBtn.textContent = "▶";
    setEqPlaying(false);
  }
});

volumeSlider.addEventListener("input", function () {
  audio.volume = parseFloat(volumeSlider.value);
});

function makeRow(station) {
  var btn = document.createElement("button");
  btn.className = "station-row";
  btn.dataset.url = station.url;
  btn.dataset.name = (station.name || "").toLowerCase();
  btn.dataset.tags = (station.tags || "").toLowerCase();

  var favicon = document.createElement("img");
  favicon.className = "station-favicon";
  favicon.src = station.favicon || faviconUrl(station.url);
  favicon.alt = "";
  favicon.onerror = function () { favicon.style.display = "none"; };

  var name = document.createElement("span");
  name.className = "station-name";
  name.textContent = station.name;

  var tags = document.createElement("span");
  tags.className = "station-tags";
  tags.textContent = station.tags || "";

  btn.append(favicon, name, tags);
  btn.addEventListener("click", function () { play(station); });
  return btn;
}

function renderFavourites() {
  var list = document.getElementById("favourites-list");
  FAVOURITES.forEach(function (s) { list.appendChild(makeRow(s)); });
}

async function loadStations() {
  var list = document.getElementById("stations-list");
  try {
    var res = await fetch(API);
    allStations = await res.json();
    list.innerHTML = "";
    allStations.forEach(function (s) {
      var station = {
        name: s.name,
        url: s.url_resolved || s.url,
        tags: s.tags ? s.tags.split(",").slice(0, 3).join(" ") : "",
        favicon: s.favicon,
      };
      list.appendChild(makeRow(station));
    });
  } catch (err) {
    list.innerHTML = '<p style="color: var(--muted); font-size: 0.875rem;">Could not load station list.</p>';
  }
}

searchInput.addEventListener("input", function () {
  var q = searchInput.value.toLowerCase().trim();
  document.querySelectorAll("#stations-list .station-row").forEach(function (row) {
    var match = !q || row.dataset.name.includes(q) || row.dataset.tags.includes(q);
    row.style.display = match ? "" : "none";
  });
});

renderFavourites();
loadStations();
