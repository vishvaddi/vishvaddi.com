// Monophonic pitch detection for the tuner: normalised autocorrelation
// (McLeod-style NSDF) with parabolic peak refinement. Pure, no DOM.

export interface Pitch { hz: number; clarity: number }

/** Returns the fundamental in Hz and a 0–1 clarity, or null when the frame is silence/noise. */
export function detectPitch(frame: Float32Array, sampleRate: number, minHz = 40, maxHz = 2000): Pitch | null {
  const n = frame.length;
  let rms = 0; for (let i = 0; i < n; i++) rms += frame[i] * frame[i]; rms = Math.sqrt(rms / n);
  if (rms < 0.005) return null;
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz)), minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - lag; i++) { acf += frame[i] * frame[i + lag]; m += frame[i] * frame[i] + frame[i + lag] * frame[i + lag]; }
    nsdf[lag] = m ? (2 * acf) / m : 0;
  }
  // first positive-going zero crossing, then the highest peak after it; accept the
  // first peak within 80 % of the max so the octave below does not win
  let start = minLag; while (start < maxLag && nsdf[start] > 0) start++;
  while (start < maxLag && nsdf[start] <= 0) start++;
  let best = -1, bestVal = 0;
  const peaks: number[] = [];
  for (let lag = start + 1; lag < maxLag; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > 0) { peaks.push(lag); if (nsdf[lag] > bestVal) { bestVal = nsdf[lag]; best = lag; } }
  }
  if (best < 0 || bestVal < 0.5) return null;
  const chosen = peaks.find((lag) => nsdf[lag] >= bestVal * 0.8) ?? best;
  const y0 = nsdf[chosen - 1], y1 = nsdf[chosen], y2 = nsdf[chosen + 1], denom = y0 - 2 * y1 + y2;
  const shift = denom ? 0.5 * (y0 - y2) / denom : 0;
  return { hz: sampleRate / (chosen + shift), clarity: Math.max(0, Math.min(1, nsdf[chosen])) };
}

export interface NoteReading { midi: number; name: string; octave: number; cents: number; targetHz: number }
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export function nearestNote(hz: number, referenceA = 440): NoteReading {
  const exact = 69 + 12 * Math.log2(hz / referenceA), midi = Math.round(exact);
  return { midi, name: NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (exact - midi) * 100, targetHz: referenceA * Math.pow(2, (midi - 69) / 12) };
}
