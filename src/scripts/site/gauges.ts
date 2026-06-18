// Phone-as-a-tool gauges: spirit level + angle finder (DeviceOrientation) and a
// relative sound meter (getUserMedia). Everything is local; the mic stream is
// only analysed in the page and never recorded or sent anywhere.

export function initGauges(): void {
  const tabBar = document.getElementById("g-tabs");
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".g-panel"));
  if (!tabBar || !panels.length) return;

  // ── Tabs ──
  panels.forEach((panel, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "g-tab" + (i === 0 ? " active" : "");
    b.textContent = panel.dataset.tab || `Tab ${i + 1}`;
    b.addEventListener("click", () => {
      panels.forEach((p, j) => (p.hidden = j !== i));
      Array.from(tabBar.children).forEach((c, j) => c.classList.toggle("active", j === i));
    });
    tabBar.append(b);
  });

  // ── Shared tilt sensor (Level + Angle) ──
  const $ = (id: string) => document.getElementById(id);
  const bubble = $("g-bubble");
  const bull = $("g-bull");
  const xOut = $("g-x");
  const yOut = $("g-y");
  const angleOut = $("g-angle");
  let zeroBeta = 0, zeroGamma = 0;
  let orientOn = false;

  function onOrient(e: DeviceOrientationEvent): void {
    const beta = (e.beta || 0) - zeroBeta; // front-back
    const gamma = (e.gamma || 0) - zeroGamma; // left-right
    if (bubble && bull) {
      const max = 20; // degrees mapped to the dish radius
      const r = bull.clientWidth / 2 - 24;
      const dx = Math.max(-1, Math.min(1, gamma / max)) * r;
      const dy = Math.max(-1, Math.min(1, beta / max)) * r;
      bubble.style.transform = `translate(${dx}px, ${dy}px)`;
      bull.classList.toggle("level", Math.abs(gamma) < 0.4 && Math.abs(beta) < 0.4);
    }
    if (xOut) xOut.textContent = gamma.toFixed(1) + "°";
    if (yOut) yOut.textContent = beta.toFixed(1) + "°";
    // Angle finder: tilt of the phone from horizontal, 0–90°.
    if (angleOut) {
      const raw = e.beta || 0;
      angleOut.textContent = Math.min(90, Math.abs(raw)).toFixed(1) + "°";
    }
  }

  async function enableOrient(statusEl: HTMLElement | null): Promise<void> {
    const DOE = window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    }) | undefined;
    if (!DOE) {
      if (statusEl) statusEl.textContent = "This device/browser doesn't expose tilt sensors.";
      return;
    }
    if (typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          if (statusEl) statusEl.textContent = "Motion access denied — enable it in Settings → Safari → Motion & Orientation.";
          return;
        }
      } catch {
        if (statusEl) statusEl.textContent = "Couldn't request motion access.";
        return;
      }
    }
    if (!orientOn) {
      window.addEventListener("deviceorientation", onOrient);
      orientOn = true;
    }
    if (statusEl) statusEl.textContent = "Live — move the phone.";
  }

  $("g-orient-enable")?.addEventListener("click", () => enableOrient($("g-orient-status")));
  $("g-angle-enable")?.addEventListener("click", () => enableOrient($("g-angle-status")));
  $("g-zero")?.addEventListener("click", () => {
    // capture current absolute tilt as the new zero
    const handler = (e: DeviceOrientationEvent) => {
      zeroBeta = e.beta || 0;
      zeroGamma = e.gamma || 0;
      window.removeEventListener("deviceorientation", handler);
    };
    window.addEventListener("deviceorientation", handler);
  });
  $("g-zero-reset")?.addEventListener("click", () => { zeroBeta = 0; zeroGamma = 0; });

  // ── Sound meter ──
  let audioCtx: AudioContext | null = null;
  let rafId = 0;
  let peak = -Infinity;
  const dbOut = $("g-db");
  const barFill = $("g-bar");
  const peakOut = $("g-peak");

  async function enableSound(statusEl: HTMLElement | null): Promise<void> {
    if (audioCtx) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      if (statusEl) statusEl.textContent = "Microphone isn't available in this browser.";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      if (statusEl) statusEl.textContent = "Live — relative level.";
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        // Map RMS (~1e-4..1) to a friendly 0..100 relative dB scale.
        const db = 20 * Math.log10(rms || 1e-7); // ~ -140..0
        const rel = Math.max(0, Math.min(100, db + 100)); // shift to 0..100-ish
        if (dbOut) dbOut.textContent = rel.toFixed(0);
        if (barFill) barFill.style.width = rel + "%";
        if (rel > peak) { peak = rel; if (peakOut) peakOut.textContent = rel.toFixed(0); }
        rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      if (statusEl) statusEl.textContent = "Microphone permission was not granted.";
    }
  }

  $("g-sound-enable")?.addEventListener("click", () => enableSound($("g-sound-status")));
  $("g-peak-reset")?.addEventListener("click", () => { peak = -Infinity; if (peakOut) peakOut.textContent = "––"; });

  // Stop the mic loop when leaving the page.
  window.addEventListener("pagehide", () => {
    if (rafId) cancelAnimationFrame(rafId);
    audioCtx?.close().catch(() => undefined);
  });
}
