var LFM_KEY = "b25b959554ed76058ac220b7b2e0a026";
var ambient = document.getElementById("ambient");
var lfmInput = document.getElementById("lfm-input");
var lfmUsername = "";

var clockTimer = null;
var weatherTimer = null;
var lfmTimer = null;

var WX_CODES = {
  0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
  45:"Foggy",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
  61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",
  80:"Showers",81:"Showers",82:"Heavy showers",
  95:"Thunderstorm",96:"Hail storm",99:"Hail storm"
};

function enter() {
  lfmUsername = (lfmInput.value || "").trim();
  document.getElementById("entry").style.display = "none";
  ambient.classList.add("active");

  tickClock();
  clockTimer = setInterval(tickClock, 1000);

  fetchWeather();
  weatherTimer = setInterval(fetchWeather, 5 * 60 * 1000);

  if (lfmUsername) {
    fetchNowPlaying();
    lfmTimer = setInterval(fetchNowPlaying, 30 * 1000);
  }

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {});
  }
}

function exit() {
  ambient.classList.remove("active");
  document.getElementById("entry").style.display = "flex";

  clearInterval(clockTimer);
  clearInterval(weatherTimer);
  clearInterval(lfmTimer);

  if (document.exitFullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(function () {});
  }
}

document.getElementById("enter-btn").addEventListener("click", enter);
ambient.addEventListener("click", exit);
document.addEventListener("keydown", function (e) {
  var tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (ambient.classList.contains("active")) exit();
});

if (new URLSearchParams(location.search).get("auto") === "1") {
  enter();
}

function tickClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, "0");
  var m = String(now.getMinutes()).padStart(2, "0");
  var s = String(now.getSeconds()).padStart(2, "0");
  document.getElementById("amb-clock").textContent = h + ":" + m + ":" + s;

  var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  document.getElementById("amb-date").textContent =
    days[now.getDay()] + " · " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear();
}

async function fetchWeather() {
  try {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093" +
      "&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m";
    var r = await fetch(url);
    var data = await r.json();
    var c = data.current;
    var code = c.weathercode;
    var desc = WX_CODES[code] || ("Code " + code);
    document.getElementById("wx-temp").textContent = Math.round(c.temperature_2m) + "°C · " + desc;
    document.getElementById("wx-feels").textContent = "feels " + Math.round(c.apparent_temperature) + "°C";
    document.getElementById("wx-wind").textContent = Math.round(c.windspeed_10m) + " km/h";
    document.getElementById("wx-hum").textContent = c.relativehumidity_2m + "%";
  } catch (e) {}
}

async function fetchNowPlaying() {
  if (!lfmUsername) return;
  try {
    var url = "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=" +
      encodeURIComponent(lfmUsername) + "&api_key=" + LFM_KEY + "&format=json&limit=1";
    var r = await fetch(url);
    var data = await r.json();
    var tracks = data.recenttracks && data.recenttracks.track;
    if (!tracks || !tracks.length) { hideNp(); return; }
    var track = Array.isArray(tracks) ? tracks[0] : tracks;
    var nowPlaying = track["@attr"] && track["@attr"].nowplaying === "true";
    var artist = track.artist && (track.artist["#text"] || track.artist.name || "");
    var name = track.name || "";
    if (!name) { hideNp(); return; }
    var np = document.getElementById("amb-np");
    var npText = document.getElementById("amb-np-text");
    var eq = document.getElementById("amb-eq");
    np.style.display = "flex";
    npText.textContent = (nowPlaying ? "▶ " : "") + artist + (artist ? " — " : "") + name;
    eq.classList.toggle("paused", !nowPlaying);
  } catch (e) {
    hideNp();
  }
}

function hideNp() {
  document.getElementById("amb-np").style.display = "none";
}
