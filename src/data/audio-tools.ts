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
  { href: '/audio/analyser', title: 'Track Analyser', shortTitle: 'Analyser', icon: '📊', description: 'BPM, key and Camelot, LUFS, true peak, loudness range, stereo width and streaming targets.', category: 'Analyse', aliases: 'bpm key camelot lufs loudness true peak lra spectrum mastering spotify apple youtube club', quick: true },
]

const POSITIONING: Record<string, [problem: string, promise: string]> = {
  '/audio/analyser': ['Mastering decisions get made on meters you have to pay for or plugins you have to open a DAW to see.', 'Drop a file and read tempo, key, loudness, peaks, width and how far you are from each platform target.'],
}

export const AUDIO_TOOLS: AudioTool[] = RAW_AUDIO_TOOLS.map((tool) => ({
  ...tool,
  problem: POSITIONING[tool.href][0],
  promise: POSITIONING[tool.href][1],
  privacy: 'Audio stays in this browser; nothing is uploaded.',
}))
