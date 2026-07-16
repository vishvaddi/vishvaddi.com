// Lattice — full nested-grid editor, ported from vvDeck (views/lattice.ts).
// Differences here: localStorage persistence (no IndexedDB dep), inline toast,
// tap-twice destructive confirm (no dialogs), title edits inline. The model
// module is byte-identical to vvDeck's — do not fork it.
import {
  type LatticeSheet, type LatticeGrid, type LatticeCell,
  locate, gridAtPath, setText, insertSubgrid, removeSubgrid,
  insertRow, deleteRow, insertCol, deleteCol, moveCell, rollupLabel,
  fromIndentedText, toIndentedText, fromTSV, toTSV, templateSheets, newSheet,
} from "./lattice-model";

const LS_KEY = "lattice_sheets_v1";
const COLLAPSE_DEPTH = 2;
const UNDO_CAP = 50;

function loadAll(): LatticeSheet[] {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as LatticeSheet[];
    return all.sort((a, b) => b.updated - a.updated);
  } catch { return []; }
}

function persist(sheet: LatticeSheet): void {
  const all = loadAll().filter(s => s.id !== sheet.id);
  all.unshift(sheet);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

function remove(id: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadAll().filter(s => s.id !== id)));
}

function toast(msg: string): void {
  const t = document.createElement("div");
  t.className = "lat-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// Destructive actions confirm by asking twice on the same button — no dialogs.
function armTwice(btn: HTMLButtonElement, label: string, fn: () => void): void {
  btn.addEventListener("click", () => {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = "1";
    const prev = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = prev; }, 2500);
  });
}

export function initLattice(el: HTMLElement): void {
  let sheet: LatticeSheet | null = null;
  let zoomPath: string[] = [];
  let selectedId: string | null = null;
  let editing = false;
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  let saveTimer: number | undefined;

  function scheduleSave() {
    if (!sheet) return;
    sheet.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { if (sheet) persist(sheet); }, 400);
  }

  function snapshot() {
    if (!sheet) return;
    undoStack.push(JSON.stringify(sheet.root));
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!sheet || !undoStack.length) return;
    redoStack.push(JSON.stringify(sheet.root));
    sheet.root = JSON.parse(undoStack.pop()!);
    afterMutate();
  }

  function redo() {
    if (!sheet || !redoStack.length) return;
    undoStack.push(JSON.stringify(sheet.root));
    sheet.root = JSON.parse(redoStack.pop()!);
    afterMutate();
  }

  function afterMutate() {
    if (sheet) {
      const valid: string[] = [];
      let g = sheet.root;
      for (const id of zoomPath) {
        const loc = locate(g, id);
        if (!loc?.cell.grid) break;
        valid.push(id);
        g = loc.cell.grid;
      }
      zoomPath = valid;
    }
    scheduleSave();
    drawEditor();
  }

  function drawList() {
    sheet = null;
    const sheets = loadAll();
    el.innerHTML = "";

    const listCard = document.createElement("div");
    listCard.className = "lat-card";
    const h = document.createElement("div");
    h.className = "lat-card-title";
    h.textContent = "SHEETS";
    listCard.appendChild(h);
    const blurb = document.createElement("p");
    blurb.className = "lat-blurb";
    blurb.textContent = "Grids inside grids — plans, breakdowns, brain dumps. Everything stays in this browser; nothing is uploaded.";
    listCard.appendChild(blurb);

    if (!sheets.length) {
      const empty = document.createElement("p");
      empty.className = "lat-blurb";
      empty.textContent = "No sheets yet — start from a template below.";
      listCard.appendChild(empty);
    }
    for (const s of sheets) {
      const row = document.createElement("div");
      row.className = "lat-sheet-row";
      const open = document.createElement("button");
      open.className = "lat-sheet-open";
      const t = document.createElement("div");
      t.className = "lat-sheet-name";
      t.textContent = s.title;
      const sub = document.createElement("div");
      sub.className = "lat-sheet-sub";
      sub.textContent = `${new Date(s.updated).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} · ${s.root.rows.length}×${s.root.cols}`;
      open.append(t, sub);
      open.addEventListener("click", () => {
        const fresh = loadAll().find(x => x.id === s.id);
        if (fresh) openSheet(fresh);
      });
      const del = document.createElement("button");
      del.className = "lat-del";
      del.setAttribute("aria-label", `Delete ${s.title}`);
      del.textContent = "✕";
      armTwice(del, "sure?", () => { remove(s.id); drawList(); });
      row.append(open, del);
      listCard.appendChild(row);
    }
    el.appendChild(listCard);

    const tplCard = document.createElement("div");
    tplCard.className = "lat-card";
    const th = document.createElement("div");
    th.className = "lat-card-title";
    th.textContent = "NEW SHEET";
    tplCard.appendChild(th);
    const wrap = document.createElement("div");
    wrap.className = "lat-tpl-wrap";
    templateSheets().forEach(tpl => {
      const b = document.createElement("button");
      b.className = "lat-tpl";
      const n = document.createElement("div");
      n.className = "lat-tpl-name";
      n.textContent = tpl.name;
      const d = document.createElement("div");
      d.className = "lat-tpl-blurb";
      d.textContent = tpl.blurb;
      b.append(n, d);
      b.addEventListener("click", () => {
        const s = tpl.make();
        persist(s);
        openSheet(s);
      });
      wrap.appendChild(b);
    });
    tplCard.appendChild(wrap);
    el.appendChild(tplCard);
  }

  function openSheet(s: LatticeSheet) {
    sheet = s;
    zoomPath = [];
    selectedId = null;
    editing = false;
    undoStack = [];
    redoStack = [];
    drawEditor();
  }

  function openLinkedSheet(title: string) {
    clearTimeout(saveTimer);
    if (sheet) persist(sheet);
    const hit = loadAll().find(s => s.title.toLowerCase() === title.trim().toLowerCase());
    if (hit) {
      openSheet(hit);
    } else {
      const s = newSheet(title.trim());
      persist(s);
      openSheet(s);
      toast(`Created "${title.trim()}"`);
    }
  }

  function cellEl(cell: LatticeCell, depth: number): HTMLElement {
    const d = document.createElement("div");
    d.className = "lat-cell";
    d.dataset.id = cell.id;
    if (cell.id === selectedId) d.classList.add("lat-selected");
    if (cell.done) d.classList.add("lat-done");

    const label = rollupLabel(cell);
    if (label) {
      const r = document.createElement("span");
      r.className = "lat-rollup";
      r.textContent = label;
      d.appendChild(r);
    }

    if (cell.text) {
      const t = document.createElement("span");
      t.className = "lat-text";
      if (cell.text.startsWith("=") && typeof cell.num === "number") {
        t.textContent = String(cell.num);
        const f = document.createElement("span");
        f.className = "lat-formula";
        f.textContent = "ƒ";
        f.title = cell.text;
        t.appendChild(f);
      } else {
        const parts = cell.text.split(/(\[\[[^\]]+\]\])/);
        for (const p of parts) {
          const m = /^\[\[([^\]]+)\]\]$/.exec(p);
          if (m) {
            const a = document.createElement("button");
            a.className = "lat-link";
            a.dataset.link = m[1];
            a.textContent = m[1];
            t.appendChild(a);
          } else if (p) {
            t.appendChild(document.createTextNode(p));
          }
        }
      }
      d.appendChild(t);
    }

    if (cell.grid) {
      if (depth < COLLAPSE_DEPTH) {
        d.appendChild(gridEl(cell.grid, depth + 1));
      } else {
        const chip = document.createElement("button");
        chip.className = "lat-chip";
        chip.dataset.zoom = cell.id;
        chip.textContent = `▦ ${cell.grid.rows.length}×${cell.grid.cols}`;
        d.appendChild(chip);
      }
    }
    if (!cell.text && !cell.grid) d.classList.add("lat-empty");
    return d;
  }

  function gridEl(grid: LatticeGrid, depth: number): HTMLElement {
    const g = document.createElement("div");
    g.className = "lat-grid";
    g.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(${depth === 0 ? 72 : 48}px, 1fr))`;
    for (const row of grid.rows) for (const cell of row) g.appendChild(cellEl(cell, depth));
    return g;
  }

  function startEdit(cell: LatticeCell, cellDiv: HTMLElement) {
    if (editing) return;
    editing = true;
    const ta = document.createElement("textarea");
    ta.className = "lat-edit";
    ta.value = cell.text;
    ta.rows = 1;
    cellDiv.querySelector(".lat-text")?.remove();
    cellDiv.classList.remove("lat-empty");
    cellDiv.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
    grow();
    ta.addEventListener("input", grow);

    const commit = () => {
      if (!editing) return;
      editing = false;
      if (sheet && ta.value !== cell.text) {
        snapshot();
        setText(sheet.root, cell.id, ta.value);
        afterMutate();
      } else {
        drawEditor();
      }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); }
      if (e.key === "Escape") { e.preventDefault(); editing = false; drawEditor(); }
    });
  }

  function drawEditor() {
    if (!sheet) return;
    const grid = gridAtPath(sheet.root, zoomPath);
    const crumbs: LatticeCell[] = [];
    {
      let g = sheet.root;
      for (const id of zoomPath) {
        const loc = locate(g, id);
        if (!loc?.cell.grid) break;
        crumbs.push(loc.cell);
        g = loc.cell.grid;
      }
    }

    el.innerHTML = "";

    const bar = document.createElement("div");
    bar.className = "lat-toolbar";
    const back = document.createElement("button");
    back.className = "lat-tb";
    back.id = "lat-back";
    back.setAttribute("aria-label", "All sheets");
    back.textContent = "☰";
    const title = document.createElement("input");
    title.className = "lat-title";
    title.value = sheet.title;
    title.setAttribute("aria-label", "Sheet name");
    title.addEventListener("change", () => {
      if (!sheet) return;
      const v = title.value.trim();
      if (v) { sheet.title = v; scheduleSave(); }
    });
    const spacer = document.createElement("span");
    spacer.className = "lat-spacer";
    const undoB = document.createElement("button");
    undoB.className = "lat-tb";
    undoB.setAttribute("aria-label", "Undo");
    undoB.textContent = "↶";
    undoB.disabled = !undoStack.length;
    undoB.addEventListener("click", undo);
    const redoB = document.createElement("button");
    redoB.className = "lat-tb";
    redoB.setAttribute("aria-label", "Redo");
    redoB.textContent = "↷";
    redoB.disabled = !redoStack.length;
    redoB.addEventListener("click", redo);
    const exportB = document.createElement("button");
    exportB.className = "lat-tb";
    exportB.setAttribute("aria-label", "Export");
    exportB.textContent = "⧉";
    bar.append(back, title, spacer, undoB, redoB, exportB);
    el.appendChild(bar);

    back.addEventListener("click", () => {
      clearTimeout(saveTimer);
      if (sheet) persist(sheet);
      drawList();
    });

    if (zoomPath.length) {
      const bc = document.createElement("div");
      bc.className = "lat-crumbs";
      const rootBtn = document.createElement("button");
      rootBtn.textContent = "⌂";
      rootBtn.setAttribute("aria-label", "Zoom to root");
      rootBtn.addEventListener("click", () => { zoomPath = []; selectedId = null; drawEditor(); });
      bc.appendChild(rootBtn);
      crumbs.forEach((c, i) => {
        const sep = document.createElement("span");
        sep.textContent = "›";
        sep.className = "lat-crumb-sep";
        bc.appendChild(sep);
        const b = document.createElement("button");
        b.textContent = c.text.trim() ? (c.text.length > 18 ? c.text.slice(0, 17) + "…" : c.text) : "▦";
        b.addEventListener("click", () => { zoomPath = zoomPath.slice(0, i + 1); selectedId = null; drawEditor(); });
        bc.appendChild(b);
      });
      el.appendChild(bc);
    }

    const wrap = document.createElement("div");
    wrap.className = "lat-wrap";
    wrap.appendChild(gridEl(grid, 0));
    el.appendChild(wrap);

    const sel = selectedId ? locate(grid, selectedId) : null;
    const act = document.createElement("div");
    act.className = "lat-actions";
    el.appendChild(act);

    exportB.addEventListener("click", () => {
      const existing = el.querySelector("#lat-export");
      if (existing) { existing.remove(); return; }
      const menu = document.createElement("div");
      menu.id = "lat-export";
      menu.className = "lat-actions";
      const src = sel?.cell.grid ?? grid;
      const copyBtn = (label: string, fn: () => string) => {
        const b = document.createElement("button");
        b.className = "lat-tb";
        b.textContent = label;
        b.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(fn()); toast("Copied"); }
          catch { toast("Clipboard blocked"); }
          menu.remove();
        });
        return b;
      };
      menu.appendChild(copyBtn("copy outline", () => toIndentedText(src)));
      menu.appendChild(copyBtn("copy table (TSV)", () => toTSV(src)));
      const dl = document.createElement("button");
      dl.className = "lat-tb";
      dl.textContent = "download JSON";
      dl.addEventListener("click", () => {
        if (!sheet) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" }));
        a.download = `${sheet.title.replace(/[^\w\- ]+/g, "")}.lattice.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        menu.remove();
      });
      menu.appendChild(dl);
      const imp = document.createElement("button");
      imp.className = "lat-tb";
      imp.textContent = "import JSON";
      imp.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", async () => {
          const f = input.files?.[0];
          if (!f) return;
          try {
            const s = JSON.parse(await f.text()) as LatticeSheet;
            if (!s.root?.rows) throw new Error("bad shape");
            s.id = `${s.id}-imp${Date.now().toString(36)}`;
            persist(s);
            openSheet(s);
            toast(`Imported "${s.title}"`);
          } catch { toast("Not a Lattice JSON file"); }
        });
        input.click();
        menu.remove();
      });
      menu.appendChild(imp);
      bar.insertAdjacentElement("afterend", menu);
    });

    if (sel && sheet) {
      const sid = sel.cell.id;
      const mkBtn = (label: string, fn: () => void, aria?: string) => {
        const b = document.createElement("button");
        b.className = "lat-tb";
        b.textContent = label;
        if (aria) b.setAttribute("aria-label", aria);
        b.addEventListener("click", fn);
        act.appendChild(b);
        return b;
      };
      mkBtn(sel.cell.grid ? "▦ open" : "▦ nest", () => {
        if (!sheet) return;
        if (sel.cell.grid) { zoomPath = [...zoomPath, sid]; selectedId = null; drawEditor(); }
        else { snapshot(); insertSubgrid(sheet.root, sid); zoomPath = [...zoomPath, sid]; selectedId = null; afterMutate(); }
      });
      if (sel.cell.grid) {
        mkBtn(sel.cell.rollup ? `agg: ${sel.cell.rollup}` : "agg: off", () => {
          if (!sheet) return;
          snapshot();
          const order: (LatticeCell["rollup"] | undefined)[] = [undefined, "sum", "count", "done-pct"];
          const next = order[(order.indexOf(sel.cell.rollup) + 1) % order.length];
          if (next) sel.cell.rollup = next; else delete sel.cell.rollup;
          afterMutate();
        });
      } else {
        mkBtn(sel.cell.done ? "☑" : "☐", () => {
          if (!sheet) return;
          snapshot();
          sel.cell.done = !sel.cell.done;
          afterMutate();
        }, "Toggle done");
      }
      mkBtn("＋row", () => { snapshot(); insertRow(sel.grid, sel.row + 1); afterMutate(); }, "Add row below");
      mkBtn("＋col", () => { snapshot(); insertCol(sel.grid, sel.col + 1); afterMutate(); }, "Add column right");
      mkBtn("−row", () => { snapshot(); deleteRow(sel.grid, sel.row); selectedId = null; afterMutate(); }, "Delete row");
      mkBtn("−col", () => { snapshot(); deleteCol(sel.grid, sel.col); selectedId = null; afterMutate(); }, "Delete column");
      if (sel.cell.grid) {
        const un = mkBtn("un-nest", () => {}, "Remove nested grid");
        un.classList.add("lat-tb-danger");
        armTwice(un, "sure?", () => {
          if (!sheet) return;
          snapshot();
          removeSubgrid(sheet.root, sid);
          afterMutate();
        });
      }
    } else {
      const hint = document.createElement("div");
      hint.className = "lat-hint";
      hint.textContent = "Tap a cell to select · again to edit · ▦ chip dives in · =12*85 evaluates · [[Sheet]] links · paste a table or indented list onto a cell";
      act.appendChild(hint);
    }

    wrap.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>(".lat-link");
      if (link?.dataset.link) {
        e.stopPropagation();
        openLinkedSheet(link.dataset.link);
        return;
      }
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".lat-chip");
      if (chip?.dataset.zoom) {
        zoomPath = [...zoomPath, chip.dataset.zoom];
        selectedId = null;
        drawEditor();
        return;
      }
      const cd = (e.target as HTMLElement).closest<HTMLElement>(".lat-cell");
      if (!cd?.dataset.id || editing) return;
      if (selectedId === cd.dataset.id) {
        const loc = locate(grid, cd.dataset.id);
        if (loc) startEdit(loc.cell, cd);
      } else {
        selectedId = cd.dataset.id;
        drawEditor();
      }
    });

    wrap.addEventListener("paste", (e) => {
      if (editing || !selectedId || !sheet) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.includes("\n") && !text.includes("\t")) return;
      const parsed = text.includes("\t") ? fromTSV(text) : fromIndentedText(text);
      if (!parsed) return;
      e.preventDefault();
      snapshot();
      const loc = locate(sheet.root, selectedId);
      if (loc) {
        loc.cell.grid = parsed;
        afterMutate();
        toast(text.includes("\t") ? "Table pasted as nested grid" : "Outline pasted as nested grid");
      }
    });

    el.onkeydown = (e) => {
      if (editing || !sheet) return;
      const cur = selectedId ? locate(grid, selectedId) : null;
      const move = (dr: number, dc: number) => {
        if (!cur) return;
        const nr = Math.max(0, Math.min(cur.grid.rows.length - 1, cur.row + dr));
        const nc = Math.max(0, Math.min(cur.grid.cols - 1, cur.col + dc));
        selectedId = cur.grid.rows[nr][nc].id;
        drawEditor();
      };
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); redo(); return; }
      if (!cur) return;
      if (e.ctrlKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        snapshot();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!;
        if (moveCell(cur.grid, cur.cell.id, d[0], d[1])) afterMutate();
        else undoStack.pop();
        return;
      }
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); move(-1, 0); break;
        case "ArrowDown": e.preventDefault(); move(1, 0); break;
        case "ArrowLeft": e.preventDefault(); move(0, -1); break;
        case "ArrowRight": e.preventDefault(); move(0, 1); break;
        case "Tab": e.preventDefault(); move(0, e.shiftKey ? -1 : 1); break;
        case "Enter": {
          e.preventDefault();
          const cd = wrap.querySelector<HTMLElement>(`.lat-cell[data-id="${cur.cell.id}"]`);
          if (cd) startEdit(cur.cell, cd);
          break;
        }
        case "Insert": {
          e.preventDefault();
          if (!cur.cell.grid) { snapshot(); insertSubgrid(sheet.root, cur.cell.id); afterMutate(); }
          break;
        }
        case "Delete": case "Backspace": {
          if (cur.cell.text) { e.preventDefault(); snapshot(); setText(sheet.root, cur.cell.id, ""); afterMutate(); }
          break;
        }
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const cd = wrap.querySelector<HTMLElement>(`.lat-cell[data-id="${cur.cell.id}"]`);
            if (cd) {
              startEdit(cur.cell, cd);
              const ta = cd.querySelector<HTMLTextAreaElement>(".lat-edit");
              if (ta) { ta.value = e.key; e.preventDefault(); }
            }
          }
      }
    };
    el.tabIndex = 0;

    let pinchStart = 0;
    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinchStart = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2 || !pinchStart) return;
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      if (d > pinchStart * 1.45) {
        pinchStart = 0;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const target = document.elementFromPoint(midX, midY)?.closest<HTMLElement>(".lat-cell");
        const id = target?.dataset.id;
        if (id) {
          const loc = locate(grid, id);
          if (loc?.cell.grid) { zoomPath = [...zoomPath, id]; selectedId = null; drawEditor(); }
        }
      } else if (d < pinchStart * 0.65 && zoomPath.length) {
        pinchStart = 0;
        zoomPath = zoomPath.slice(0, -1);
        selectedId = null;
        drawEditor();
      }
    }, { passive: true });

    wrap.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) {
        const target = (e.target as HTMLElement).closest<HTMLElement>(".lat-cell");
        const id = target?.dataset.id;
        if (id) {
          const loc = locate(grid, id);
          if (loc?.cell.grid) { zoomPath = [...zoomPath, id]; selectedId = null; drawEditor(); }
        }
      } else if (zoomPath.length) {
        zoomPath = zoomPath.slice(0, -1);
        selectedId = null;
        drawEditor();
      }
    }, { passive: false });

    el.focus();
  }

  drawList();
}
