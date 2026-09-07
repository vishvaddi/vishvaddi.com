// Catalogue for the /audio hub and its rail. Same shape as site-tools.ts so the
// Base.astro rail and the hub cards render either catalogue unchanged.
export const AUDIO_TOOL_CATEGORIES = [
  'Analyse',
  'Prepare & convert',
  'Compose',
  'Learn',
] as const

export type AudioToolCategory = typeof AUDIO_TOOL_CATEGORIES[number]

export interface AudioTool {
  href: string
  title: string
  shortTitle: string
  icon: string
  description: string
  problem: string
  promise: string
  privacy: string
  category: AudioToolCategory
  aliases: string
  quick?: boolean
}

const RAW_AUDIO_TOOLS: Omit<AudioTool, 'problem' | 'promise' | 'privacy'>[] = [
  { href: '/audio/chords', title: 'Chord & Scale Lab', shortTitle: 'Chord lab', icon: '🎹', description: 'Diatonic chords for any key and scale, Roman numerals, Camelot, progression presets, loop playback and MIDI export.', category: 'Compose', aliases: 'chords scale key progression roman numeral camelot midi diatonic inversion voicing scaler', quick: true },
  { href: '/audio/prep', title: 'Sample Prep', shortTitle: 'Sample prep', icon: '✂️', description: 'Batch trim, normalise, fade, reverse, pitch, stretch to BPM, centre-channel vocal remover, mono, resample, WAV/MP3.', category: 'Prepare & convert', aliases: 'trim normalise normalize lufs fade reverse pitch stretch bpm vocal remover karaoke instrumental mono convert resample wav mp3 batch', quick: true },
  { href: '/audio/bpm', title: 'BPM Maths', shortTitle: 'BPM maths', icon: '⏱️', description: 'Note values in ms and Hz, reverb times, bars to seconds and samples, Hz to note and MIDI, tap tempo.', category: 'Prepare & convert', aliases: 'delay time ms lfo hz reverb predelay decay bars seconds samples tap tempo hz note midi cents', quick: true },
  { href: '/audio/metronome', title: 'Tuner & Metronome', shortTitle: 'Tuner', icon: '🎚️', description: 'Chromatic mic tuner with cents and a reference tone; metronome with accents, subdivisions and polyrhythms.', category: 'Learn', aliases: 'tuner pitch cents metronome click polyrhythm subdivision practice tap tempo' },
  { href: '/audio/lofi', title: 'Lo-fi Processor', shortTitle: 'Lo-fi', icon: '📼', description: 'Sixteen one-knob retro transforms: VHS, tape, vinyl, radio, telephone, 8-bit, old film, lo-fi hip hop and more, with dry/wet.', category: 'Prepare & convert', aliases: 'lofi lo-fi vhs tape cassette vinyl radio telephone walkie megaphone underwater bitcrush 8-bit crush film drift reverse audiomatic retro' },
  { href: '/audio/ear', title: 'Ear Training', shortTitle: 'Ear training', icon: '👂', description: 'Note, interval and chord ID on staff, keyboard and fretboard; interval ear, EQ band ear and rhythm dictation, with streaks and shareable drills.', category: 'Learn', aliases: 'ear training musictheory interval chord note identification staff keyboard fretboard eq band rhythm dictation practice quiz' },
  { href: '/audio/analyser', title: 'Track Analyser', shortTitle: 'Analyser', icon: '📊', description: 'BPM, key and Camelot, LUFS, true peak, loudness range, stereo width and streaming targets.', category: 'Analyse', aliases: 'bpm key camelot lufs loudness true peak lra spectrum mastering spotify apple youtube club', quick: true },
]

const POSITIONING: Record<string, [problem: string, promise: string]> = {
  '/audio/chords': ['Which chords belong in this key is a lookup you keep re-doing mid-session.', 'Hear every diatonic chord, build and loop a progression, export it as MIDI.'],
  '/audio/prep': ['Every sample needs the same five fixes before it is usable, and a DAW makes you do them one at a time.', 'Set the recipe once and run every file through it, then download WAV or MP3.'],
  '/audio/bpm': ['Delay, LFO and reverb times get worked out on a phone calculator mid-session.', 'Type or tap a tempo and read every note value, reverb starting point and length conversion at once.'],
  '/audio/metronome': ['Practice tools on phones come wrapped in ads and drift.', 'A sample-accurate metronome with polyrhythms and a tuner that never records.'],
  '/audio/lofi': ['Getting a sample to sound like an old tape or a phone means stacking five plugins by hand.', 'Pick a character, turn one knob, blend it in, download.'],
  '/audio/ear': ['Reading and hearing drills live in paid apps, and none of them teach you to hear an EQ move.', 'Six exercises with staff, keyboard and fretboard views, streak tracking and a link that saves the exact drill.'],
  '/audio/analyser': ['Mastering decisions get made on meters you have to pay for or plugins you have to open a DAW to see.', 'Drop a file and read tempo, key, loudness, peaks, width and how far you are from each platform target.'],
}

export const AUDIO_TOOLS: AudioTool[] = RAW_AUDIO_TOOLS.map((tool) => ({
  ...tool,
  problem: POSITIONING[tool.href][0],
  promise: POSITIONING[tool.href][1],
  privacy: 'Audio stays in this browser; nothing is uploaded.',
}))
