import { FIFTHS, fretMidi, musicalChord, musicalPattern, musicalState } from './combinator-model';
import type { MusicalNote, MusicalState } from './combinator-model';
import { NOTE_NAMES, SCALES, midiName, nameChord, pc, relativeKey, scaleById, scalePitchClasses, romanNumeral } from './theory';
import { EXERCISES, DEFAULT_SETTINGS } from './ear-core';

interface MusicalDeps {
  get: () => unknown;
  save: (state: MusicalState) => void;
  clock: () => number;
  tempo: () => number;
  play: (midi: number, when: number, seconds: number) => void;
  silence: () => void;
  insert?: (notes: MusicalNote[], beats: number) => string;
  macro?: (name: string, value: number) => void;
  macroValues?: () => number[];
}

export function buildCombinator(deps: MusicalDeps) {
  const root = document.createElement('section'); root.className = 'musical';
  const heading = document.createElement('h2'); heading.textContent = deps.insert ? 'Musical Combinator' : 'Explore & play';
  const intro = document.createElement('p'); intro.textContent = 'Choose a key, hold a chord pad to play, then build a progression. Each chord lasts one bar. Pattern settings control the arpeggiator.';
  const controls = document.createElement('div'); controls.className = 'musical-controls';
  const pads = document.createElement('div'); pads.className = 'musical-pads';
  const progression = document.createElement('div'); progression.className = 'musical-progress'; progression.setAttribute('aria-label', 'Progression');
  const actions = document.createElement('div'); actions.className = 'musical-actions';
  const status = document.createElement('p'); status.className = 'musical-status'; status.setAttribute('role', 'status');
  let state = musicalState(deps.get()), timer = 0, playing = false, origin = 0, cursor = 0, cycle = 0;
  let events: MusicalNote[] = [], loopBeats = 0;
  const fields = new Map<keyof MusicalState, HTMLSelectElement>();
  const button = (label: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; };
  const select = (host: HTMLElement, label: string, key: keyof MusicalState, options: Array<[string, string]>) => {
    const wrap = document.createElement('label'); wrap.append(label);
    const input = document.createElement('select'); input.setAttribute('aria-label', label); options.forEach(([v, l]) => input.add(new Option(l, v))); input.value = String(state[key]);
    input.addEventListener('change', () => {
      const value = typeof state[key] === 'number' ? Number(input.value) : typeof state[key] === 'boolean' ? input.value === 'true' : input.value;
      state = musicalState({ ...state, [key]: value }); commit();
    });
    fields.set(key, input); wrap.append(input); host.append(wrap);
  };
  select(controls, 'Key', 'root', NOTE_NAMES.map((n, i) => [String(i), n]));
  select(controls, 'Scale', 'scale', SCALES.map(s => [s.id, s.name]));
  select(controls, 'Register', 'octave', [2, 3, 4, 5].map(n => [String(n), `Octave ${n}`]));
  select(controls, 'Chord', 'size', [['3', 'Triad'], ['4', 'Seventh']]);
  select(controls, 'Inversion', 'inversion', [['0', 'Root'], ['1', 'First'], ['2', 'Second'], ['3', 'Third (sevenths)']]);
  select(controls, 'Voicing', 'voicing', [['close', 'Close'], ['open', 'Open'], ['drop2', 'Drop 2'], ['spread', 'Spread']]);
  const advanced = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Pattern & guitar settings';
  const advancedControls = document.createElement('div'); advancedControls.className = 'musical-controls';
  select(advancedControls, 'Arpeggiator', 'arp', [['off', 'Chords'], ['up', 'Up'], ['down', 'Down'], ['updown', 'Up / down']]);
  select(advancedControls, 'Rate', 'rate', [['1', 'Quarter notes'], ['0.5', 'Eighth notes'], ['0.25', 'Sixteenth notes']]);
  select(advancedControls, 'Octaves', 'octaves', ['1', '2', '3'].map(n => [n, n]));
  select(advancedControls, 'Swing', 'swing', [['0', 'Straight'], ['0.2', '20%'], ['0.4', '40%'], ['0.6', '60%']]);
  select(advancedControls, 'Gate', 'gate', [['0.25', 'Short'], ['0.5', 'Half'], ['0.8', '80%'], ['1', 'Full']]);
  select(advancedControls, 'Tuning', 'tuning', [['standard', 'Standard'], ['dropD', 'Drop D']]);
  select(advancedControls, 'Hand', 'left', [['false', 'Right handed'], ['true', 'Left handed']]);
  select(advancedControls, 'Labels', 'labels', [['notes', 'Note names'], ['degrees', 'Scale degrees']]);
  advanced.append(summary, advancedControls);
  const play = button('Loop progression', () => {
    if (playing) { stop(); return; }
    if (!state.degrees.length) { status.textContent = 'Add a chord first.'; return; }
    stop(); events = musicalPattern(state); loopBeats = state.degrees.length * 4; origin = deps.clock() + .06; cursor = 0; cycle = 0; playing = true;
    play.textContent = 'Stop loop'; play.setAttribute('aria-pressed', 'true'); schedule();
  });
  play.setAttribute('aria-pressed', 'false');
  function stop() { window.clearTimeout(timer); playing = false; deps.silence(); play.textContent = 'Loop progression'; play.setAttribute('aria-pressed', 'false'); }
  function schedule() {
    if (!playing || !events.length) return;
    const now = deps.clock(), beatSeconds = 60 / Math.max(40, Math.min(240, deps.tempo()));
    // A short horizon prevents queued notes surviving stop or a hidden tab.
    let when = origin + (cycle * loopBeats + events[cursor].beat) * beatSeconds;
    if (when < now - .2) { origin = now + .05; cycle = 0; cursor = 0; when = origin; }
    while (when < now + .12) {
      const note = events[cursor]; deps.play(note.midi, when, note.duration * beatSeconds);
      cursor++; if (cursor === events.length) { cursor = 0; cycle++; }
      when = origin + (cycle * loopBeats + events[cursor].beat) * beatSeconds;
    }
    timer = window.setTimeout(schedule, 25);
  }
  const insert = button('Add pattern to clip', () => { stop(); status.textContent = deps.insert?.(musicalPattern(state), state.degrees.length * 4) ?? ''; });
  insert.draggable = !!deps.insert;
  insert.addEventListener('dragstart', e => { e.dataTransfer?.setData('application/x-vishamp-pattern', JSON.stringify({ notes: musicalPattern(state), beats: state.degrees.length * 4 })); });
  actions.append(play, button('Sound off', stop), button('Clear progression', () => { state.degrees = []; commit(); }));
  actions.append(button('Reset setup', () => { state = musicalState(null); commit(); }));
  if (deps.insert) actions.append(insert);
  else {
    const studio = button('Open in Studio', () => { location.href = `/studio/#music=${encodeURIComponent(JSON.stringify(state))}`; });
    actions.append(studio);
  }
  actions.append(button('Copy setup link', async () => {
    const url = new URL(location.href); url.hash = `music=${encodeURIComponent(JSON.stringify(state))}`;
    try { await navigator.clipboard.writeText(url.href); status.textContent = 'Setup link copied.'; } catch { status.textContent = 'Clipboard unavailable. Use your browser to copy this address.'; history.replaceState(null, '', url); }
  }));
  const viewActions = document.createElement('div'); viewActions.className = 'musical-actions';
  const piano = document.createElement('div'); piano.className = 'musical-piano';
  const frets = document.createElement('div'); frets.className = 'musical-frets'; frets.hidden = true;
  for (const [label, node] of [['Piano', piano], ['Fretboard', frets]] as const) {
    const b = button(label, () => { piano.hidden = node !== piano; frets.hidden = node !== frets; Array.from(viewActions.children).forEach(c => c.setAttribute('aria-pressed', String(c === b))); });
    b.setAttribute('aria-pressed', String(node === piano)); viewActions.append(b);
  }
  viewActions.append(button('Play scale', () => {
    stop(); const start = deps.clock() + .05;
    [...scaleById(state.scale).steps, 12].forEach((n, i) => deps.play((state.octave + 1) * 12 + state.root + n, start + i * .25, .22));
  }));
  const circleDetails = document.createElement('details'), circleSummary = document.createElement('summary'); circleSummary.textContent = 'Circle of fifths';
  const circle = document.createElement('div'); circle.className = 'musical-circle';
  const keyInfo = document.createElement('p'); circleDetails.append(circleSummary, circle, keyInfo);
  const audition = (notes: number[]) => { stop(); const now = deps.clock(); notes.forEach(n => deps.play(n, now, .6)); };
  function paint() {
    fields.forEach((field, key) => { field.value = String(state[key]); });
    pads.replaceChildren(); progression.replaceChildren();
    scaleById(state.scale).steps.forEach((_, degree) => {
      const notes = musicalChord(state, degree), chord = nameChord(notes), label = `${romanNumeral(degree, chord.quality)} · ${chord.symbol}`;
      let held = false, pointerClick = false;
      const pad = button(`▶ ${label}`, () => { if (pointerClick) { pointerClick = false; return; } audition(notes); });
      const begin = () => { if (held) return; held = true; stop(); events = musicalPattern({ ...state, degrees: [degree] }); loopBeats = 4; origin = deps.clock() + .03; cursor = 0; cycle = 0; playing = true; pad.setAttribute('aria-pressed', 'true'); schedule(); };
      const end = () => { if (!held) return; held = false; stop(); pad.setAttribute('aria-pressed', 'false'); };
      pad.setAttribute('aria-pressed', 'false');
      pad.addEventListener('pointerdown', e => { if (e.button !== 0) return; pointerClick = true; pad.setPointerCapture(e.pointerId); begin(); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) pad.addEventListener(event, end);
      pad.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); begin(); } });
      pad.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); end(); } });
      pads.append(pad, button(`+ ${chord.symbol}`, () => { if (state.degrees.length < 16) { state.degrees.push(degree); commit(); } else status.textContent = 'Maximum 16 chords per pattern.'; }));
    });
    state.degrees.forEach((degree, i) => progression.append(button(`${i + 1}. ${nameChord(musicalChord(state, degree)).symbol} ×`, () => { state.degrees.splice(i, 1); commit(); })));
    if (!state.degrees.length) progression.textContent = 'Use + beside a chord to begin.';
    piano.replaceChildren(); frets.replaceChildren(); circle.replaceChildren();
    const pcs = scalePitchClasses(state.root, state.scale);
    const key = (midi: number) => {
      const degree = pcs.indexOf(pc(midi));
      const b = button(state.labels === 'degrees' ? (degree < 0 ? '·' : String(degree + 1)) : NOTE_NAMES[pc(midi)], () => audition([midi]));
      b.setAttribute('aria-label', `Play ${midiName(midi)}${degree === 0 ? ', root' : degree >= 0 ? `, degree ${degree + 1}` : ', outside scale'}`);
      b.classList.toggle('music-root', degree === 0); b.classList.toggle('music-out', degree < 0); return b;
    };
    for (let i = 0; i < 24; i++) { const b = key((state.octave + 1) * 12 + i); b.classList.toggle('music-black', [1, 3, 6, 8, 10].includes(i % 12)); piano.append(b); }
    const table = document.createElement('table'); const caption = document.createElement('caption'); caption.textContent = `${state.tuning === 'dropD' ? 'Drop D' : 'Standard tuning'} · roots outlined · scroll for all 12 frets`; table.append(caption);
    const positions = Array.from({ length: 13 }, (_, i) => i); if (state.left) positions.reverse();
    const head = document.createElement('tr'); const blank = document.createElement('th'); blank.textContent = 'String'; head.append(blank);
    positions.forEach(f => { const th = document.createElement('th'); th.textContent = f === 0 ? 'Open' : String(f); head.append(th); }); table.append(head);
    for (let string = 5; string >= 0; string--) {
      const row = document.createElement('tr'), th = document.createElement('th'); th.textContent = midiName(fretMidi(string, 0, state.tuning)); row.append(th);
      positions.forEach(f => { const td = document.createElement('td'); td.append(key(fretMidi(string, f, state.tuning))); row.append(td); }); table.append(row);
    }
    frets.append(table);
    FIFTHS.forEach((pitch, i) => {
      const b = button(NOTE_NAMES[pitch], () => { state.root = pitch; state.scale = 'major'; commit(); });
      const angle = i * Math.PI / 6 - Math.PI / 2; b.style.left = `${140 + Math.cos(angle) * 112}px`; b.style.top = `${140 + Math.sin(angle) * 112}px`;
      b.setAttribute('aria-label', `${NOTE_NAMES[pitch]} major`); b.setAttribute('aria-pressed', String(state.root === pitch && state.scale === 'major')); circle.append(b);
    });
    const mode = state.scale === 'major' || state.scale === 'minor' ? state.scale : null;
    keyInfo.textContent = `${NOTE_NAMES[state.root]} ${scaleById(state.scale).name} · ${pcs.map(n => NOTE_NAMES[n]).join(' ')}.`;
    if (mode) { const relative = relativeKey(state.root, mode); keyInfo.append(button(`Relative: ${NOTE_NAMES[relative.root]} ${relative.mode}`, () => { state.root = relative.root; state.scale = relative.mode; commit(); })); }
  }
  function commit() { stop(); state = musicalState(state); deps.save(state); paint(); }
  const macros = document.createElement('details'), macroSummary = document.createElement('summary'); macroSummary.textContent = 'Performance macros';
  const macroControls = document.createElement('div'); macroControls.className = 'musical-macros';
  if (deps.macro) {
    for (const name of ['Movement', 'Space', 'Brightness', 'Width']) {
      const label = document.createElement('label'); label.append(name);
      const input = document.createElement('input'); input.setAttribute('aria-label', name); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.01'; input.value = '0';
      input.value = String(deps.macroValues?.()[['Movement', 'Space', 'Brightness', 'Width'].indexOf(name)] ?? 0);
      input.addEventListener('input', () => { stop(); deps.macro!(name, Number(input.value)); state = musicalState(deps.get()); paint(); }); label.append(input); macroControls.append(label);
    }
    const hint = document.createElement('p'); hint.textContent = 'Movement: pattern rate, swing & LFO speed. Space: whole-mix reverb & delay. Brightness: synth cutoff & envelope. Width: synth unison & detune.';
    macros.append(macroSummary, hint, macroControls);
  }
  const practice = document.createElement('details'); practice.className = 'musical-practice';
  const practiceSummary = document.createElement('summary'); practiceSummary.textContent = 'Practice · hear this instrument';
  const questionText = document.createElement('p'), answers = document.createElement('div'); answers.className = 'musical-actions';
  let question = EXERCISES.find(e => e.id === 'intervalEar')!.make(DEFAULT_SETTINGS, 'ear', Math.random), practiceAnswered = false;
  const hear = () => { stop(); const now = deps.clock(); question.notes.forEach((n, i) => deps.play(n, now + i * .65, .55)); };
  const nextQuestion = () => {
    question = EXERCISES.find(e => e.id === 'intervalEar')!.make(DEFAULT_SETTINGS, 'ear', Math.random); practiceAnswered = false;
    questionText.textContent = question.prompt; answers.replaceChildren();
    question.choices.forEach(c => answers.append(button(c, () => { if (practiceAnswered) return; practiceAnswered = true; questionText.textContent = `${c === question.answer ? 'Correct.' : `Answer: ${question.answer}.`} ${question.explain}`; })));
    hear();
  };
  practice.append(practiceSummary, button('New interval', nextQuestion), button('Replay interval', hear), questionText, answers);
  const more = document.createElement('a'); more.href = '/audio/ear/'; more.textContent = 'All exercises & five-minute practice'; practice.append(more);
  root.append(heading, intro, controls, pads, progression, actions, status, advanced, viewActions, piano, frets, circleDetails);
  if (deps.macro) root.append(macros);
  root.append(practice);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  const shared = new URLSearchParams(location.hash.slice(1)).get('music');
  if (shared && shared.length < 8000) { try { state = musicalState(JSON.parse(shared)); deps.save(state); } catch { status.textContent = 'Invalid setup link; using saved settings.'; } }
  paint();
  return { root, stop, refresh: () => { stop(); state = musicalState(deps.get()); macroControls.querySelectorAll('input').forEach((input, i) => { input.value = String(deps.macroValues?.()[i] ?? 0); }); paint(); }, set: (value: unknown) => { state = musicalState(value); commit(); } };
}
