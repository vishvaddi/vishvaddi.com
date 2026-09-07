(function () {
  var audio = document.getElementById("mini-audio");
  var play = document.getElementById("mini-play");
  var volume = document.getElementById("mini-volume");
  var status = document.getElementById("mini-status");
  var title = document.getElementById("mini-station");
  var station = null;
  try { station = JSON.parse(localStorage.getItem("radio-station") || "null"); } catch (_) {}
  if (!station || !station.url) { play.disabled = true; return; }
  title.textContent = station.name;
  status.textContent = "Ready to play in the background.";
  audio.src = station.url;
  audio.volume = Number(volume.value);

  function updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: station.name, artist: "Live radio", album: "vishvaddi.com" });
    navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
    navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
  }
  function start() {
    audio.play().then(function () {
      play.textContent = "Pause";
      status.textContent = "Playing — keep this window or tab open.";
      updateMediaSession();
      if ("BroadcastChannel" in window) new BroadcastChannel("vv-radio-player").postMessage({ type: "mini-playing" });
    }).catch(function () { status.textContent = "Playback was blocked. Tap Play again."; });
  }
  play.addEventListener("click", function () { if (audio.paused) start(); else audio.pause(); });
  audio.addEventListener("pause", function () { play.textContent = "Play"; status.textContent = "Paused"; });
  audio.addEventListener("error", function () { status.textContent = "This station stream is unavailable."; });
  volume.addEventListener("input", function () { audio.volume = Number(volume.value); });
  updateMediaSession();
  start();
})();
