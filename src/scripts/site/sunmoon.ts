// Sun & Moon dashboard — astronomy computed entirely in the browser (no API).
// Algorithms reimplemented from Vladimir Agafonkin's SunCalc (BSD-2), the
// standard reference for sun position/times and moon phase/illumination/times.

const rad = Math.PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the ecliptic

const toJulian = (d: Date) => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (d: Date) => toJulian(d) - J2000;

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const azimuth = (H: number, phi: number, dec: number) =>
  Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H: number, phi: number, dec: number) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;

const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) => {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372;
  return M + C + P + Math.PI;
};
const sunCoords = (d: number) => {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
};

export function sunPosition(date: Date, lat: number, lng: number) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return { azimuth: azimuth(H, phi, c.dec) + Math.PI, altitude: altitude(H, phi, c.dec) };
}

const J0 = 0.0009;
const julianCycle = (d: number, lw: number) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, d: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

export function sunTimes(date: Date, lat: number, lng: number) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const both = (angle: number) => {
    const w = hourAngle(angle * rad, phi, dec);
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
    return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
  };
  const day = both(-0.833), civil = both(-6), gold = both(6);
  return {
    solarNoon: fromJulian(Jnoon),
    sunrise: day.rise, sunset: day.set,
    dawn: civil.rise, dusk: civil.set,
    goldenMorningEnd: gold.rise, goldenEveningStart: gold.set,
  };
}

const moonCoords = (d: number) => {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  const dt = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
};

export function moonPosition(date: Date, lat: number, lng: number) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h += rad * 0.017 / Math.tan(h + (rad * 10.26) / (h + rad * 5.1)); // refraction
  return { azimuth: azimuth(H, phi, c.dec) + Math.PI, altitude: h, distance: c.dist };
}

export function moonIllumination(date: Date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  };
}

const hoursLater = (date: Date, h: number) => new Date(date.valueOf() + (h * dayMs) / 24);

export function moonTimes(date: Date, lat: number, lng: number) {
  const t = new Date(date); t.setHours(0, 0, 0, 0);
  const hc = 0.133 * rad;
  let h0 = moonPosition(t, lat, lng).altitude - hc;
  let rise: number | undefined, set: number | undefined, ye = 0;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonPosition(hoursLater(t, i), lat, lng).altitude - hc;
    const h2 = moonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    ye = (a * xe + b) * xe + h1;
    const d = b * b - 4 * a * h1;
    let roots = 0, x1 = 0, x2 = 0;
    if (d >= 0) {
      const dx = (Math.sqrt(d) / (Math.abs(a) * 2)) || 0;
      x1 = xe - dx; x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) { if (h0 < 0) rise = i + x1; else set = i + x1; }
    else if (roots === 2) { rise = i + (ye < 0 ? x2 : x1); set = i + (ye < 0 ? x1 : x2); }
    if (rise !== undefined && set !== undefined) break;
    h0 = h2;
  }
  return {
    rise: rise !== undefined ? hoursLater(t, rise) : null,
    set: set !== undefined ? hoursLater(t, set) : null,
    alwaysUp: rise === undefined && set === undefined && ye > 0,
    alwaysDown: rise === undefined && set === undefined && ye <= 0,
  };
}

export function phaseName(phase: number): { name: string; emoji: string } {
  if (phase < 0.0625 || phase >= 0.9375) return { name: "New moon", emoji: "🌑" };
  if (phase < 0.1875) return { name: "Waxing crescent", emoji: "🌒" };
  if (phase < 0.3125) return { name: "First quarter", emoji: "🌓" };
  if (phase < 0.4375) return { name: "Waxing gibbous", emoji: "🌔" };
  if (phase < 0.5625) return { name: "Full moon", emoji: "🌕" };
  if (phase < 0.6875) return { name: "Waning gibbous", emoji: "🌖" };
  if (phase < 0.8125) return { name: "Last quarter", emoji: "🌗" };
  return { name: "Waning crescent", emoji: "🌘" };
}

const DEFAULT = { lat: -33.8688, lng: 151.2093, label: "Sydney" };
const fmtTime = (d: Date | null) =>
  d && !Number.isNaN(d.valueOf())
    ? new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(d)
    : "—";
const compass = (azRad: number) => {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((azRad / (2 * Math.PI)) * 8) % 8];
};

export function initSunMoon(): void {
  const root = document.getElementById("sunmoon");
  if (!root) return;
  const $ = (id: string) => document.getElementById(id);
  const dateInput = $("sm-date") as HTMLInputElement | null;
  const locBtn = $("sm-loc");
  const status = $("sm-status");
  const sunGrid = $("sm-sun");
  const moonGrid = $("sm-moon");
  if (!dateInput || !sunGrid || !moonGrid) return;

  let place = { ...DEFAULT };

  const cell = (grid: HTMLElement, value: string, label: string) => {
    const c = document.createElement("div");
    c.className = "sm-cell";
    const n = document.createElement("div"); n.className = "sm-n"; n.textContent = value;
    const l = document.createElement("div"); l.className = "sm-l"; l.textContent = label;
    c.append(n, l); grid.append(c);
  };

  const render = () => {
    const base = dateInput.value ? new Date(dateInput.value + "T12:00:00") : new Date();
    const st = sunTimes(base, place.lat, place.lng);
    const now = new Date();
    const sunNow = sunPosition(now, place.lat, place.lng);
    const dayLen = st.sunset.valueOf() - st.sunrise.valueOf();
    const hrs = Math.max(0, Math.floor(dayLen / 3600000));
    const mins = Math.max(0, Math.round((dayLen % 3600000) / 60000));

    sunGrid.textContent = "";
    cell(sunGrid, fmtTime(st.sunrise), "Sunrise");
    cell(sunGrid, fmtTime(st.sunset), "Sunset");
    cell(sunGrid, `${hrs}h ${mins}m`, "Day length");
    cell(sunGrid, fmtTime(st.solarNoon), "Solar noon");
    cell(sunGrid, fmtTime(st.dawn), "First light (dawn)");
    cell(sunGrid, fmtTime(st.dusk), "Last light (dusk)");
    cell(sunGrid, `${fmtTime(st.sunrise)}–${fmtTime(st.goldenMorningEnd)}`, "Morning golden hour");
    cell(sunGrid, `${fmtTime(st.goldenEveningStart)}–${fmtTime(st.sunset)}`, "Evening golden hour");
    cell(sunGrid, `${(sunNow.altitude / rad).toFixed(0)}° ${compass(sunNow.azimuth)}`, "Sun now (alt / dir)");

    const mt = moonTimes(base, place.lat, place.lng);
    const ill = moonIllumination(base);
    const ph = phaseName(ill.phase);
    const moonNow = moonPosition(now, place.lat, place.lng);
    moonGrid.textContent = "";
    cell(moonGrid, ph.emoji + " " + ph.name, "Phase");
    cell(moonGrid, (ill.fraction * 100).toFixed(0) + "%", "Illumination");
    cell(moonGrid, mt.alwaysUp ? "up all day" : mt.alwaysDown ? "below horizon" : fmtTime(mt.rise), "Moonrise");
    cell(moonGrid, mt.alwaysUp ? "—" : mt.alwaysDown ? "—" : fmtTime(mt.set), "Moonset");
    cell(moonGrid, `${(moonNow.altitude / rad).toFixed(0)}° ${compass(moonNow.azimuth)}`, "Moon now (alt / dir)");

    if (status) status.textContent = `${place.label} · ${new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(base)}`;
  };

  if (!dateInput.value) {
    const t = new Date();
    dateInput.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }
  dateInput.addEventListener("change", render);
  locBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) return;
    if (status) status.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (pos) => { place = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your location" }; render(); },
      () => { if (status) status.textContent = "Location denied — showing Sydney."; },
      { maximumAge: 600000, timeout: 10000 },
    );
  });
  render();
}
