// Piano roll — 3 octaves, notes with length + velocity. Click to add/remove,
// drag right to set length, right-click a note for velocity.
// (DOM-button implementation; Phase 4 replaces this with a canvas editor.)

import { MAX_STEPS, ROLL_NOTES, clip, clipLen, synthNotes } from "./state";
import type { VNote } from "./state";
import { saveAll } from "./persistence";
import { el } from "./helpers";
import { ctx } from "./ctx";

export interface PianoRoll {
  pianoRoll: HTMLElement;
  synthCells: HTMLElement[][];
}

export function buildPianoRoll(audition: (note: string, vel?: number, lenSteps?: number) => void): PianoRoll {
  const pianoRoll = el("div", "wa-piano-roll wa-vroll");
  const synthCells: HTMLElement[][] = [];
  const rollNoteAt = (row: number, step: number): VNote | undefined =>
    synthNotes[clip.sel].find((n) => n.note === ROLL_NOTES[row] && step >= n.step && step < n.step + n.len);
  let dragNote: VNote | null = null, dragRow = -1;
  function paintRoll(): void {
    synthCells.forEach((rowCells, row) => rowCells.forEach((cell, step) => {
      const n = rollNoteAt(row, step);
      cell.classList.toggle("on", !!n && n.step === step);
      cell.classList.toggle("tail", !!n && n.step !== step);
      if (n && n.step === step) ctx.setCellOpacity(cell, n.vel); else cell.style.opacity = "";
    }));
  }
  ctx.paintRoll = paintRoll;
  ROLL_NOTES.forEach((note, r) => {
    const row = el("div", "wa-piano-row" + (note.startsWith("C") && !note.startsWith("C#") ? " wa-roll-oct" : ""));
    row.append(el("span", "wa-piano-note", note));
    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < MAX_STEPS; c++) {
      const cell = el("button", "wa-cell wa-piano-cell" + (c % 4 === 0 ? " wa-beat" : "")) as HTMLButtonElement;
      cell.type = "button";
      cell.title = `${note}, step ${c + 1}`;
      cell.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return; // right-click is velocity, not toggle
        event.preventDefault();
        const existing = rollNoteAt(r, c);
        ctx.checkpoint();
        if (existing) {
          synthNotes[clip.sel] = synthNotes[clip.sel].filter((n) => n !== existing);
        } else {
          const fresh: VNote = { note, step: c, len: 1, vel: 100 };
          synthNotes[clip.sel].push(fresh);
          dragNote = fresh; dragRow = r;
          audition(note, 100, 1);
        }
        paintRoll(); ctx.paintSession(); saveAll();
      });
      cell.addEventListener("pointerenter", () => {
        if (!dragNote || dragRow !== r) return;
        if (c >= dragNote.step) { dragNote.len = Math.min(clipLen[clip.sel].synth - dragNote.step, c - dragNote.step + 1); paintRoll(); }
      });
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const existing = rollNoteAt(r, c); if (!existing) return;
        const origin = synthCells[r][existing.step];
        ctx.showVelocityPopup(existing.vel, (event as MouseEvent).clientX, (event as MouseEvent).clientY, (v) => {
          existing.vel = v; ctx.setCellOpacity(origin, v);
        });
      });
      rowCells.push(cell);
      row.append(cell);
    }
    synthCells.push(rowCells);
    pianoRoll.append(row);
  });
  window.addEventListener("pointerup", () => { if (dragNote) saveAll(); dragNote = null; dragRow = -1; });
  return { pianoRoll, synthCells };
}
