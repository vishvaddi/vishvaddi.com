// Inline SVG glyphs for the tool/game hub cards (set:html — these are our own
// constants, never user data). 24x24, stroke-only, in the spirit of
// Lucide/Feather so the hub reads as one icon system instead of mixed emoji.
const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

export const TOOL_ICON_FALLBACK = svg('<circle cx="12" cy="12" r="8"/>')

export const TOOL_ICONS: Record<string, string> = {
  // Site tools
  '/site/calc': svg(
    '<rect x="5" y="2.5" width="14" height="19" rx="2"/>' +
    '<line x1="8" y1="6.5" x2="16" y2="6.5"/>' +
    '<circle cx="8.5" cy="11.5" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="11.5" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="11.5" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="8.5" cy="15.5" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="15.5" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="15.5" r="0.9" fill="currentColor" stroke="none"/>'
  ),
  '/site/notepad': svg(
    '<path d="M7 2.5h8l3 3v16H7z"/><path d="M15 2.5v3h3"/>' +
    '<line x1="9.5" y1="12" x2="14.5" y2="12"/><line x1="9.5" y1="15.5" x2="14.5" y2="15.5"/>'
  ),
  '/site/convert': svg(
    '<path d="M4 8h13"/><path d="M14 4l3 4-3 4"/>' +
    '<path d="M20 16H7"/><path d="M10 12l-3 4 3 4"/>'
  ),
  '/site/materials': svg(
    '<rect x="3.5" y="4" width="17" height="16" rx="1"/>' +
    '<line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="3.5" y1="15" x2="20.5" y2="15"/>' +
    '<line x1="8" y1="4" x2="8" y2="10"/><line x1="14" y1="10" x2="14" y2="15"/><line x1="8" y1="15" x2="8" y2="20"/>'
  ),
  '/site/geometry': svg(
    '<path d="M3.5 20.5L12 4l8.5 16.5z"/><line x1="8" y1="12.5" x2="16" y2="12.5"/>'
  ),
  '/site/rate': svg(
    '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>'
  ),
  '/site/charge-rate': svg(
    '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 7.5v5l3.2 2"/><path d="M9 2h6"/>'
  ),
  '/site/prices': svg(
    '<path d="M3.5 17l5.5-6 4 3.5 7-8"/><path d="M15.5 6.5H20v4.5"/>'
  ),
  '/site/programme': svg(
    '<line x1="3.5" y1="6" x2="15" y2="6"/><line x1="3.5" y1="12" x2="19" y2="12"/><line x1="3.5" y1="18" x2="11" y2="18"/>'
  ),
  '/site/cut-list': svg(
    '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/>' +
    '<line x1="8.5" y1="8.2" x2="20" y2="19"/><line x1="20" y1="5" x2="8.5" y2="15.8"/>'
  ),
  '/site/lattice': svg(
    '<rect x="3" y="3" width="18" height="18" rx="1.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/>'
  ),
  '/site/span': svg(
    '<line x1="4" y1="19" x2="4" y2="9"/><line x1="20" y1="19" x2="20" y2="9"/>' +
    '<line x1="2.5" y1="9" x2="21.5" y2="9"/><line x1="2.5" y1="19" x2="21.5" y2="19"/>'
  ),
  '/site/records': svg(
    '<path d="M3.5 6.5h5l2 2.5h10v11h-17z"/>'
  ),
  '/site/voice': svg(
    '<rect x="9" y="2.5" width="6" height="11" rx="3"/>' +
    '<path d="M5.5 11.5a6.5 6.5 0 0013 0"/><line x1="12" y1="18" x2="12" y2="21.5"/>'
  ),
  '/site/sketch': svg(
    '<path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z"/><line x1="13" y1="7.5" x2="16.5" y2="11"/>'
  ),
  '/site/gauges': svg(
    '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><line x1="10" y1="19" x2="14" y2="19"/>'
  ),
  '/site/pdf': svg(
    '<path d="M6 2.5h9l3.5 3.5v15.5H6z"/><path d="M15 2.5v3.5h3.5"/>'
  ),
  '/site/quickref': svg(
    '<path d="M5 3.5h11a2 2 0 012 2V21H7a2 2 0 01-2-2z"/><line x1="9" y1="8" x2="14.5" y2="8"/><line x1="9" y1="12" x2="14.5" y2="12"/>'
  ),
  '/site/resources': svg(
    '<path d="M9.5 14.5l5-5"/><path d="M9 8.5l1-1a3.2 3.2 0 014.5 4.5l-1 1"/>' +
    '<path d="M15 15.5l-1 1a3.2 3.2 0 01-4.5-4.5l1-1"/>'
  ),
  // Audio tools
  '/audio/chords': svg(
    '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/>' +
    '<line x1="8" y1="5" x2="8" y2="14"/><line x1="12" y1="5" x2="12" y2="14"/><line x1="16" y1="5" x2="16" y2="14"/>'
  ),
  '/audio/prep': svg(
    '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/>' +
    '<line x1="8.5" y1="8.2" x2="20" y2="19"/><line x1="20" y1="5" x2="8.5" y2="15.8"/>'
  ),
  '/audio/bpm': svg(
    '<path d="M6 21h12L15.5 6h-7z"/><line x1="9" y1="21" x2="9" y2="6"/><line x1="10" y1="17.5" x2="16" y2="8"/>'
  ),
  '/audio/metronome': svg(
    '<path d="M9 3h6l2 8-5 10-5-10z"/><line x1="9.7" y1="6" x2="14.3" y2="6"/>'
  ),
  '/audio/lofi': svg(
    '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>'
  ),
  '/audio/ear': svg(
    '<path d="M9 20c-3-1-5-4-5-8a8 8 0 1116 0c0 3-2 4-2 7a2.5 2.5 0 01-5 0"/>'
  ),
  '/audio/analyser': svg(
    '<line x1="5" y1="19" x2="5" y2="10"/><line x1="10" y1="19" x2="10" y2="4"/>' +
    '<line x1="15" y1="19" x2="15" y2="13"/><line x1="20" y1="19" x2="20" y2="8"/>'
  ),
  // Games
  '/games/deep-swarm/': svg(
    '<path d="M2.5 15.5c3-2.5 5.5-2.5 8.5 0s5.5 2.5 8.5 0"/>' +
    '<rect x="7" y="6" width="10" height="7" rx="3.5"/><line x1="12" y1="3" x2="12" y2="6"/>'
  ),
  '/games/last-cast/': svg(
    '<path d="M12 3v10.5"/><path d="M8 6.5a4 4 0 018 0"/>' +
    '<path d="M12 13.5c-2.5 3-2 6 0 8s3-1 1.5-3-3 .5-1.5 -5z"/>'
  ),
  '/games/carromancy/': svg(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/>'
  ),
  '/games/big2': svg(
    '<rect x="3" y="5" width="9" height="13" rx="1.5" transform="rotate(-8 7.5 11.5)"/>' +
    '<rect x="11.5" y="5" width="9" height="13" rx="1.5" transform="rotate(8 16 11.5)"/>'
  ),
  // Other pages
  '/studio': svg(
    '<line x1="5" y1="20" x2="5" y2="8"/><line x1="10" y1="20" x2="10" y2="3"/>' +
    '<line x1="15" y1="20" x2="15" y2="10"/><line x1="20" y1="20" x2="20" y2="6"/>'
  ),
  '/radio': svg(
    '<circle cx="12" cy="14.5" r="6.5"/><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none"/>' +
    '<path d="M12 8V3"/><path d="M8.5 5.5L12 3l3.5 2.5"/>'
  ),
  '/reader': svg(
    '<path d="M12 5.5c-2-1.5-4.5-2-8-1.5v14c3.5-.5 6 0 8 1.5 2-1.5 4.5-2 8-1.5V4c-3.5-.5-6 0-8 1.5z"/>' +
    '<line x1="12" y1="5.5" x2="12" y2="19.5"/>'
  ),
  '/feeds': svg(
    '<circle cx="5.5" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>' +
    '<path d="M4 11.5a8.5 8.5 0 018.5 8.5"/><path d="M4 5.5A14.5 14.5 0 0118.5 20"/>'
  ),
}
