import { download } from "./calc";

// Live speech-to-text annotation + optional audio capture. The transcript and
// audio stay on-device; note that the speech RECOGNITION (Web Speech API) is
// performed by the browser's speech service (e.g. Google in Chrome) — disclosed
// to the user on the page.
export function initVoice() {
  const ta = document.getElementById("transcript") as HTMLTextAreaElement | null;
  if (!ta) return;
  const interim = document.getElementById("interim");
  const status = document.getElementById("rec-status");
  const recBtn = document.getElementById("rec") as HTMLButtonElement | null;
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) document.getElementById("no-speech")?.removeAttribute("hidden");

  let rec: any = null;
  let listening = false;
  let mediaRec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;

  const append = (text: string) => {
    if (!text) return;
    const sep = ta.value && !/[\s]$/.test(ta.value) ? " " : "";
    ta.value += sep + text;
    ta.scrollTop = ta.scrollHeight;
  };

  function startSpeech() {
    if (!SR) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-AU";
    rec.onresult = (e: any) => {
      let intr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) append(r[0].transcript.trim());
        else intr += r[0].transcript;
      }
      if (interim) interim.textContent = intr;
    };
    rec.onerror = (e: any) => {
      const messages: Record<string, string> = {
        "not-allowed": "Microphone blocked — allow mic access (padlock icon in the address bar), then press Record again.",
        "service-not-allowed": "Speech service blocked by the browser.",
        "no-speech": "No speech detected — keep talking.",
        "audio-capture": "No microphone found.",
        "network": "Speech service unreachable — live transcription needs an internet connection.",
      };
      if (status) status.textContent = messages[e.error] || ("Speech error: " + e.error);
      // Fatal errors shouldn't silently restart in a loop.
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        listening = false;
        if (recBtn) recBtn.textContent = "Record";
      }
    };
    rec.onstart = () => { if (status) status.textContent = "Listening…"; };
    rec.onend = () => { if (listening) { try { rec.start(); } catch { /* restart race — ignore */ } } };
    try {
      rec.start();
    } catch (err: any) {
      if (status) status.textContent = "Couldn't start transcription: " + (err?.message || err);
    }
  }

  async function start() {
    listening = true;
    if (recBtn) recBtn.innerHTML = '<span class="rec-dot"></span>Stop';
    if (status) status.textContent = "Listening…";
    startSpeech();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRec.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRec?.mimeType || "audio/webm" });
        const dl = document.getElementById("dl-audio") as HTMLButtonElement | null;
        if (dl) {
          dl.hidden = false;
          dl.onclick = () => download(`voice-${new Date().toISOString().slice(0, 10)}.webm`, URL.createObjectURL(blob));
        }
        stream?.getTracks().forEach((t) => t.stop());
      };
      mediaRec.start();
    } catch { /* audio optional — transcription still works */ }
  }

  function stop() {
    listening = false;
    if (recBtn) recBtn.textContent = "Record";
    if (status) status.textContent = "";
    if (interim) interim.textContent = "";
    try { rec && rec.stop(); } catch { /* */ }
    try { if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop(); } catch { /* */ }
  }

  recBtn?.addEventListener("click", () => (listening ? stop() : start()));
  document.getElementById("stamp")?.addEventListener("click", () => {
    append((ta.value && !ta.value.endsWith("\n") ? "\n" : "") + `[${new Date().toLocaleTimeString("en-AU")}] `);
    ta.focus();
  });
  document.getElementById("clear")?.addEventListener("click", () => { if (confirm("Clear the transcript?")) ta.value = ""; });
  document.getElementById("txt")?.addEventListener("click", () =>
    download(`voice-notes-${new Date().toISOString().slice(0, 10)}.txt`, URL.createObjectURL(new Blob([ta.value], { type: "text/plain" }))));
  document.getElementById("email")?.addEventListener("click", () => {
    location.href = `mailto:?subject=${encodeURIComponent("Voice notes")}&body=${encodeURIComponent(ta.value)}`;
  });
  document.getElementById("copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ta.value); } catch { /* */ }
  });
}
