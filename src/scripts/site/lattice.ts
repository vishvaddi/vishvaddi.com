// Site host for the shared Lattice view (lattice-view.ts, byte-identical with
// vvDeck's copy). This wrapper owns only what differs per host: localStorage
// persistence and the toast implementation.
import type { LatticeSheet } from './lattice-model'
import { createLatticeView } from './lattice-view'

const LS_KEY = 'lattice_sheets_v1'

export function loadAll(): LatticeSheet[] {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as LatticeSheet[]
    return all.sort((a, b) => b.updated - a.updated)
  } catch { return [] }
}

function persist(sheet: LatticeSheet): void {
  const all = loadAll().filter(s => s.id !== sheet.id)
  all.unshift(sheet)
  localStorage.setItem(LS_KEY, JSON.stringify(all))
}

export function remove(id: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadAll().filter(s => s.id !== id)))
}

function toast(msg: string): void {
  const t = document.createElement('div')
  t.className = 'lat-toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 1800)
}

export function initLattice(el: HTMLElement): void {
  createLatticeView(el, { loadAll, persist, remove, toast })
}
