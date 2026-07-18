// Arrangement timeline (C5) — Ableton-Arrangement-style: a bar ruler with a
// loop brace, three track rows, scene-coloured blocks placed on a shared
// timeline. Drag moves (bar snap), right-edge drag resizes, double-click on
// empty space places the selected scene, ✕/Del removes, ruler click sets the
// song position. Replaces the old sequential "+ Block" lanes.
import { el, btn, help } from "./helpers";
import {
  TRACKS, TRACK_LABELS, SCENE_LABELS, clip,
  arrangement, songPos, songLoop, songEndBar,
} from "./state";
import type { ArrangeBlock, TrackId } from "./state";
import { saveAll } from "./persistence";
import { ctx, playhead, SCENE_COLORS } from "./ctx";

export interface ArrangeUI {
  host: HTMLElement;
  paintArrange: () => void;
  paintPlayhead: () => void;
}

const ROW_H = 34;

export function buildArrange(): ArrangeUI {
  const host = el("div", "wa-arrange-lanes wa-tl");
  let pxPerBar = 44;
  let selected: { track: TrackId; block: ArrangeBlock } | null = null;

  const toolbar = el("div", "wa-tl-toolbar");
  const zoomOut = btn("−", "wa-btn-sm"), zoomIn = btn("+", "wa-btn-sm");
  const loopBtn = btn("Loop", "wa-toggle wa-btn-sm");
  help(zoomOut, "Zoom the timeline out."); help(zoomIn, "Zoom the timeline in.");
  help(loopBtn, "Loop the braced region while the song plays. Drag on the ruler to set the region.");
  const posOut = el("span", "wa-status", "Bar 1");
  toolbar.append(loopBtn, zoomOut, zoomIn, posOut,
    el("span", "wa-lbl", "double-click a lane to place the selected scene · drag to move · edge to resize"));

  const scroller = el("div", "wa-tl-scroll");
  const inner = el("div", "wa-tl-inner");
  const ruler = el("div", "wa-tl-ruler");
  const loopBrace = el("div", "wa-tl-loop");
  const playline = el("div", "wa-tl-playline");
  ruler.append(loopBrace);
  inner.append(ruler);
  const rows = new Map<TrackId, HTMLElement>();
  TRACKS.forEach((track) => {
    const row = el("div", "wa-tl-row");
    row.dataset.track = track;
    rows.set(track, row);
    inner.append(row);
  });
  inner.append(playline);
  scroller.append(inner);

  const labels = el("div", "wa-tl-labels");
  labels.append(el("div", "wa-tl-label", ""));
  TRACKS.forEach((track) => labels.append(el("div", "wa-tl-label", TRACK_LABELS[track])));
  const body = el("div", "wa-tl-body");
  body.append(labels, scroller);
  host.append(toolbar, body);

  const viewBars = (): number => Math.max(16, songEndBar() + 8, songLoop.on ? songLoop.endBar + 4 : 0);
  const barAt = (clientX: number): number => {
    const rect = inner.getBoundingClientRect();
    return Math.max(0, Math.floor((clientX - rect.left) / pxPerBar));
  };

  function paintArrange(): void {
    const total = viewBars();
    inner.style.width = `${total * pxPerBar}px`;
    // ruler cells
    ruler.querySelectorAll(".wa-tl-tick").forEach((n) => n.remove());
    for (let b = 0; b < total; b++) {
      const tick = el("div", "wa-tl-tick" + (b % 4 === 0 ? " major" : ""));
      tick.style.left = `${b * pxPerBar}px`;
      if (b % 4 === 0) tick.textContent = String(b + 1);
      ruler.append(tick);
    }
    loopBrace.style.display = songLoop.on ? "" : "none";
    loopBrace.style.left = `${songLoop.startBar * pxPerBar}px`;
    loopBrace.style.width = `${Math.max(1, songLoop.endBar - songLoop.startBar) * pxPerBar}px`;
    loopBtn.classList.toggle("active", songLoop.on);
    // blocks
    TRACKS.forEach((track) => {
      const row = rows.get(track)!;
      row.replaceChildren();
      arrangement[track].forEach((block) => {
        const chip = el("div", "wa-tl-block");
        chip.style.left = `${block.startBar * pxPerBar}px`;
        chip.style.width = `${block.bars * pxPerBar - 2}px`;
        chip.style.setProperty("--scene-color", SCENE_COLORS[block.scene]);
        chip.classList.toggle("sel", selected?.block === block);
        chip.append(el("span", "wa-tl-block-label", SCENE_LABELS[block.scene]));
        help(chip, `${TRACK_LABELS[track]} · scene ${SCENE_LABELS[block.scene]} · bars ${block.startBar + 1}–${block.startBar + block.bars}. Drag to move, right edge to resize, ✕ or Del to remove, right-click to change scene.`);
        const removeBtn = el("button", "wa-tl-block-x") as HTMLButtonElement;
        removeBtn.type = "button"; removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ctx.checkpoint();
          arrangement[track] = arrangement[track].filter((b) => b !== block);
          if (selected?.block === block) selected = null;
          saveAll(); paintArrange();
        });
        chip.append(removeBtn);
        chip.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault(); ev.stopPropagation();
          selected = { track, block };
          const rect = chip.getBoundingClientRect();
          const resizing = ev.clientX > rect.right - 10;
          const startX = ev.clientX, origStart = block.startBar, origBars = block.bars;
          ctx.checkpoint();
          const onMove = (mv: PointerEvent) => {
            const dBars = Math.round((mv.clientX - startX) / pxPerBar);
            if (resizing) block.bars = Math.max(1, Math.min(128, origBars + dBars));
            else block.startBar = Math.max(0, origStart + dBars);
            chip.style.left = `${block.startBar * pxPerBar}px`;
            chip.style.width = `${block.bars * pxPerBar - 2}px`;
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            saveAll(); paintArrange();
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        });
        chip.addEventListener("contextmenu", (ev) => {
          // right-click cycles the block through the scenes — quick reassign
          ev.preventDefault();
          ctx.checkpoint();
          block.scene = (block.scene + 1) % SCENE_LABELS.length;
          saveAll(); paintArrange();
        });
        row.append(chip);
      });
    });
    paintPlayhead();
  }

  function paintPlayhead(): void {
    const frac = playhead.playing ? playhead.schStep / 16 : 0;
    playline.style.left = `${(songPos.bar + frac) * pxPerBar}px`;
    playline.classList.toggle("on", playhead.playing);
    posOut.textContent = `Bar ${songPos.bar + 1}`;
  }

  // double-click empty lane space places the selected scene (4 bars)
  TRACKS.forEach((track) => {
    rows.get(track)!.addEventListener("dblclick", (ev) => {
      const bar = barAt((ev as MouseEvent).clientX);
      ctx.checkpoint();
      arrangement[track].push({ scene: clip.sel, bars: 4, startBar: bar });
      saveAll(); paintArrange();
    });
  });

  // ruler: click sets the song position; drag sets the loop region
  ruler.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const startBar = barAt(ev.clientX);
    let dragged = false;
    const onMove = (mv: PointerEvent) => {
      const cur = barAt(mv.clientX);
      if (cur !== startBar || dragged) {
        dragged = true;
        songLoop.on = true;
        songLoop.startBar = Math.min(startBar, cur);
        songLoop.endBar = Math.max(startBar, cur) + 1;
        paintArrange();
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragged) { songPos.bar = startBar; paintPlayhead(); }
      saveAll();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  loopBtn.addEventListener("click", () => { songLoop.on = !songLoop.on; saveAll(); paintArrange(); });
  zoomIn.addEventListener("click", () => { pxPerBar = Math.min(120, pxPerBar * 1.4); paintArrange(); });
  zoomOut.addEventListener("click", () => { pxPerBar = Math.max(14, pxPerBar / 1.4); paintArrange(); });

  window.addEventListener("keydown", (ev) => {
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    if (!selected || !host.offsetParent) return;
    ev.preventDefault();
    ctx.checkpoint();
    arrangement[selected.track] = arrangement[selected.track].filter((b) => b !== selected!.block);
    selected = null;
    saveAll(); paintArrange();
  });

  paintArrange();
  return { host, paintArrange, paintPlayhead };
}
