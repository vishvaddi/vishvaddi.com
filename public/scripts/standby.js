// Global standby overlay — available on every page via the nav button (next to
// dark mode) or Alt+S. Injects a full-screen clock + weather + Last.fm now-playing.
(function () {
  var WX_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 96: "Hail storm", 99: "Hail storm",
  };

  var ov = document.createElement("div");
  ov.id = "ambient";
  ov.innerHTML =
    '<div class="amb-clock" id="amb-clock">00:00:00</div>' +
    '<div class="amb-date" id="amb-date"></div>' +
    '<div class="amb-weather"><span id="wx-temp">—°C</span><span id="wx-feels">feels —°C</span><span id="wx-wind">— km/h</span><span id="wx-hum">—%</span></div>' +
    '<div class="amb-np" id="amb-np" style="display:none"><div class="eq" id="amb-eq"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div><div class="amb-np-text" id="amb-np-text"></div></div>' +
    '<input class="amb-lfm" id="amb-lfm" placeholder="Last.fm user (optional)" autocomplete="off" />' +
    '<div class="hint">click or press any key to exit</div>';
  document.body.appendChild(ov);

  var $ = function (id) { return document.getElementById(id); };
  var lfmInput = $("amb-lfm");
  var lfmUser = localStorage.getItem("lfm-user") || "";
  lfmInput.value = lfmUser;
  var clockTimer, weatherTimer, lfmTimer;

  function enter() {
    if (ov.classList.contains("active")) return;
    ov.classList.add("active");
    tickClock(); clockTimer = setInterval(tickClock, 1000);
    fetchWeather(); weatherTimer = setInterval(fetchWeather, 300000);
    if (lfmUser) { fetchNowPlaying(); lfmTimer = setInterval(fetchNowPlaying, 30000); }
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }
  function exit() {
    ov.classList.remove("active");
    clearInterval(clockTimer); clearInterval(weatherTimer); clearInterval(lfmTimer);
    if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(function () {});
  }

  ov.addEventListener("click", function (e) { if (e.target !== lfmInput) exit(); });
  lfmInput.addEventListener("click", function (e) { e.stopPropagation(); });
  lfmInput.addEventListener("change", function () {
    lfmUser = lfmInput.value.trim();
    localStorage.setItem("lfm-user", lfmUser);
    clearInterval(lfmTimer);
    if (lfmUser) { fetchNowPlaying(); lfmTimer = setInterval(fetchNowPlaying, 30000); }
    else hideNp();
  });

  var btn = $("standby-toggle");
  if (btn) btn.addEventListener("click", enter);

  document.addEventListener("keydown", function (e) {
    if (e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); enter(); return; }
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (ov.classList.contains("active")) exit();
  });

  function tickClock() {
    var n = new Date();
    var p = function (x) { return String(x).padStart(2, "0"); };
    $("amb-clock").textContent = p(n.getHours()) + ":" + p(n.getMinutes()) + ":" + p(n.getSeconds());
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    $("amb-date").textContent = days[n.getDay()] + " · " + n.getDate() + " " + months[n.getMonth()] + " " + n.getFullYear();
  }

  async function fetchWeather() {
    try {
      var url = "https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m";
      var c = (await (await fetch(url)).json()).current;
      $("wx-temp").textContent = Math.round(c.temperature_2m) + "°C · " + (WX_CODES[c.weathercode] || "");
      $("wx-feels").textContent = "feels " + Math.round(c.apparent_temperature) + "°C";
      $("wx-wind").textContent = Math.round(c.windspeed_10m) + " km/h";
      $("wx-hum").textContent = c.relativehumidity_2m + "%";
    } catch (e) {}
  }

  async function fetchNowPlaying() {
    if (!lfmUser) return;
    try {
      var url = "/api/lastfm?user=" + encodeURIComponent(lfmUser);
      var data = await (await fetch(url)).json();
      var tracks = data.recenttracks && data.recenttracks.track;
      if (!tracks || !tracks.length) { hideNp(); return; }
      var t = Array.isArray(tracks) ? tracks[0] : tracks;
      var playing = t["@attr"] && t["@attr"].nowplaying === "true";
      var artist = t.artist && (t.artist["#text"] || t.artist.name || "");
      if (!t.name) { hideNp(); return; }
      $("amb-np").style.display = "flex";
      $("amb-np-text").textContent = (playing ? "▶ " : "") + artist + (artist ? " — " : "") + t.name;
      $("amb-eq").classList.toggle("paused", !playing);
    } catch (e) { hideNp(); }
  }
  function hideNp() { $("amb-np").style.display = "none"; }
})();
