// CPM engine — dependency-free, works in working-day index space then maps to
// dates. Formulas follow the vault reference (Knowledge/Construction Project
// Planning.md): EF = ES + D − 1; TF = LF − EF; FF = ES(succ) − EF − 1.
// Milestones (duration 0) use EF = ES and render as points.

export type DepType = 'FS' | 'SS' | 'FF'

export interface Dep { id: string; type: DepType; lag: number }        // lag in WORKING days; negative = lead

export interface CpmTask {
  id: string
  duration: number                                                     // working days; 0 = milestone
  deps: Dep[]
  constraint?: { type: 'SNET'; date: string }                          // start no earlier than
}

export interface Calendar {
  workDays: boolean[]                                                  // index 0 = Sunday … 6 = Saturday
  holidays: string[]                                                   // YYYY-MM-DD
}

export interface ScheduledTask {
  id: string
  es: number; ef: number; ls: number; lf: number                       // working-day indexes (0-based)
  tf: number; ff: number
  critical: boolean
  esDate: string; efDate: string; lsDate: string; lfDate: string
}

export class CycleError extends Error {
  constructor(public ids: string[]) {
    super(`Dependency cycle involving: ${ids.join(' → ')}`)
  }
}

// ---- date helpers -----------------------------------------------------------

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function isWorkDay(d: Date, cal: Calendar): boolean {
  return cal.workDays[d.getDay()] && !cal.holidays.includes(fmtDate(d))
}

/** Working-day index → calendar date. Index 0 = first working day on/after start. */
export function indexToDate(index: number, start: string, cal: Calendar): Date {
  const d = parseDate(start)
  let i = -1
  // guard: a calendar with no working days would loop forever
  if (!cal.workDays.some(Boolean)) return d
  while (true) {
    if (isWorkDay(d, cal)) {
      i++
      if (i === index) return new Date(d)
    }
    d.setDate(d.getDate() + 1)
  }
}

/** Calendar date → working-day index (rolls forward to the next working day). */
export function dateToIndex(date: string, start: string, cal: Calendar): number {
  const target = parseDate(date).getTime()
  const d = parseDate(start)
  if (!cal.workDays.some(Boolean)) return 0
  let i = -1
  for (let guard = 0; guard < 40000; guard++) { // ~150 years
    if (isWorkDay(d, cal)) {
      i++
      if (d.getTime() >= target) return i
    }
    d.setDate(d.getDate() + 1)
  }
  return Math.max(0, i)
}

/** Subtract N CALENDAR days (procurement lead times run in calendar days). */
export function minusCalendarDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return d
}

// ---- the scheduler ------------------------------------------------------------

export function schedule(
  tasks: CpmTask[],
  startDate: string,
  cal: Calendar,
): Map<string, ScheduledTask> {
  const byId = new Map(tasks.map(t => [t.id, t]))

  // Successor map for the backward pass + free float
  const succs = new Map<string, { id: string; type: DepType; lag: number }[]>()
  for (const t of tasks) {
    for (const dep of t.deps) {
      if (!byId.has(dep.id)) continue // dangling link — ignore rather than crash
      if (!succs.has(dep.id)) succs.set(dep.id, [])
      succs.get(dep.id)!.push({ id: t.id, type: dep.type, lag: dep.lag })
    }
  }

  // Topological order (Kahn) with cycle detection
  const indeg = new Map<string, number>(tasks.map(t => [t.id, 0]))
  for (const t of tasks) for (const dep of t.deps) if (byId.has(dep.id)) indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1)
  const queue = tasks.filter(t => (indeg.get(t.id) ?? 0) === 0).map(t => t.id)
  const topo: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    topo.push(id)
    for (const s of succs.get(id) ?? []) {
      indeg.set(s.id, indeg.get(s.id)! - 1)
      if (indeg.get(s.id) === 0) queue.push(s.id)
    }
  }
  if (topo.length !== tasks.length) {
    throw new CycleError(tasks.filter(t => !topo.includes(t.id)).map(t => t.id))
  }

  const es = new Map<string, number>()
  const ef = new Map<string, number>()

  // Forward pass. Milestone convention: EF = ES (zero-width point).
  for (const id of topo) {
    const t = byId.get(id)!
    const D = Math.max(0, t.duration)
    let e = 0
    for (const dep of t.deps) {
      if (!byId.has(dep.id)) continue
      const pEF = ef.get(dep.id)!
      const pES = es.get(dep.id)!
      const pIsMs = byId.get(dep.id)!.duration === 0
      if (dep.type === 'FS') {
        // successor starts the day after the predecessor finishes (+lag);
        // a milestone "finishes" on its own day, so successors start same day + lag
        e = Math.max(e, pIsMs ? pEF + dep.lag : pEF + 1 + dep.lag)
      } else if (dep.type === 'SS') {
        e = Math.max(e, pES + dep.lag)
      } else { // FF
        const efReq = pEF + dep.lag
        e = Math.max(e, D === 0 ? efReq : efReq - D + 1)
      }
    }
    if (t.constraint?.type === 'SNET') {
      e = Math.max(e, dateToIndex(t.constraint.date, startDate, cal))
    }
    es.set(id, e)
    ef.set(id, D === 0 ? e : e + D - 1)
  }

  const projectEnd = Math.max(0, ...tasks.map(t => ef.get(t.id)!))

  // Backward pass
  const lf = new Map<string, number>()
  const ls = new Map<string, number>()
  for (const id of [...topo].reverse()) {
    const t = byId.get(id)!
    const D = Math.max(0, t.duration)
    const isMs = D === 0
    let l = projectEnd
    for (const s of succs.get(id) ?? []) {
      if (s.type === 'FS') {
        // mirror of the forward pass: the +1 applies unless THIS task (the
        // predecessor in the link) is a milestone
        l = Math.min(l, isMs ? ls.get(s.id)! - s.lag : ls.get(s.id)! - 1 - s.lag)
      } else if (s.type === 'SS') {
        const lsReq = ls.get(s.id)! - s.lag
        l = Math.min(l, isMs ? lsReq : lsReq + D - 1)
      } else { // FF
        l = Math.min(l, lf.get(s.id)! - s.lag)
      }
    }
    lf.set(id, l)
    ls.set(id, isMs ? l : l - D + 1)
  }

  const out = new Map<string, ScheduledTask>()
  for (const t of tasks) {
    const tES = es.get(t.id)!, tEF = ef.get(t.id)!, tLS = ls.get(t.id)!, tLF = lf.get(t.id)!
    const tf = tLF - tEF
    // Free float: earliest successor start minus own finish (FS convention)
    let ffV = tf
    const isMs = t.duration === 0
    for (const s of succs.get(t.id) ?? []) {
      if (s.type === 'FS') {
        ffV = Math.min(ffV, es.get(s.id)! - tEF - (isMs ? 0 : 1) - s.lag)
      }
    }
    out.set(t.id, {
      id: t.id,
      es: tES, ef: tEF, ls: tLS, lf: tLF,
      tf, ff: Math.max(0, ffV),
      critical: tf <= 0,
      esDate: fmtDate(indexToDate(tES, startDate, cal)),
      efDate: fmtDate(indexToDate(tEF, startDate, cal)),
      lsDate: fmtDate(indexToDate(tLS, startDate, cal)),
      lfDate: fmtDate(indexToDate(tLF, startDate, cal)),
    })
  }
  return out
}

/** Project span in working days (max EF + 1). */
export function projectSpan(sched: Map<string, ScheduledTask>): number {
  let max = 0
  for (const s of sched.values()) max = Math.max(max, s.ef)
  return max + 1
}
