// Programme — construction Gantt. G1: templates, task table with inline
// editing, computed CPM dates, static SVG timeline (critical path coloured,
// weekends shaded, milestones as diamonds). Interactions (drag/link) are G2.
import { schedule, projectSpan, parseDate, fmtDate, isWorkDay, CycleError, type ScheduledTask } from './cpm'
import {
  type Programme, templates, scaleDurations,
  loadProgrammes, persistProgramme, removeProgramme,
  pid, depsToText, textToDeps,
} from './programme-model'

const DAY_W = 20
const ROW_H = 30
const HEADER_H = 44

const TRADE_COLOURS = ['#5b8dd6', '#c5683f', '#6aa84f', '#8e63ce', '#d0a03f', '#4fa8a0', '#c65b7a', '#7a7a52']

function tradeColour(trade: string | undefined, trades: string[]): string {
  if (!trade) return 'var(--muted)'
  return TRADE_COLOURS[Math.max(0, trades.indexOf(trade)) % TRADE_COLOURS.length]
}

function toast(msg: string): void {
  const t = document.createElement('div')
  t.className = 'prog-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}

function armTwice(btn: HTMLButtonElement, label: string, fn: () => void): void {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { fn(); return }
    btn.dataset.armed = '1'
    const prev = btn.textContent
    btn.textContent = label
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = prev }, 2500)
  })
}

const fmtAU = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export function initProgramme(el: HTMLElement): void {
  let prog: Programme | null = null
  let saveTimer: number | undefined

  function scheduleSave() {
    if (!prog) return
    prog.updated = Date.now()
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => { if (prog) persistProgramme(prog) }, 400)
  }

  // ---- list + generator screen ------------------------------------------------

  function drawList() {
    prog = null
    el.innerHTML = ''

    const listCard = document.createElement('div')
    listCard.className = 'prog-card'
    listCard.innerHTML = '<div class="prog-card-title">PROGRAMMES</div>'
    const saved = loadProgrammes()
    if (!saved.length) {
      const p = document.createElement('p')
      p.className = 'prog-blurb'
      p.textContent = 'Nothing yet — generate one below. Everything stays in this browser.'
      listCard.appendChild(p)
    }
    for (const s of saved) {
      const row = document.createElement('div')
      row.className = 'prog-row'
      const open = document.createElement('button')
      open.className = 'prog-open'
      open.innerHTML = `<span class="prog-name"></span><span class="prog-sub"></span>`
      open.querySelector('.prog-name')!.textContent = s.title
      open.querySelector('.prog-sub')!.textContent = `${fmtAU(s.startDate)} start · ${s.tasks.length} tasks${s.baseline ? ' · baselined' : ''}`
      open.addEventListener('click', () => {
        const fresh = loadProgrammes().find(x => x.id === s.id)
        if (fresh) { prog = fresh; drawEditor() }
      })
      const del = document.createElement('button')
      del.className = 'prog-del'
      del.setAttribute('aria-label', `Delete ${s.title}`)
      del.textContent = '✕'
      armTwice(del, 'sure?', () => { removeProgramme(s.id); drawList() })
      row.append(open, del)
      listCard.appendChild(row)
    }
    el.appendChild(listCard)

    const gen = document.createElement('div')
    gen.className = 'prog-card'
    gen.innerHTML = `
      <div class="prog-card-title">GENERATE</div>
      <div class="prog-gen">
        <div class="field"><label for="prog-start">Possession date</label><input type="date" id="prog-start" /></div>
        <div class="field"><label for="prog-weeks">Target duration (weeks)</label><input type="number" id="prog-weeks" min="1" max="52" step="0.5" value="9" inputmode="decimal" /></div>
      </div>
      <div class="prog-tpl-wrap" id="prog-tpls"></div>
    `
    el.appendChild(gen)
    const startInput = gen.querySelector<HTMLInputElement>('#prog-start')!
    startInput.value = fmtDate(new Date())
    const weeksInput = gen.querySelector<HTMLInputElement>('#prog-weeks')!
    const tplWrap = gen.querySelector('#prog-tpls')!
    for (const tpl of templates()) {
      const b = document.createElement('button')
      b.className = 'prog-tpl'
      b.innerHTML = `<div class="prog-tpl-name"></div><div class="prog-tpl-blurb"></div>`
      b.querySelector('.prog-tpl-name')!.textContent = tpl.name
      b.querySelector('.prog-tpl-blurb')!.textContent = tpl.blurb
      b.addEventListener('click', () => {
        const start = startInput.value || fmtDate(new Date())
        const p = tpl.make(start)
        const weeks = parseFloat(weeksInput.value)
        if (weeks > 0 && tpl.spanDays > 1) scaleDurations(p, tpl.spanDays, weeks)
        persistProgramme(p)
        prog = p
        drawEditor()
      })
      tplWrap.appendChild(b)
    }
  }

  // ---- editor -------------------------------------------------------------------

  function compute(): Map<string, ScheduledTask> | null {
    if (!prog) return null
    try {
      return schedule(prog.tasks, prog.startDate, prog.calendar)
    } catch (e) {
      if (e instanceof CycleError) { toast(e.message); return null }
      throw e
    }
  }

  function drawEditor() {
    if (!prog) return
    const sched = compute()
    el.innerHTML = ''

    // toolbar
    const bar = document.createElement('div')
    bar.className = 'prog-toolbar'
    const back = document.createElement('button')
    back.className = 'prog-tb'
    back.textContent = '☰'
    back.setAttribute('aria-label', 'All programmes')
    back.addEventListener('click', () => {
      clearTimeout(saveTimer)
      if (prog) persistProgramme(prog)
      drawList()
    })
    const title = document.createElement('input')
    title.className = 'prog-title'
    title.value = prog.title
    title.setAttribute('aria-label', 'Programme title')
    title.addEventListener('change', () => { if (prog && title.value.trim()) { prog.title = title.value.trim(); scheduleSave() } })
    const start = document.createElement('input')
    start.type = 'date'
    start.className = 'prog-tb prog-date'
    start.value = prog.startDate
    start.setAttribute('aria-label', 'Possession date')
    start.addEventListener('change', () => { if (prog && start.value) { prog.startDate = start.value; scheduleSave(); drawEditor() } })
    const sat = document.createElement('button')
    sat.className = 'prog-tb'
    sat.textContent = prog.calendar.workDays[6] ? '6-day week' : '5-day week'
    sat.title = 'Toggle Saturday working'
    sat.addEventListener('click', () => {
      if (!prog) return
      prog.calendar.workDays[6] = !prog.calendar.workDays[6]
      scheduleSave()
      drawEditor()
    })
    const spacer = document.createElement('span')
    spacer.className = 'prog-spacer'
    const addBtn = document.createElement('button')
    addBtn.className = 'prog-tb'
    addBtn.textContent = '＋ task'
    addBtn.addEventListener('click', () => {
      if (!prog) return
      prog.tasks.push({ id: pid(), name: 'New task', duration: 1, deps: [] })
      scheduleSave()
      drawEditor()
    })
    bar.append(back, title, start, sat, spacer, addBtn)
    el.appendChild(bar)

    if (!sched) return

    const finishIdx = projectSpan(sched) - 1
    const finishDate = prog.tasks.length
      ? [...sched.values()].reduce((m, s) => s.efDate > m ? s.efDate : m, prog.startDate)
      : prog.startDate
    const totalHours = prog.tasks.reduce((a, t) => a + (t.hours ?? 0), 0)
    const critCount = [...sched.values()].filter(s => s.critical).length

    const stats = document.createElement('div')
    stats.className = 'prog-stats'
    stats.setAttribute('aria-live', 'polite')
    stats.innerHTML = `
      <span><strong>${finishIdx + 1}</strong> working days</span>
      <span>finish <strong>${fmtAU(finishDate)}</strong></span>
      <span><strong>${critCount}</strong> critical</span>
      ${totalHours ? `<span><strong>${totalHours.toLocaleString()}</strong> labour hrs</span>` : ''}
    `
    el.appendChild(stats)

    // ---- split: table + timeline
    const split = document.createElement('div')
    split.className = 'prog-split'
    el.appendChild(split)

    const trades = [...new Set(prog.tasks.map(t => t.trade).filter(Boolean))] as string[]

    // table
    const table = document.createElement('table')
    table.className = 'prog-table'
    table.innerHTML = `
      <thead><tr>
        <th class="pc-num">#</th><th class="pc-name">Task</th><th class="pc-trade">Trade</th>
        <th class="pc-dur">Dur</th><th class="pc-pred">Preds</th>
        <th class="pc-date">Start</th><th class="pc-date">Finish</th><th class="pc-hrs">Hrs</th><th class="pc-x"></th>
      </tr></thead>
    `
    const tbody = document.createElement('tbody')
    prog.tasks.forEach((t, i) => {
      const s = sched.get(t.id)!
      const tr = document.createElement('tr')
      if (s.critical) tr.classList.add('prog-crit-row')
      if (t.duration === 0) tr.classList.add('prog-ms-row')
      const cellInput = (value: string, cls: string, aria: string, onChange: (v: string) => boolean) => {
        const td = document.createElement('td')
        td.className = cls
        const inp = document.createElement('input')
        inp.value = value
        inp.setAttribute('aria-label', `${aria} — row ${i + 1}`)
        inp.addEventListener('change', () => {
          if (!onChange(inp.value)) { inp.classList.add('prog-bad'); setTimeout(() => inp.classList.remove('prog-bad'), 1200) }
          else { scheduleSave(); drawEditor() }
        })
        td.appendChild(inp)
        return td
      }
      const num = document.createElement('td')
      num.className = 'pc-num'
      num.textContent = String(i + 1)
      tr.appendChild(num)
      tr.appendChild(cellInput(t.name, 'pc-name', 'Task name', v => { if (!v.trim()) return false; t.name = v.trim(); return true }))
      tr.appendChild(cellInput(t.trade ?? '', 'pc-trade', 'Trade', v => { t.trade = v.trim() || undefined; return true }))
      tr.appendChild(cellInput(String(t.duration), 'pc-dur', 'Duration (working days)', v => {
        const n = Math.round(Number(v))
        if (!Number.isFinite(n) || n < 0) return false
        t.duration = n
        return true
      }))
      tr.appendChild(cellInput(depsToText(t, prog!.tasks), 'pc-pred', 'Predecessors', v => {
        const deps = textToDeps(v, prog!.tasks)
        if (deps === null) return false
        if (deps.some(d => d.id === t.id)) return false
        t.deps = deps
        return true
      }))
      const startTd = document.createElement('td')
      startTd.className = 'pc-date'
      startTd.textContent = fmtAU(s.esDate)
      const finTd = document.createElement('td')
      finTd.className = 'pc-date'
      finTd.textContent = t.duration === 0 ? '◆' : fmtAU(s.efDate)
      tr.append(startTd, finTd)
      tr.appendChild(cellInput(t.hours ? String(t.hours) : '', 'pc-hrs', 'Labour hours', v => {
        if (!v.trim()) { t.hours = undefined; return true }
        const n = Number(v)
        if (!Number.isFinite(n) || n < 0) return false
        t.hours = Math.round(n)
        return true
      }))
      const xTd = document.createElement('td')
      xTd.className = 'pc-x'
      const del = document.createElement('button')
      del.textContent = '✕'
      del.setAttribute('aria-label', `Delete row ${i + 1}`)
      armTwice(del, '?', () => {
        if (!prog) return
        prog.tasks = prog.tasks.filter(x => x.id !== t.id)
        for (const other of prog.tasks) other.deps = other.deps.filter(d => d.id !== t.id)
        scheduleSave()
        drawEditor()
      })
      xTd.appendChild(del)
      tr.appendChild(xTd)
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    const tableWrap = document.createElement('div')
    tableWrap.className = 'prog-table-wrap'
    tableWrap.appendChild(table)
    split.appendChild(tableWrap)

    // timeline
    split.appendChild(renderTimeline(prog, sched, trades))
  }

  function renderTimeline(p: Programme, sched: Map<string, ScheduledTask>, trades: string[]): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'prog-gantt-wrap'

    // calendar-day axis from possession to finish (+3 days tail)
    const startD = parseDate(p.startDate)
    let endDate = startD
    for (const s of sched.values()) {
      const d = parseDate(s.efDate)
      if (d > endDate) endDate = d
    }
    const days: Date[] = []
    for (let d = new Date(startD); d <= endDate || days.length < 7; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d))
      if (days.length > 500) break
    }
    for (let i = 0; i < 3; i++) {
      const d = new Date(days[days.length - 1]); d.setDate(d.getDate() + 1); days.push(d)
    }
    const calIdx = new Map(days.map((d, i) => [fmtDate(d), i]))

    const width = days.length * DAY_W
    const height = HEADER_H + p.tasks.length * ROW_H + 8
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('class', 'prog-gantt')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', `Gantt chart for ${p.title}`)

    const rect = (x: number, y: number, w: number, h: number, cls: string, fill?: string) => {
      const r = document.createElementNS(NS, 'rect')
      r.setAttribute('x', String(x)); r.setAttribute('y', String(y))
      r.setAttribute('width', String(w)); r.setAttribute('height', String(h))
      r.setAttribute('class', cls)
      if (fill) r.setAttribute('fill', fill)
      svg.appendChild(r)
      return r
    }
    const text = (x: number, y: number, s: string, cls: string, anchor = 'start') => {
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', String(x)); t.setAttribute('y', String(y))
      t.setAttribute('class', cls); t.setAttribute('text-anchor', anchor)
      t.textContent = s
      svg.appendChild(t)
      return t
    }

    // weekend/holiday shading + month labels
    let lastMonth = -1
    days.forEach((d, i) => {
      if (!isWorkDay(d, p.calendar)) rect(i * DAY_W, HEADER_H, DAY_W, height - HEADER_H, 'pg-offday')
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth()
        text(i * DAY_W + 3, 14, d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }), 'pg-month')
      }
      if (d.getDay() === 1) { // Monday: week tick + date label
        rect(i * DAY_W, 20, 1, height - 20, 'pg-weekline')
        text(i * DAY_W + 3, 34, `${d.getDate()}/${d.getMonth() + 1}`, 'pg-day')
      }
    })

    // today line
    const todayIdx = calIdx.get(fmtDate(new Date()))
    if (todayIdx !== undefined) rect(todayIdx * DAY_W, 20, 2, height - 20, 'pg-today')

    // bars
    p.tasks.forEach((t, row) => {
      const s = sched.get(t.id)!
      const y = HEADER_H + row * ROW_H
      rect(0, y, width, ROW_H, row % 2 ? 'pg-rowband' : 'pg-rowband-alt')
      const x0 = (calIdx.get(s.esDate) ?? 0) * DAY_W
      if (t.duration === 0) {
        const d = document.createElementNS(NS, 'path')
        const cx = x0 + DAY_W / 2, cy = y + ROW_H / 2, r = 7
        d.setAttribute('d', `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`)
        d.setAttribute('class', 'pg-milestone')
        svg.appendChild(d)
        text(x0 + DAY_W + 4, y + ROW_H / 2 + 4, t.name, 'pg-mslabel')
      } else {
        const x1 = ((calIdx.get(s.efDate) ?? 0) + 1) * DAY_W
        const bar = rect(x0, y + 6, Math.max(DAY_W / 2, x1 - x0), ROW_H - 12, s.critical ? 'pg-bar pg-crit' : 'pg-bar', tradeColour(t.trade, trades))
        const tip = document.createElementNS(NS, 'title')
        tip.textContent = `${t.name} — ${fmtAU(s.esDate)} → ${fmtAU(s.efDate)} (${t.duration}d${s.tf > 0 ? `, float ${s.tf}d` : ', critical'})${t.nightWork ? ' · night work' : ''}`
        bar.appendChild(tip)
        if (t.nightWork) rect(x0, y + 6, Math.max(DAY_W / 2, x1 - x0), 3, 'pg-night')
      }
    })

    wrap.appendChild(svg)
    return wrap
  }

  drawList()
}
