// Programme — construction Gantt. G1: templates, task table with inline
// editing, computed CPM dates, static SVG timeline (critical path coloured,
// weekends shaded, milestones as diamonds). Interactions (drag/link) are G2.
import { schedule, projectSpan, parseDate, fmtDate, isWorkDay, minusCalendarDays, CycleError, type ScheduledTask } from './cpm'
import {
  type Programme, templates, scaleDurations,
  loadProgrammes, persistProgramme, removeProgramme,
  pid, depsToText, textToDeps,
} from './programme-model'

const ZOOMS = [10, 20, 34]              // month / week / day feel
const ROW_H = 30
const HEADER_H = 44
const HIST_H = 64

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
  let zoom = 1                          // index into ZOOMS
  let showFloat = false

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
    const zoomOut = document.createElement('button')
    zoomOut.className = 'prog-tb'
    zoomOut.textContent = '−'
    zoomOut.setAttribute('aria-label', 'Zoom out')
    zoomOut.disabled = zoom === 0
    zoomOut.addEventListener('click', () => { zoom = Math.max(0, zoom - 1); drawEditor() })
    const zoomIn = document.createElement('button')
    zoomIn.className = 'prog-tb'
    zoomIn.textContent = '＋'
    zoomIn.setAttribute('aria-label', 'Zoom in')
    zoomIn.disabled = zoom === ZOOMS.length - 1
    zoomIn.addEventListener('click', () => { zoom = Math.min(ZOOMS.length - 1, zoom + 1); drawEditor() })
    const floatBtn = document.createElement('button')
    floatBtn.className = 'prog-tb'
    floatBtn.textContent = showFloat ? 'float: on' : 'float: off'
    floatBtn.title = 'Show total float whiskers'
    floatBtn.addEventListener('click', () => { showFloat = !showFloat; drawEditor() })
    const addBtn = document.createElement('button')
    addBtn.className = 'prog-tb'
    addBtn.textContent = '＋ task'
    addBtn.addEventListener('click', () => {
      if (!prog) return
      prog.tasks.push({ id: pid(), name: 'New task', duration: 1, deps: [] })
      scheduleSave()
      drawEditor()
    })
    bar.append(back, title, start, sat, spacer, zoomOut, zoomIn, floatBtn, addBtn)
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

    // procurement panel
    const procured = prog.tasks.filter(t => t.procurement)
    if (procured.length) {
      const card = document.createElement('div')
      card.className = 'prog-card'
      card.innerHTML = '<div class="prog-card-title">PROCUREMENT — ORDER-BY DATES</div>'
      const tbl = document.createElement('table')
      tbl.className = 'prog-proc'
      tbl.innerHTML = '<thead><tr><th>Item</th><th>Category</th><th>Lead</th><th>On site</th><th>Order by</th><th></th></tr></thead>'
      const tb = document.createElement('tbody')
      const todayStr = fmtDate(new Date())
      for (const t of procured) {
        const s = sched.get(t.id)!
        const orderBy = fmtDate(minusCalendarDays(parseDate(s.esDate), t.procurement!.leadDays))
        const late = orderBy < todayStr
        const tr = document.createElement('tr')
        const cells = [t.name, t.procurement!.category, `${t.procurement!.leadDays}d`, fmtAU(s.esDate), fmtAU(orderBy)]
        for (const c of cells) {
          const td = document.createElement('td')
          td.textContent = c
          tr.appendChild(td)
        }
        const flag = document.createElement('td')
        flag.innerHTML = late ? '<span class="prog-late">order now</span>' : (s.critical ? '<span class="prog-critchip">critical</span>' : '')
        tr.appendChild(flag)
        tb.appendChild(tr)
      }
      tbl.appendChild(tb)
      card.appendChild(tbl)
      el.appendChild(card)
    }
  }

  function renderTimeline(p: Programme, sched: Map<string, ScheduledTask>, trades: string[]): HTMLElement {
    const DAY_W = ZOOMS[zoom]
    const wrap = document.createElement('div')
    wrap.className = 'prog-gantt-wrap'

    // calendar-day axis from possession to finish (+3 days tail)
    const startD = parseDate(p.startDate)
    let endDate = startD
    for (const s of sched.values()) {
      const d = parseDate(s.efDate)
      if (d > endDate) endDate = d
    }
    for (const s of sched.values()) {
      const d = parseDate(s.lfDate)
      if (showFloat && d > endDate) endDate = d
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
    const rowOf = new Map(p.tasks.map((t, i) => [t.id, i]))

    // weekly labour totals (hours spread evenly over each task's working days)
    const weekHours = new Map<number, number>()   // Monday calIdx → hours
    const mondayOf = (i: number) => { let j = i; while (j > 0 && days[j].getDay() !== 1) j--; return j }
    for (const t of p.tasks) {
      if (!t.hours || t.duration === 0) continue
      const s = sched.get(t.id)!
      const from = calIdx.get(s.esDate) ?? 0
      const to = calIdx.get(s.efDate) ?? from
      const workIdxs: number[] = []
      for (let i = from; i <= to && i < days.length; i++) if (isWorkDay(days[i], p.calendar)) workIdxs.push(i)
      const per = t.hours / Math.max(1, workIdxs.length)
      for (const i of workIdxs) {
        const wk = mondayOf(i)
        weekHours.set(wk, (weekHours.get(wk) ?? 0) + per)
      }
    }
    const maxWeek = Math.max(1, ...weekHours.values())
    const hasHours = weekHours.size > 0

    const width = days.length * DAY_W
    const barsBottom = HEADER_H + p.tasks.length * ROW_H
    const height = barsBottom + (hasHours ? HIST_H : 0) + 8
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('class', 'prog-gantt')
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

    // weekend/holiday shading + month labels + week ticks
    let lastMonth = -1
    days.forEach((d, i) => {
      if (!isWorkDay(d, p.calendar)) rect(i * DAY_W, HEADER_H, DAY_W, height - HEADER_H, 'pg-offday')
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth()
        text(i * DAY_W + 3, 14, d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }), 'pg-month')
      }
      if (d.getDay() === 1) {
        rect(i * DAY_W, 20, 1, height - 20, 'pg-weekline')
        if (DAY_W >= 14 || d.getDate() <= 7) text(i * DAY_W + 3, 34, `${d.getDate()}/${d.getMonth() + 1}`, 'pg-day')
      }
    })

    // phase brackets (consecutive runs of the same phase)
    let runStart = 0
    for (let i = 1; i <= p.tasks.length; i++) {
      const prev = p.tasks[i - 1]?.phase
      if (i === p.tasks.length || p.tasks[i].phase !== prev) {
        if (prev) {
          const runTasks = p.tasks.slice(runStart, i)
          const es = Math.min(...runTasks.map(t => calIdx.get(sched.get(t.id)!.esDate) ?? 0))
          const ef = Math.max(...runTasks.map(t => calIdx.get(sched.get(t.id)!.efDate) ?? 0))
          const y = HEADER_H + runStart * ROW_H + 2
          rect(es * DAY_W, y, (ef - es + 1) * DAY_W, 3, 'pg-phase')
          text(es * DAY_W + 2, y + 11, prev, 'pg-phaselabel')
        }
        runStart = i
      }
    }

    const todayIdx = calIdx.get(fmtDate(new Date()))
    if (todayIdx !== undefined) rect(todayIdx * DAY_W, 20, 2, barsBottom - 20, 'pg-today')

    // dependency arrows (under bars so bar drags stay clean)
    const barX = (id: string) => {
      const s = sched.get(id)!
      const x0 = (calIdx.get(s.esDate) ?? 0) * DAY_W
      const x1 = ((calIdx.get(s.efDate) ?? 0) + 1) * DAY_W
      return { x0, x1: Math.max(x0 + DAY_W / 2, x1) }
    }
    for (const t of p.tasks) {
      const toRow = rowOf.get(t.id)!
      for (const dep of t.deps) {
        const fromRow = rowOf.get(dep.id)
        if (fromRow === undefined) continue
        const from = barX(dep.id), to = barX(t.id)
        const y1 = HEADER_H + fromRow * ROW_H + ROW_H / 2
        const y2 = HEADER_H + toRow * ROW_H + ROW_H / 2
        const sx = dep.type === 'SS' ? from.x0 : from.x1
        const ex = dep.type === 'FF' ? to.x1 : to.x0
        const path = document.createElementNS(NS, 'path')
        const midX = dep.type === 'FF' ? Math.max(sx, ex) + 8 : Math.min(sx + 8, ex - 8)
        path.setAttribute('d', `M ${sx} ${y1} H ${midX} V ${y2} H ${ex}`)
        path.setAttribute('class', 'pg-link')
        path.dataset.task = t.id
        path.dataset.pred = dep.id
        svg.appendChild(path)
        const head = document.createElementNS(NS, 'path')
        const dir = dep.type === 'FF' ? -1 : 1
        head.setAttribute('d', `M ${ex} ${y2} l ${-5 * dir} -4 v 8 Z`)
        head.setAttribute('class', 'pg-linkhead')
        svg.appendChild(head)
      }
    }

    // bars + interactions
    p.tasks.forEach((t, row) => {
      const s = sched.get(t.id)!
      const y = HEADER_H + row * ROW_H
      rect(0, y, width, ROW_H, row % 2 ? 'pg-rowband' : 'pg-rowband-alt')
      const { x0, x1 } = barX(t.id)

      if (showFloat && s.tf > 0 && t.duration > 0) {
        const lfX = ((calIdx.get(s.lfDate) ?? 0) + 1) * DAY_W
        rect(x1, y + ROW_H / 2 - 1, Math.max(0, lfX - x1), 2, 'pg-float')
      }

      if (t.duration === 0) {
        const d = document.createElementNS(NS, 'path')
        const cx = x0 + DAY_W / 2, cy = y + ROW_H / 2, r = 7
        d.setAttribute('d', `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`)
        d.setAttribute('class', 'pg-milestone')
        svg.appendChild(d)
        text(x0 + DAY_W + 4, y + ROW_H / 2 + 4, t.name, 'pg-mslabel')
        return
      }

      const barW = Math.max(DAY_W / 2, x1 - x0)
      const bar = rect(x0, y + 6, barW, ROW_H - 12, s.critical ? 'pg-bar pg-crit' : 'pg-bar', tradeColour(t.trade, trades))
      bar.dataset.id = t.id
      const tip = document.createElementNS(NS, 'title')
      tip.textContent = `${t.name} — ${fmtAU(s.esDate)} → ${fmtAU(s.efDate)} (${t.duration}d${s.tf > 0 ? `, float ${s.tf}d` : ', critical'})${t.nightWork ? ' · night work' : ''}${t.constraint ? ' · pinned' : ''}`
      bar.appendChild(tip)
      if (t.nightWork) rect(x0, y + 6, barW, 3, 'pg-night')
      if (t.constraint) text(x0 - 4, y + ROW_H / 2 + 4, '📌', 'pg-pin', 'end')

      // resize handle + link handle
      const rh = rect(x0 + barW - 5, y + 6, 8, ROW_H - 12, 'pg-handle')
      rh.dataset.resize = t.id
      const lh = document.createElementNS(NS, 'circle')
      lh.setAttribute('cx', String(x0 + barW + 7)); lh.setAttribute('cy', String(y + ROW_H / 2)); lh.setAttribute('r', '5')
      lh.setAttribute('class', 'pg-linkdot')
      lh.dataset.link = t.id
      svg.appendChild(lh)
    })

    // labour histogram
    if (hasHours) {
      const hy = barsBottom + 4
      text(4, hy + 10, 'labour hrs / week', 'pg-day')
      for (const [wk, hrs] of weekHours) {
        const h = Math.max(2, (hrs / maxWeek) * (HIST_H - 18))
        const wkEnd = Math.min(wk + 7, days.length)
        const bar = rect(wk * DAY_W + 1, hy + (HIST_H - 4) - h, (wkEnd - wk) * DAY_W - 2, h, 'pg-hist')
        const tip = document.createElementNS(NS, 'title')
        tip.textContent = `w/c ${fmtAU(fmtDate(days[wk]))}: ${Math.round(hrs)} hrs`
        bar.appendChild(tip)
      }
    }

    // ---- drag interactions ----------------------------------------------------
    let drag: { kind: 'move' | 'resize' | 'link'; id: string; startX: number; startY: number; el: SVGGraphicsElement; moved: boolean } | null = null
    let ghost: SVGRectElement | null = null
    let linkLine: SVGLineElement | null = null

    const svgPoint = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    svg.addEventListener('pointerdown', (e) => {
      const target = e.target as SVGGraphicsElement
      const pt = svgPoint(e)
      if (target.dataset.resize) drag = { kind: 'resize', id: target.dataset.resize, startX: pt.x, startY: pt.y, el: target, moved: false }
      else if (target.dataset.link) drag = { kind: 'link', id: target.dataset.link, startX: pt.x, startY: pt.y, el: target, moved: false }
      else if (target.dataset.id) drag = { kind: 'move', id: target.dataset.id, startX: pt.x, startY: pt.y, el: target, moved: false }
      if (drag) { svg.setPointerCapture(e.pointerId); e.preventDefault() }
    })

    svg.addEventListener('pointermove', (e) => {
      if (!drag) return
      const pt = svgPoint(e)
      const dx = pt.x - drag.startX
      if (Math.abs(dx) + Math.abs(pt.y - drag.startY) > 3) drag.moved = true
      if (!drag.moved) return
      if (drag.kind === 'move' || drag.kind === 'resize') {
        if (!ghost) {
          ghost = document.createElementNS(NS, 'rect') as SVGRectElement
          const src = svg.querySelector<SVGRectElement>(`rect[data-id="${drag.id}"]`)!
          for (const a of ['x', 'y', 'width', 'height']) ghost.setAttribute(a, src.getAttribute(a)!)
          ghost.setAttribute('class', 'pg-ghostbar')
          svg.appendChild(ghost)
        }
        const src = svg.querySelector<SVGRectElement>(`rect[data-id="${drag.id}"]`)!
        const days0 = Math.round(dx / DAY_W)
        if (drag.kind === 'move') ghost.setAttribute('x', String(Number(src.getAttribute('x')) + days0 * DAY_W))
        else ghost.setAttribute('width', String(Math.max(DAY_W / 2, Number(src.getAttribute('width')) + days0 * DAY_W)))
      } else {
        if (!linkLine) {
          linkLine = document.createElementNS(NS, 'line') as SVGLineElement
          linkLine.setAttribute('class', 'pg-linkdraft')
          linkLine.setAttribute('x1', String(drag.startX)); linkLine.setAttribute('y1', String(drag.startY))
          svg.appendChild(linkLine)
        }
        linkLine.setAttribute('x2', String(pt.x)); linkLine.setAttribute('y2', String(pt.y))
      }
    })

    svg.addEventListener('pointerup', (e) => {
      if (!drag || !prog) { drag = null; return }
      const pt = svgPoint(e)
      const dx = pt.x - drag.startX
      const dayDelta = Math.round(dx / DAY_W)
      const t = prog.tasks.find(x => x.id === drag!.id)
      const cleanup = () => { ghost?.remove(); ghost = null; linkLine?.remove(); linkLine = null; drag = null }

      if (!drag.moved || !t) { cleanup(); return }

      if (drag.kind === 'move' && dayDelta !== 0) {
        const s = sched.get(t.id)!
        const curIdx = calIdx.get(s.esDate) ?? 0
        const target = days[Math.max(0, Math.min(days.length - 1, curIdx + dayDelta))]
        const prev = t.constraint
        t.constraint = { type: 'SNET', date: fmtDate(target) }
        try { schedule(prog.tasks, prog.startDate, prog.calendar) } catch { t.constraint = prev }
        scheduleSave()
        drawEditor()
      } else if (drag.kind === 'resize' && dayDelta !== 0) {
        // duration delta = working days covered by the calendar-day delta
        const s = sched.get(t.id)!
        const efIdx = calIdx.get(s.efDate) ?? 0
        let wd = 0
        if (dayDelta > 0) for (let i = efIdx + 1; i <= Math.min(days.length - 1, efIdx + dayDelta); i++) { if (isWorkDay(days[i], prog.calendar)) wd++ }
        else for (let i = efIdx; i > Math.max(0, efIdx + dayDelta); i--) { if (isWorkDay(days[i], prog.calendar)) wd-- }
        t.duration = Math.max(1, t.duration + wd)
        scheduleSave()
        drawEditor()
      } else if (drag.kind === 'link') {
        const targetBar = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGRectElement>('rect[data-id]')
        const succId = targetBar?.dataset.id
        if (succId && succId !== t.id) {
          const succ = prog.tasks.find(x => x.id === succId)!
          if (!succ.deps.some(d => d.id === t.id)) {
            succ.deps.push({ id: t.id, type: 'FS', lag: 0 })
            try {
              schedule(prog.tasks, prog.startDate, prog.calendar)
              scheduleSave()
            } catch (err) {
              succ.deps = succ.deps.filter(d => d.id !== t.id)
              if (err instanceof CycleError) toast('That link would create a loop')
            }
          }
          drawEditor()
        }
      }
      cleanup()
    })

    // click a link path → edit type/lag or delete
    svg.addEventListener('click', (e) => {
      const path = (e.target as Element).closest<SVGPathElement>('path.pg-link')
      if (!path || !prog) return
      const t = prog.tasks.find(x => x.id === path.dataset.task)
      const dep = t?.deps.find(d => d.id === path.dataset.pred)
      if (!t || !dep) return
      openLinkEditor(e.clientX, e.clientY, t, dep)
    })

    function openLinkEditor(cx: number, cy: number, t: { name: string; deps: { id: string; type: string; lag: number }[] }, dep: { id: string; type: string; lag: number }) {
      document.querySelector('.prog-linkedit')?.remove()
      const box = document.createElement('div')
      box.className = 'prog-linkedit'
      box.style.left = `${cx + 6}px`
      box.style.top = `${cy + 6}px`
      const sel = document.createElement('select')
      for (const ty of ['FS', 'SS', 'FF']) {
        const o = document.createElement('option')
        o.value = ty; o.textContent = ty; o.selected = dep.type === ty
        sel.appendChild(o)
      }
      const lag = document.createElement('input')
      lag.type = 'number'; lag.value = String(dep.lag); lag.step = '1'
      lag.setAttribute('aria-label', 'Lag (working days)')
      const ok = document.createElement('button')
      ok.textContent = '✓'
      ok.addEventListener('click', () => {
        dep.type = sel.value as 'FS' | 'SS' | 'FF'
        dep.lag = Math.round(Number(lag.value)) || 0
        box.remove()
        scheduleSave()
        drawEditor()
      })
      const del = document.createElement('button')
      del.textContent = 'unlink'
      del.addEventListener('click', () => {
        t.deps = t.deps.filter(d => d !== dep)
        box.remove()
        scheduleSave()
        drawEditor()
      })
      const close = document.createElement('button')
      close.textContent = '✕'
      close.addEventListener('click', () => box.remove())
      box.append(sel, lag, ok, del, close)
      document.body.appendChild(box)
      lag.focus()
    }

    wrap.appendChild(svg)
    // keep the possession end in view on first paint
    requestAnimationFrame(() => { wrap.scrollLeft = 0 })
    return wrap
  }

  drawList()
}
