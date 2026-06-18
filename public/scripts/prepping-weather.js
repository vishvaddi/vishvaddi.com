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

  // Inline SVG keeps icons same-origin (CSP-safe) and theme-aware via currentColor.
  function iconGroup(code) {
    if (code === 0 || code === 1) return "sun";
    if (code === 2) return "partly";
    if (code === 45 || code === 48) return "fog";
    if (code >= 71 && code <= 77) return "snow";
    if (code === 85 || code === 86) return "snow";
    if (code >= 95) return "thunder";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 3) return "cloud";
    return "cloud";
  }

  var ICONS = {
    sun:
      '<circle cx="12" cy="12" r="4.2"/>' +
      '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/>',
    partly:
      '<circle cx="8" cy="8" r="3.2"/>' +
      '<path d="M8 1.8v1.6M1.8 8h1.6M3.8 3.8l1.1 1.1M12.2 3.8 11.1 4.9"/>' +
      '<path d="M9 19h8.5a3 3 0 0 0 .3-6 4.3 4.3 0 0 0-8.2-1.2A3.4 3.4 0 0 0 9 19Z"/>',
    cloud:
      '<path d="M7 18h9.5a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-1.3A3.7 3.7 0 0 0 7 18Z"/>',
    fog:
      '<path d="M7 14h9.5a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-1.3A3.7 3.7 0 0 0 7 14Z"/>' +
      '<path d="M4 18h16M6 21h12"/>',
    rain:
      '<path d="M7 14h9.5a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-1.3A3.7 3.7 0 0 0 7 14Z"/>' +
      '<path d="M8.5 17.5 7.5 20M12 17.5 11 20M15.5 17.5 14.5 20"/>',
    snow:
      '<path d="M7 13h9.5a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-1.3A3.7 3.7 0 0 0 7 13Z"/>' +
      '<path d="M8 17.5h.01M12 19h.01M16 17.5h.01M10 20h.01M14 20h.01"/>',
    thunder:
      '<path d="M7 13h9.5a3.3 3.3 0 0 0 .3-6.6 4.7 4.7 0 0 0-9-1.3A3.7 3.7 0 0 0 7 13Z"/>' +
      '<path d="m12 14-2 3.5h2.4L10.8 21"/>',
  };

  function iconSvg(code, cls) {
    var g = iconGroup(code);
    return (
      '<svg class="' + (cls || "wx-icon") + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (ICONS[g] || ICONS.cloud) +
      "</svg>"
    );
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
    var daily = data.daily || {};
    var code = current.weather_code;

    var hero = document.createElement("div");
    hero.className = "weather-hero";
    hero.innerHTML =
      '<span class="weather-hero-icon">' + iconSvg(code, "wx-icon wx-icon-lg") + "</span>" +
      '<div class="weather-hero-main">' +
        '<div class="weather-hero-temp">' + round(current.temperature_2m) + "&deg;</div>" +
        '<div class="weather-hero-cond">' + codeLabel(code) + "</div>" +
        '<div class="weather-hero-sub">' + label + " &middot; feels " +
          round(current.apparent_temperature) + "&deg;C</div>" +
      "</div>";
    target.appendChild(hero);

    var row = document.createElement("div");
    row.className = "weather-stat-row";
    [
      stat("Humidity", round(current.relative_humidity_2m) + "%"),
      stat("Wind", round(current.wind_speed_10m) + " km/h"),
      stat("Gusts", round(current.wind_gusts_10m) + " km/h"),
      stat("Cloud", round(current.cloud_cover) + "%"),
      stat("UV max", daily.uv_index_max ? round(daily.uv_index_max[0]) : "--"),
      stat("Rain", daily.precipitation_probability_max ? round(daily.precipitation_probability_max[0]) + "%" : "--"),
    ].forEach(function (el) { row.appendChild(el); });
    target.appendChild(row);
  }

  function renderDays(data) {
    var target = $("weather-days");
    if (!target || !data.daily || !Array.isArray(data.daily.time)) return;
    target.innerHTML = "";

    data.daily.time.forEach(function (value, i) {
      var date = new Date(value + "T00:00:00");
      var card = document.createElement("article");
      card.className = "weather-day";

      var code = data.daily.weather_code[i];

      var when = document.createElement("time");
      when.className = "weather-day-when";
      when.dateTime = value;
      when.textContent = i === 0 ? "Today" : dayFmt.format(date);
      card.appendChild(when);

      var icon = document.createElement("span");
      icon.className = "weather-day-icon";
      icon.innerHTML = iconSvg(code);
      card.appendChild(icon);

      var temp = document.createElement("span");
      temp.className = "weather-day-temp";
      temp.innerHTML =
        '<strong>' + round(data.daily.temperature_2m_max[i]) + "&deg;</strong> " +
        round(data.daily.temperature_2m_min[i]) + "&deg;";
      card.appendChild(temp);

      var condition = document.createElement("span");
      condition.className = "weather-day-cond";
      condition.textContent = codeLabel(code);
      card.appendChild(condition);

      var rain = document.createElement("span");
      rain.innerHTML = '<span class="wx-drop" aria-hidden="true"></span>' +
        round(data.daily.precipitation_probability_max[i]) + "% &middot; gust " +
        round(data.daily.wind_gusts_10m_max[i]);
      card.appendChild(rain);

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
