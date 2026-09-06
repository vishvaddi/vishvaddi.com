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
  { href: '/audio/analyser', title: 'Track Analyser', shortTitle: 'Analyser', icon: '📊', description: 'BPM, key and Camelot, LUFS, true peak, loudness range, stereo width and streaming targets.', category: 'Analyse', aliases: 'bpm key camelot lufs loudness true peak lra spectrum mastering spotify apple youtube club', quick: true },
]

const POSITIONING: Record<string, [problem: string, promise: string]> = {
  '/audio/chords': ['Which chords belong in this key is a lookup you keep re-doing mid-session.', 'Hear every diatonic chord, build and loop a progression, export it as MIDI.'],
  '/audio/prep': ['Every sample needs the same five fixes before it is usable, and a DAW makes you do them one at a time.', 'Set the recipe once and run every file through it, then download WAV or MP3.'],
  '/audio/analyser': ['Mastering decisions get made on meters you have to pay for or plugins you have to open a DAW to see.', 'Drop a file and read tempo, key, loudness, peaks, width and how far you are from each platform target.'],
}

export const AUDIO_TOOLS: AudioTool[] = RAW_AUDIO_TOOLS.map((tool) => ({
  ...tool,
  problem: POSITIONING[tool.href][0],
  promise: POSITIONING[tool.href][1],
  privacy: 'Audio stays in this browser; nothing is uploaded.',
}))
