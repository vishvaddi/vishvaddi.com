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
  category: SiteToolCategory
  aliases: string
  quick?: boolean
}

export const SITE_TOOLS: SiteTool[] = [
  { href: '/site/calc', title: 'Calculator', shortTitle: 'Calculator', icon: '🧮', description: 'Expressions, functions, constants, variables and history.', category: 'Estimate & price', aliases: 'maths arithmetic percentage formula', quick: true },
  { href: '/site/notepad', title: 'Calculation Notepad', shortTitle: 'Calc Notepad', icon: '🧾', description: 'Takeoff notes with variables, GST, currency and metric units.', category: 'Estimate & price', aliases: 'soulver takeoff estimate notes' },
  { href: '/site/convert', title: 'Unit Converter', shortTitle: 'Converter', icon: '🔁', description: 'Metric, imperial, pressure, data and live currency conversion.', category: 'Estimate & price', aliases: 'mm inches metres feet aud usd temperature', quick: true },
  { href: '/site/materials', title: 'Material Calculators', shortTitle: 'Materials', icon: '🧱', description: 'Paint, tiles, plasterboard, concrete and linear quantities.', category: 'Estimate & price', aliases: 'quantity takeoff paint tile concrete plasterboard' },
  { href: '/site/geometry', title: 'Geometry & Setout', shortTitle: 'Geometry', icon: '📐', description: 'Square check, stairs, falls, areas, pitch and triangles.', category: 'Estimate & price', aliases: 'setout trig triangle roof stair area fall' },
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
