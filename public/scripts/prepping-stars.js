// Live Southern-Hemisphere star chart for the prepping page. Uses geolocation
// (falls back to Sydney) to plot the visible sky now, with constellation lines
// for Crux, the Centaurus pointers, Scorpius and Orion — the navigation stars.
(function () {
  var canvas = document.getElementById("sky-canvas");
  if (!canvas) return;

  // [raDeg, decDeg, mag, name, showLabel]
  var STARS = [
    [101.29, -16.72, -1.46, "Sirius", 1],
    [95.99, -52.70, -0.72, "Canopus", 1],
    [219.92, -60.83, -0.27, "α Cen", 1],
    [213.92, 19.18, -0.05, "Arcturus", 0],
    [78.63, -8.20, 0.12, "Rigel", 1],
    [88.79, 7.41, 0.50, "Betelgeuse", 1],
    [24.43, -57.24, 0.46, "Achernar", 1],
    [210.96, -60.37, 0.60, "β Cen", 0],
    [247.35, -26.43, 0.96, "Antares", 1],
    [201.30, -11.16, 0.97, "Spica", 1],
    [191.93, -59.69, 1.25, "Mimosa", 0],
    [186.65, -63.10, 1.40, "Acrux", 1],
    [187.79, -57.11, 1.63, "Gacrux", 0],
    [183.79, -58.75, 2.79, "δ Cru", 0],
    [263.40, -37.10, 1.62, "Shaula", 1],
    [241.36, -19.81, 2.50, "Graffias", 0],
    [253.08, -38.05, 2.29, "ε Sco", 0],
    [258.84, -43.00, 2.69, "μ Sco", 0],
    [81.57, 6.35, 1.64, "Bellatrix", 0],
    [83.82, -0.30, 1.69, "Alnilam", 0],
    [85.19, -1.94, 1.77, "Alnitak", 0],
    [86.94, -9.67, 2.07, "Saiph", 0],
    [114.83, 5.22, 0.38, "Procyon", 0],
    [116.33, 28.03, 1.14, "Pollux", 0],
    [152.09, 11.97, 1.35, "Regulus", 0],
    [344.41, -29.62, 1.16, "Fomalhaut", 1],
    [297.70, 8.87, 0.77, "Altair", 0],
    [279.23, 38.78, 0.03, "Vega", 0],
    [310.36, 45.28, 1.25, "Deneb", 0],
  ];
  var CONST_LINES = [
    [11, 12], [10, 13], [2, 7],
    [15, 8], [8, 16], [16, 17], [17, 14],
    [18, 19], [19, 20], [4, 19], [5, 18], [4, 21],
  ];
  var DEG = Math.PI / 180;
  var lat = -33.87, lon = 151.21, locKnown = false;

  function julianDate(d) { return d.getTime() / 86400000 + 2440587.5; }
  function gmstDeg(jd) { return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360 + 360) % 360; }

  function altAz(raDeg, decDeg, latDeg, lstDeg) {
    var ha = ((lstDeg - raDeg) % 360 + 360) % 360;
    if (ha > 180) ha -= 360;
    var haR = ha * DEG, decR = decDeg * DEG, latR = latDeg * DEG;
    var sinAlt = Math.max(-1, Math.min(1, Math.sin(decR) * Math.sin(latR) + Math.cos(decR) * Math.cos(latR) * Math.cos(haR)));
    var alt = Math.asin(sinAlt), cosAlt = Math.cos(alt);
    var cosAz = cosAlt > 0.001 ? (Math.sin(decR) - sinAlt * Math.sin(latR)) / (cosAlt * Math.cos(latR)) : 0;
    var az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(haR) > 0) az = 2 * Math.PI - az;
    return { alt: alt / DEG, az: az / DEG };
  }
  function skyXY(alt, az, W, H) {
    var r = Math.max(0, (90 - alt) / 90), azR = az * DEG;
    return { x: W / 2 + r * W * 0.44 * Math.sin(azR), y: H / 2 - r * H * 0.44 * Math.cos(azR) };
  }

  function draw() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    var ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    var now = new Date();
    var lst = (gmstDeg(julianDate(now)) + lon + 360) % 360;

    ctx.fillStyle = "#040710"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(50,70,120,0.25)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.44, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "rgba(80,110,170,0.45)"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    var rr = Math.min(W, H) * 0.46;
    ctx.fillText("N", W / 2, H / 2 - rr + 11); ctx.fillText("S", W / 2, H / 2 + rr - 1);
    ctx.fillText("E", W / 2 + rr - 5, H / 2 + 4); ctx.fillText("W", W / 2 - rr + 5, H / 2 + 4);

    var proj = STARS.map(function (s) {
      var aa = altAz(s[0], s[1], lat, lst), p = skyXY(aa.alt, aa.az, W, H);
      return { x: p.x, y: p.y, alt: aa.alt, star: s };
    });
    for (var l = 0; l < CONST_LINES.length; l++) {
      var a = proj[CONST_LINES[l][0]], b = proj[CONST_LINES[l][1]];
      if (a.alt < -2 || b.alt < -2) continue;
      ctx.strokeStyle = "rgba(70,110,210," + (Math.max(0, Math.min(a.alt, b.alt) / 60) * 0.5) + ")";
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (var i = 0; i < proj.length; i++) {
      var p = proj[i], s = p.star;
      if (p.alt < -3) continue;
      var bri = Math.min(1, (p.alt + 3) / 15), sz = Math.max(0.5, 3.2 - s[2] * 0.7);
      if (sz > 1.5) {
        var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 2);
        grad.addColorStop(0, "rgba(200,210,255," + (bri * 0.8) + ")");
        grad.addColorStop(1, "rgba(200,210,255,0)");
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, sz * 2, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.fillStyle = "rgba(210,220,255," + (0.3 + bri * 0.7) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, 2 * Math.PI); ctx.fill();
      if (s[4] && p.alt > 8) {
        ctx.fillStyle = "rgba(140,170,220," + (bri * 0.65) + ")";
        ctx.font = "8px monospace"; ctx.textAlign = "left";
        ctx.fillText(s[3], p.x + sz + 2, p.y + 3);
      }
    }
    ctx.fillStyle = "rgba(60,80,130,0.65)"; ctx.font = "8px monospace"; ctx.textAlign = "left";
    ctx.fillText((locKnown ? "📍 " : "🌐 ") + lat.toFixed(1) + "°, " + lon.toFixed(1) + "°", 8, H - 7);
    ctx.textAlign = "right";
    ctx.fillText("UTC " + String(now.getUTCHours()).padStart(2, "0") + ":" + String(now.getUTCMinutes()).padStart(2, "0"), W - 8, H - 7);
  }

  function start() { draw(); setInterval(draw, 60000); window.addEventListener("resize", draw); }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (pos) { lat = pos.coords.latitude; lon = pos.coords.longitude; locKnown = true; start(); },
      start, { timeout: 8000 }
    );
  } else { start(); }
})();
