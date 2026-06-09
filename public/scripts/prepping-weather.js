(function () {
  var DEFAULT_PLACE = { lat: -33.8688, lon: 151.2093, label: "Sydney" };
  var weatherCodes = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm + hail",
    99: "Thunderstorm + hail",
  };

  var dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short" });
  var dateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });
  var timeFmt = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" });

  function $(id) {
    return document.getElementById(id);
  }

  function round(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "--";
    return Math.round(Number(value));
  }

  function codeLabel(code) {
    return weatherCodes[code] || "Forecast";
  }

  function setStatus(value) {
    var el = $("weather-status");
    if (el) el.textContent = value;
  }

  function stat(label, value) {
    var el = document.createElement("div");
    el.className = "weather-stat";

    var n = document.createElement("div");
    n.className = "n";
    n.textContent = value;
    el.appendChild(n);

    var l = document.createElement("div");
    l.className = "l";
    l.textContent = label;
    el.appendChild(l);

    return el;
  }

  function updateWindy(lat, lon) {
    var frame = $("weather-windy");
    if (!frame) return;
    var params = new URLSearchParams({
      lat: lat.toFixed(2),
      lon: lon.toFixed(2),
      zoom: "7",
      level: "surface",
      overlay: "wind",
      product: "ecmwf",
      menu: "",
      message: "true",
      marker: "",
      calendar: "now",
      pressure: "",
      type: "map",
      location: "coordinates",
      detail: "",
      metricWind: "km/h",
      metricTemp: "degC",
      radarRange: "-1",
    });
    frame.src = "https://embed.windy.com/embed2.html?" + params.toString();
  }

  function forecastUrl(lat, lon) {
    var params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "precipitation",
        "weather_code",
        "cloud_cover",
        "wind_speed_10m",
        "wind_gusts_10m",
      ].join(","),
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
        "uv_index_max",
        "sunrise",
        "sunset",
        "wind_gusts_10m_max",
      ].join(","),
      timezone: "auto",
      forecast_days: "7",
      wind_speed_unit: "kmh",
    });
    return "https://api.open-meteo.com/v1/forecast?" + params.toString();
  }

  async function fetchForecast(lat, lon) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    try {
      var res = await fetch(forecastUrl(lat, lon), { signal: ctrl.signal });
      if (!res.ok) throw new Error("Forecast HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function renderCurrent(data, label) {
    var target = $("weather-current");
    if (!target) return;
    target.innerHTML = "";

    var current = data.current || {};
    target.appendChild(stat("Place", label));
    target.appendChild(stat("Now", round(current.temperature_2m) + " degC"));
    target.appendChild(stat("Feels like", round(current.apparent_temperature) + " degC"));
    target.appendChild(stat("Condition", codeLabel(current.weather_code)));
    target.appendChild(stat("Humidity", round(current.relative_humidity_2m) + "%"));
    target.appendChild(stat("Wind", round(current.wind_speed_10m) + " km/h"));
    target.appendChild(stat("Gusts", round(current.wind_gusts_10m) + " km/h"));
    target.appendChild(stat("Cloud", round(current.cloud_cover) + "%"));
  }

  function renderDays(data) {
    var target = $("weather-days");
    if (!target || !data.daily || !Array.isArray(data.daily.time)) return;
    target.innerHTML = "";

    data.daily.time.forEach(function (value, i) {
      var date = new Date(value + "T00:00:00");
      var card = document.createElement("article");
      card.className = "weather-day";

      var when = document.createElement("time");
      when.dateTime = value;
      when.textContent = dayFmt.format(date) + " " + dateFmt.format(date);
      card.appendChild(when);

      var condition = document.createElement("strong");
      condition.textContent = codeLabel(data.daily.weather_code[i]);
      card.appendChild(condition);

      var temp = document.createElement("span");
      temp.textContent = round(data.daily.temperature_2m_min[i]) + "-" + round(data.daily.temperature_2m_max[i]) + " degC";
      card.appendChild(temp);

      var rain = document.createElement("span");
      rain.textContent = "Rain " + round(data.daily.precipitation_probability_max[i]) + "%";
      card.appendChild(rain);

      var wind = document.createElement("span");
      wind.textContent = "Gust " + round(data.daily.wind_gusts_10m_max[i]) + " km/h";
      card.appendChild(wind);

      var sun = document.createElement("span");
      sun.textContent = "Sun " + timeFmt.format(new Date(data.daily.sunrise[i])) + " - " + timeFmt.format(new Date(data.daily.sunset[i]));
      card.appendChild(sun);

      target.appendChild(card);
    });
  }

  async function load(place) {
    setStatus("Loading forecast for " + place.label + "...");
    try {
      var data = await fetchForecast(place.lat, place.lon);
      renderCurrent(data, place.label);
      renderDays(data);
      updateWindy(place.lat, place.lon);
      setStatus("Forecast from Open-Meteo for " + place.label + ". Official warnings are linked below.");
    } catch (err) {
      setStatus("Weather failed to load. Check BOM warnings directly below.");
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not available in this browser. Showing Sydney forecast.");
      return;
    }
    setStatus("Waiting for location permission...");
    navigator.geolocation.getCurrentPosition(function (pos) {
      load({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: "Your location",
      });
    }, function () {
      setStatus("Location permission was not granted. Showing Sydney forecast.");
      load(DEFAULT_PLACE);
    }, {
      enableHighAccuracy: false,
      maximumAge: 10 * 60 * 1000,
      timeout: 12000,
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var button = $("weather-location");
    if (button) button.addEventListener("click", requestLocation);
    load(DEFAULT_PLACE);
  });
})();
