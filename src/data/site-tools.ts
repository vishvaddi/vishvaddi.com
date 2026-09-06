export const SITE_TOOL_CATEGORIES = [
  'Estimate & price',
  'Plan & procure',
  'Site & records',
  'Documents & reference',
] as const

export type SiteToolCategory = typeof SITE_TOOL_CATEGORIES[number]

export interface SiteTool {
  href: string
  title: string
  shortTitle: string
  icon: string
  description: string
  problem: string
  promise: string
  privacy: string
  category: SiteToolCategory
  aliases: string
  quick?: boolean
}

const RAW_SITE_TOOLS: Omit<SiteTool, 'problem' | 'promise' | 'privacy'>[] = [
  { href: '/site/calc', title: 'Calculator', shortTitle: 'Calculator', icon: '🧮', description: 'Expressions, functions, constants, variables and history.', category: 'Estimate & price', aliases: 'maths arithmetic percentage formula', quick: true },
  { href: '/site/notepad', title: 'Calculation Notepad', shortTitle: 'Calc Notepad', icon: '🧾', description: 'Takeoff notes with variables, GST, currency and metric units.', category: 'Estimate & price', aliases: 'soulver takeoff estimate notes' },
  { href: '/site/convert', title: 'Unit Converter', shortTitle: 'Converter', icon: '🔁', description: 'Metric, imperial, pressure, data and live currency conversion.', category: 'Estimate & price', aliases: 'mm inches metres feet aud usd temperature', quick: true },
  { href: '/site/materials', title: 'Material Calculators', shortTitle: 'Materials', icon: '🧱', description: 'Paint, tiles, plasterboard, concrete, footings, timber and roofing quantities.', category: 'Estimate & price', aliases: 'quantity takeoff paint tile concrete plasterboard footing weight density board feet timber sheathing roof tiles bricks blocks' },
  { href: '/site/geometry', title: 'Geometry & Setout', shortTitle: 'Geometry', icon: '📐', description: 'Feet-inch maths, square check, rafters, stairs, arcs, mitres and volumes.', category: 'Estimate & price', aliases: 'setout trig triangle roof stair area fall rafter hip valley jack compound mitre crown feet inches fraction dms polygon cylinder cone construction master' },
  { href: '/site/rate', title: 'Rate Builder', shortTitle: 'Rate Builder', icon: '💰', description: 'Build unit rates from material, labour, plant and margin.', category: 'Estimate & price', aliases: 'estimate costing labour material plant margin' },
  { href: '/site/charge-rate', title: 'Charge-Out Rate', shortTitle: 'Charge-Out', icon: '⏱️', description: 'Calculate an hourly charge from wages, overhead and margin.', category: 'Estimate & price', aliases: 'hourly wage super billable overhead' },
  { href: '/site/prices', title: 'Materials Price Tracker', shortTitle: 'Price Tracker', icon: '📈', description: 'Commodity and AUD/USD trend charts for estimate context.', category: 'Estimate & price', aliases: 'copper aluminium lumber steel diesel exchange' },
  { href: '/site/programme', title: 'Programme Builder', shortTitle: 'Programme', icon: '📊', description: 'Critical-path programmes, baselines, procurement and Gantt exports.', category: 'Plan & procure', aliases: 'gantt cpm schedule timeline project manager', quick: true },
  { href: '/site/cut-list', title: 'Cut List Optimizer', shortTitle: 'Cut List', icon: '✂️', description: 'Optimise linear stock and sheet layouts with practical cut plans.', category: 'Plan & procure', aliases: 'nesting sheet timber panel offcut waste', quick: true },
  { href: '/site/lattice', title: 'Lattice', shortTitle: 'Lattice', icon: '▦', description: 'Nested work breakdowns, estimating grids and project notes.', category: 'Plan & procure', aliases: 'wbs breakdown spreadsheet rollup hierarchy' },
  { href: '/site/span', title: 'Timber Span Lookup', shortTitle: 'Span Lookup', icon: '🪵', description: 'Indicative joist, ceiling-joist and rafter spans.', category: 'Plan & procure', aliases: 'timber joist rafter ceiling member' },
  { href: '/site/records', title: 'Site Records', shortTitle: 'Site Records', icon: '🗂️', description: 'Variations, punch lists, deliveries, contacts and daily logs.', category: 'Site & records', aliases: 'project manager variation defect diary delivery contact' },
  { href: '/site/voice', title: 'Voice Notes', shortTitle: 'Voice Notes', icon: '🎙️', description: 'Record and transcribe hands-free site notes.', category: 'Site & records', aliases: 'speech audio transcription site notes' },
  { href: '/site/sketch', title: 'Sketchpad', shortTitle: 'Sketchpad', icon: '✏️', description: 'Quick site marks and mark-ups with PNG export.', category: 'Site & records', aliases: 'draw markup annotate plan' },
  { href: '/site/gauges', title: 'Phone Tools', shortTitle: 'Phone Tools', icon: '📱', description: 'Spirit level, angle finder and sound meter.', category: 'Site & records', aliases: 'sensor level inclinometer decibel android' },
  { href: '/site/pdf', title: 'PDF Toolkit', shortTitle: 'PDF Toolkit', icon: '📄', description: 'Merge, split, organise, mark up and issue PDF documents.', category: 'Documents & reference', aliases: 'editor merge split compress sign watermark pages', quick: true },
  { href: '/site/quickref', title: 'Site Quick Reference', shortTitle: 'Quick Reference', icon: '📐', description: 'Searchable site dimensions and rules of thumb.', category: 'Documents & reference', aliases: 'stairs barriers heights falls courses' },
  { href: '/site/resources', title: 'Resources', shortTitle: 'Resources', icon: '📋', description: 'Standards, NCC links and construction references.', category: 'Documents & reference', aliases: 'ncc standards australia links reference' },
]

const POSITIONING: Record<string, [problem: string, promise: string]> = {
  '/site/calc': ['Site maths gets lost across separate calculator steps.', 'Keep complete expressions and reusable results in one history.'],
  '/site/notepad': ['Takeoff workings are hard to audit after the estimate.', 'Turn written calculations into traceable totals as you type.'],
  '/site/convert': ['Unit and currency conversions interrupt estimating flow.', 'Convert construction units and live currencies in one place.'],
  '/site/materials': ['Manual quantity formulas invite omissions and rework.', 'Calculate common trade materials with practical waste allowances.'],
  '/site/geometry': ['Setout geometry is slow and error-prone by hand.', 'Resolve construction dimensions with purpose-built calculators.'],
  '/site/rate': ['Unit rates hide their labour, plant and margin assumptions.', 'Build an auditable rate from its cost components.'],
  '/site/charge-rate': ['A wage is not a sustainable billable rate.', 'Include employment costs, overhead and margin in one calculation.'],
  '/site/prices': ['Old price intuition can distort a current estimate.', 'Check broad material and currency movements before pricing risk.'],
  '/site/programme': ['Dependencies and procurement risks disappear in simple task lists.', 'Build a critical-path programme with readable Gantt exports.'],
  '/site/cut-list': ['Ad-hoc cutting creates avoidable waste and missed pieces.', 'Generate practical stock and sheet cutting plans.'],
  '/site/lattice': ['Complex scopes become unreadable in flat spreadsheets.', 'Nest work, notes and costs while retaining roll-up totals.'],
  '/site/span': ['Finding indicative timber spans is slower than the early decision needs.', 'Get a cautious first-pass span reference before engineering.'],
  '/site/records': ['Site events are forgotten before they reach the commercial record.', 'Capture variations, defects, deliveries and diary entries consistently.'],
  '/site/voice': ['Typing site notes with occupied hands loses detail.', 'Record speech and turn it into editable notes.'],
  '/site/sketch': ['A photo or plan often needs one quick explanatory mark-up.', 'Draw, annotate and export a clean PNG without another app.'],
  '/site/gauges': ['Basic site checks should not require carrying another gadget.', 'Use supported phone sensors for quick indicative checks.'],
  '/site/pdf': ['Issuing and comparing drawings usually means uploading sensitive documents.', 'Organise, stamp, compare and export PDFs entirely in-browser.'],
  '/site/quickref': ['Common dimensions and rules of thumb are scattered across references.', 'Search a compact field reference when you need an indicative answer.'],
  '/site/resources': ['Authoritative Australian construction links are easy to lose.', 'Keep the main standards and code sources in one launch point.'],
}

export const SITE_TOOLS: SiteTool[] = RAW_SITE_TOOLS.map((tool) => ({
  ...tool,
  problem: POSITIONING[tool.href][0],
  promise: POSITIONING[tool.href][1],
  privacy: 'Runs on this device; no account or upload.',
}))
