// Programme data model + shopfitting templates. Trade sequence and durations
// derive from the vault's Knowledge/Shopfitting.md (14-step sequence) and real
// project phasing; terminology is AU fitout (programme, PC, possession).
import type { Dep, Calendar } from './cpm'

export type ProcCategory = 'off-shelf' | 'standard' | 'custom' | 'long-lead'

export interface Task {
  id: string
  name: string
  trade?: string
  phase?: string
  duration: number                       // working days; 0 = milestone
  deps: Dep[]
  hours?: number
  crew?: number
  constraint?: { type: 'SNET'; date: string }
  colour?: string
  notes?: string
  nightWork?: boolean
  procurement?: { leadDays: number; category: ProcCategory }
}

export interface Programme {
  id: string
  title: string
  startDate: string                      // possession
  calendar: Calendar
  tasks: Task[]
  baseline?: { lockedAt: string; dates: Record<string, { es: string; ef: string }> }
  updated: number
}

let counter = 0
export function pid(): string {
  return `pt-${Date.now().toString(36)}-${(counter++).toString(36)}`
}

// Mon–Sat: standard AU fitout site week; Sunday off.
export function defaultCalendar(): Calendar {
  return { workDays: [false, true, true, true, true, true, true], holidays: [] }
}

export function newProgramme(title: string, startDate: string): Programme {
  return { id: pid(), title, startDate, calendar: defaultCalendar(), tasks: [], updated: Date.now() }
}

// ---- predecessor text format: "3", "3FS+2", "5SS-1, 7FF" (1-based row numbers)

export function depsToText(t: Task, tasks: Task[]): string {
  return t.deps.map(d => {
    const row = tasks.findIndex(x => x.id === d.id) + 1
    if (!row) return null
    const type = d.type === 'FS' && !d.lag ? '' : d.type
    const lag = d.lag ? (d.lag > 0 ? `+${d.lag}` : String(d.lag)) : ''
    return `${row}${type}${lag}`
  }).filter(Boolean).join(', ')
}

export function textToDeps(text: string, tasks: Task[]): Dep[] | null {
  const out: Dep[] = []
  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(FS|SS|FF)?\s*([+-]\s*\d+)?$/i.exec(part)
    if (!m) return null
    const row = Number(m[1]) - 1
    if (row < 0 || row >= tasks.length) return null
    out.push({
      id: tasks[row].id,
      type: (m[2]?.toUpperCase() as Dep['type']) ?? 'FS',
      lag: m[3] ? Number(m[3].replace(/\s/g, '')) : 0,
    })
  }
  return out
}

// ---- persistence (localStorage, same pattern as site Lattice) ----------------

const LS_KEY = 'programme_v1'

export function loadProgrammes(): Programme[] {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Programme[]
    return all.sort((a, b) => b.updated - a.updated)
  } catch { return [] }
}

export function persistProgramme(p: Programme): void {
  const all = loadProgrammes().filter(x => x.id !== p.id)
  all.unshift(p)
  localStorage.setItem(LS_KEY, JSON.stringify(all))
}

export function removeProgramme(id: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadProgrammes().filter(p => p.id !== id)))
}

// ---- templates ----------------------------------------------------------------

interface Row {
  name: string; trade?: string; phase?: string; dur: number
  deps?: [number, Dep['type']?, number?][]   // index into template rows (0-based)
  hours?: number
  proc?: { leadDays: number; category: ProcCategory }
  night?: boolean
}

function build(title: string, startDate: string, rows: Row[]): Programme {
  const p = newProgramme(title, startDate)
  const ids = rows.map(() => pid())
  p.tasks = rows.map((r, i) => ({
    id: ids[i],
    name: r.name,
    trade: r.trade,
    phase: r.phase,
    duration: r.dur,
    hours: r.hours,
    nightWork: r.night,
    procurement: r.proc,
    deps: (r.deps ?? []).map(([idx, type, lag]) => ({ id: ids[idx], type: type ?? 'FS', lag: lag ?? 0 })),
  }))
  return p
}

/** Scale all task durations so the programme spans ~targetWeeks (6-day weeks). Milestones stay 0. */
export function scaleDurations(p: Programme, templateSpanDays: number, targetWeeks: number): void {
  const workPerWeek = p.calendar.workDays.filter(Boolean).length
  const target = Math.max(workPerWeek, Math.round(targetWeeks * workPerWeek))
  const f = target / templateSpanDays
  if (!Number.isFinite(f) || Math.abs(f - 1) < 0.05) return
  for (const t of p.tasks) {
    if (t.duration > 0) t.duration = Math.max(1, Math.round(t.duration * f))
    if (t.hours) t.hours = Math.round(t.hours * f)
  }
}

export interface TemplateDef {
  name: string
  blurb: string
  spanDays: number                        // nominal span for duration scaling
  make: (startDate: string) => Programme
}

export function templates(): TemplateDef[] {
  return [
    {
      name: 'Retail fitout — standard',
      blurb: 'The full trade sequence, possession to handover (~9 weeks nominal)',
      spanDays: 54,
      make: (start) => build('Retail fitout', start, [
        { name: 'Possession of site', dur: 0 },
        { name: 'Site establishment & hoarding', trade: 'Prelims', dur: 2, deps: [[0]], hours: 48, night: true },
        { name: 'Demolition / strip-out', trade: 'Demolition', dur: 4, deps: [[1]], hours: 160, night: true },
        { name: 'Structural modifications', trade: 'Structure', dur: 4, deps: [[2]], hours: 96 },
        { name: 'Set-out', trade: 'Prelims', dur: 1, deps: [[3]], hours: 16 },
        { name: 'Wall framing / partitions', trade: 'Partitions', dur: 6, deps: [[4]], hours: 240 },
        { name: 'Services rough-in (elec/mech/hyd)', trade: 'Services', dur: 8, deps: [[5, 'SS', 2]], hours: 320 },
        { name: 'Insulation', trade: 'Partitions', dur: 2, deps: [[6, 'FF', 1], [5]], hours: 48 },
        { name: 'Linings / plasterboard & set', trade: 'Linings', dur: 5, deps: [[7]], hours: 200 },
        { name: 'Ceilings', trade: 'Ceilings', dur: 5, deps: [[8, 'SS', 2]], hours: 180 },
        { name: 'Lockup', dur: 0, deps: [[9]] },
        { name: 'Flooring', trade: 'Finishes', dur: 4, deps: [[10]], hours: 128, proc: { leadDays: 14, category: 'standard' } },
        { name: 'Painting', trade: 'Finishes', dur: 5, deps: [[9], [11, 'SS', 2]], hours: 160 },
        { name: 'Joinery install', trade: 'Joinery', dur: 8, deps: [[12, 'SS', 2]], hours: 384, proc: { leadDays: 30, category: 'custom' } },
        { name: 'Shopfront & glazing', trade: 'Shopfront', dur: 5, deps: [[10]], hours: 160, proc: { leadDays: 35, category: 'long-lead' } },
        { name: 'Services fit-off', trade: 'Services', dur: 4, deps: [[13, 'SS', 4], [9]], hours: 128 },
        { name: 'Joinery fit-off & hardware', trade: 'Joinery', dur: 3, deps: [[13]], hours: 96 },
        { name: 'Signage & graphics', trade: 'Signage', dur: 2, deps: [[14], [12]], hours: 48, proc: { leadDays: 21, category: 'custom' } },
        { name: 'FF&E install', trade: 'FF&E', dur: 3, deps: [[16], [11]], hours: 96, proc: { leadDays: 21, category: 'standard' } },
        { name: 'Commissioning & testing', trade: 'Services', dur: 2, deps: [[15], [17]], hours: 48 },
        { name: 'Builder’s clean', trade: 'Clean', dur: 2, deps: [[18], [19]], hours: 48 },
        { name: 'Defects & touch-ups', trade: 'Clean', dur: 3, deps: [[20, 'SS', 1]], hours: 72 },
        { name: 'Practical Completion', dur: 0, deps: [[21]] },
        { name: 'Handover', dur: 0, deps: [[22]] },
      ]),
    },
    {
      name: 'Retail fitout — multi-phase',
      blurb: 'Two-phase trading-store programme (phased possession, night works)',
      spanDays: 60,
      make: (start) => build('Multi-phase fitout', start, [
        { name: 'Possession — Phase 1', phase: 'Phase 1', dur: 0 },
        { name: 'Hoard & protect Phase 1', phase: 'Phase 1', trade: 'Prelims', dur: 2, deps: [[0]], hours: 48, night: true },
        { name: 'Demolition Phase 1', phase: 'Phase 1', trade: 'Demolition', dur: 5, deps: [[1]], hours: 200, night: true },
        { name: 'Services rough-in Phase 1', phase: 'Phase 1', trade: 'Services', dur: 6, deps: [[2]], hours: 240 },
        { name: 'Partitions & linings Phase 1', phase: 'Phase 1', trade: 'Partitions', dur: 8, deps: [[3, 'SS', 2]], hours: 320 },
        { name: 'Finishes Phase 1', phase: 'Phase 1', trade: 'Finishes', dur: 8, deps: [[4]], hours: 256 },
        { name: 'Joinery & fixtures Phase 1', phase: 'Phase 1', trade: 'Joinery', dur: 8, deps: [[5, 'SS', 3]], hours: 320, proc: { leadDays: 30, category: 'custom' } },
        { name: 'Phase 1 complete — trade swap', phase: 'Phase 1', dur: 0, deps: [[6]] },
        { name: 'Floor swap (night works)', phase: 'Phase 2', trade: 'Prelims', dur: 2, deps: [[7]], hours: 64, night: true },
        { name: 'Demolition Phase 2', phase: 'Phase 2', trade: 'Demolition', dur: 4, deps: [[8]], hours: 160, night: true },
        { name: 'Services rough-in Phase 2', phase: 'Phase 2', trade: 'Services', dur: 5, deps: [[9]], hours: 200 },
        { name: 'Partitions & linings Phase 2', phase: 'Phase 2', trade: 'Partitions', dur: 7, deps: [[10, 'SS', 2]], hours: 280 },
        { name: 'Finishes Phase 2', phase: 'Phase 2', trade: 'Finishes', dur: 7, deps: [[11]], hours: 224 },
        { name: 'Joinery & fixtures Phase 2', phase: 'Phase 2', trade: 'Joinery', dur: 7, deps: [[12, 'SS', 3]], hours: 280, proc: { leadDays: 30, category: 'custom' } },
        { name: 'Services fit-off & commissioning', phase: 'Phase 2', trade: 'Services', dur: 3, deps: [[13]], hours: 96 },
        { name: 'Builder’s clean & defects', phase: 'Phase 2', trade: 'Clean', dur: 3, deps: [[14]], hours: 96 },
        { name: 'Practical Completion', phase: 'Phase 2', dur: 0, deps: [[15]] },
      ]),
    },
    {
      name: 'Blank',
      blurb: 'Empty programme — build your own',
      spanDays: 1,
      make: (start) => build('Untitled programme', start, [
        { name: 'Possession of site', dur: 0 },
      ]),
    },
  ]
}
