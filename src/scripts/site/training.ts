import { createStore, mountStoreControls, uid, todayIso } from "./store";
import {
  initialTraining, isTrainingData, suggestLoad, lastPerformance, nextDayId, trends, weekSummary, bestE1rm,
  type TrainingData, type ProgrammeDay, type Exercise, type Session, type SetEntry,
} from "./training-model";

const mk = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label: string, cls = "btn btn-ghost btn-sm", onClick?: () => void): HTMLButtonElement => {
  const b = mk("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
};
const num = (value: number | null, opts: { step?: string; min?: string; max?: string; placeholder?: string; width?: string } = {}): HTMLInputElement => {
  const i = document.createElement("input");
  i.type = "number";
  i.inputMode = "decimal";
  if (value !== null && Number.isFinite(value)) i.value = String(value);
  i.step = opts.step ?? "0.5";
  if (opts.min) i.min = opts.min;
  if (opts.max) i.max = opts.max;
  if (opts.placeholder) i.placeholder = opts.placeholder;
  if (opts.width) i.style.width = opts.width;
  return i;
};
const fmtKg = (kg: number) => (Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, ""));
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

export function initTraining(): void {
  const root = document.getElementById("training-app");
  if (!root) return;
  const store = createStore<TrainingData>({ key: "training", version: 1, initial: initialTraining, validate: isTrainingData });
  const controls = document.getElementById("training-store");
  if (controls) mountStoreControls(controls, store, { filename: "vishvaddi-training.json", onImport: () => render() });

  const TABS = ["Today", "Programme", "History", "Progress"] as const;
  let tab: (typeof TABS)[number] = "Today";
  const tabs = mk("nav", "fit-tabs no-print");
  tabs.setAttribute("aria-label", "Training sections");
  const body = mk("div", "fit-content");
  const layout = mk("div", "fit-layout");
  layout.append(tabs, body);
  root.append(layout);
  TABS.forEach((t) => {
    const b = btn(t, "fit-tab", () => { tab = t; render(); });
    b.dataset.tab = t;
    tabs.append(b);
  });

  function render(): void {
    Array.from(tabs.children).forEach((c) => c.classList.toggle("active", (c as HTMLElement).dataset.tab === tab));
    body.textContent = "";
    ({ Today: renderToday, Programme: renderProgramme, History: renderHistory, Progress: renderProgress })[tab]();
  }

  // ── Today ──
  function renderToday(): void {
    const data = store.get();
    if (!data.days.length) { body.append(mk("p", "calc-blurb", "Add a training day in Programme first.")); return; }
    let dayId = nextDayId(data.days, data.sessions);
    const head = mk("div", "calc");
    const summary = weekSummary(data.sessions, todayIso());
    const stats = mk("div", "stat-grid");
    for (const [n, l] of [[String(summary.sessions), "sessions / 7 d"], [String(summary.sets), "working sets"], [`${Math.round(summary.volume / 1000 * 10) / 10} t`, "volume"]]) {
      const s = mk("div", "stat");
      s.append(mk("div", "n", n), mk("div", "l", l));
      stats.append(s);
    }
    head.append(stats);

    const pick = mk("div", "field");
    pick.append(mk("label", undefined, "Session"));
    const sel = document.createElement("select");
    sel.id = "tr-day";
    for (const d of data.days) { const o = document.createElement("option"); o.value = d.id; o.textContent = d.name; sel.append(o); }
    sel.value = dayId;
    pick.append(sel);
    const dateField = mk("div", "field");
    dateField.append(mk("label", undefined, "Date"));
    const date = document.createElement("input");
    date.type = "date";
    date.id = "tr-date";
    date.value = todayIso();
    dateField.append(date);
    const fields = mk("div", "calc-fields");
    fields.append(pick, dateField);
    head.append(fields);
    body.append(head);

    const sheet = mk("div", "tr-sheet");
    body.append(sheet);
    const notesField = mk("div", "field");
    notesField.append(mk("label", undefined, "Session notes"));
    const notes = document.createElement("textarea");
    notes.rows = 2;
    notes.id = "tr-notes";
    notesField.append(notes);
    body.append(notesField);
    const actions = mk("div", "btn-row no-print");
    const save = btn("Save session", "btn", () => saveSession());
    save.id = "tr-save";
    actions.append(save);
    body.append(actions);
    const status = mk("p", "calc-blurb");
    status.id = "tr-status";
    body.append(status);

    type Row = { ex: Exercise; inputs: { kg: HTMLInputElement; reps: HTMLInputElement; rpe: HTMLInputElement }[] };
    let rows: Row[] = [];

    function buildSheet(): void {
      sheet.textContent = "";
      rows = [];
      const day = data.days.find((d) => d.id === dayId) ?? data.days[0];
      for (const ex of day.exercises) {
        const last = lastPerformance(data.sessions, ex.id);
        const sug = suggestLoad(ex, last, data.settings);
        const card = mk("section", "rec-card tr-ex");
        card.dataset.exercise = ex.id;
        const h = mk("div", "rec-card-head");
        h.append(mk("span", "rec-title", ex.name), mk("span", `rec-chip tr-${sug.verdict}`, sug.verdict === "start" ? "start" : sug.verdict));
        card.append(h);
        const target = ex.bodyweight && !ex.startKg
          ? `${ex.sets} × ${ex.repsMin}${ex.repsMax !== ex.repsMin ? `–${ex.repsMax}` : ""}`
          : `${ex.sets} × ${ex.repsMin}${ex.repsMax !== ex.repsMin ? `–${ex.repsMax}` : ""} @ ${fmtKg(sug.kg)} kg`;
        card.append(mk("div", "rec-sub", `Target ${target}`));
        card.append(mk("div", "rec-meta", sug.reason + (last ? ` Last: ${last.sets.filter((s) => s.reps > 0).map((s) => `${fmtKg(s.kg)}×${s.reps}${s.rpe ? `@${s.rpe}` : ""}`).join(", ")}.` : "")));
        const grid = mk("div", "tr-sets");
        const hdr = mk("div", "tr-set tr-set-head");
        hdr.append(mk("span", undefined, "Set"), mk("span", undefined, ex.bodyweight ? "+kg" : "kg"), mk("span", undefined, "Reps"), mk("span", undefined, "RPE"));
        grid.append(hdr);
        const inputs: Row["inputs"] = [];
        for (let i = 0; i < ex.sets; i++) {
          const row = mk("div", "tr-set");
          const kg = num(sug.kg, { step: String(ex.roundKg || 0.5), min: "0" });
          const reps = num(null, { step: "1", min: "0", placeholder: String(ex.repsMax) });
          const rpe = num(null, { step: "0.5", min: "1", max: "10", placeholder: "RPE" });
          reps.classList.add("tr-reps");
          rpe.classList.add("tr-rpe");
          row.append(mk("span", "tr-set-n", String(i + 1)), kg, reps, rpe);
          grid.append(row);
          inputs.push({ kg, reps, rpe });
        }
        card.append(grid);
        sheet.append(card);
        rows.push({ ex, inputs });
      }
    }
    buildSheet();
    sel.addEventListener("change", () => { dayId = sel.value; buildSheet(); });

    function saveSession(): void {
      const day = data.days.find((d) => d.id === dayId) ?? data.days[0];
      const entries = rows.map((r) => ({
        exerciseId: r.ex.id,
        name: r.ex.name,
        sets: r.inputs
          .map((i): SetEntry => ({ kg: Number(i.kg.value) || 0, reps: Number(i.reps.value) || 0, rpe: i.rpe.value ? Number(i.rpe.value) : null }))
          .filter((s) => s.reps > 0),
      })).filter((e) => e.sets.length);
      if (!entries.length) { status.textContent = "Enter reps for at least one set."; return; }
      const session: Session = { id: uid(), date: date.value || todayIso(), dayId: day.id, dayName: day.name, entries, notes: notes.value.trim() || undefined };
      store.update((d) => { d.sessions.push(session); });
      status.textContent = `Saved ${day.name} — ${entries.reduce((n, e) => n + e.sets.length, 0)} sets.`;
      tab = "History";
      render();
    }
  }

  // ── Programme ──
  function renderProgramme(): void {
    const data = store.get();
    const intro = mk("p", "calc-blurb", "Days rotate in order. Increment is what a clean session adds; round is the plate step (2.5 for a bar, 2 for dumbbells, 1 for seconds).");
    body.append(intro);
    const settings = mk("div", "calc");
    settings.append(mk("h2", undefined, "Progression rules"));
    const sf = mk("div", "calc-fields");
    const easy = num(data.settings.rpeEasy, { step: "0.5", min: "5", max: "10" });
    const hard = num(data.settings.rpeHard, { step: "0.5", min: "6", max: "10" });
    const deload = num(data.settings.deloadPct, { step: "1", min: "0", max: "30" });
    for (const [label, input] of [["Add load when every set ≤ RPE", easy], ["Hold when any set ≥ RPE", hard], ["Deload after a miss (%)", deload]] as const) {
      const f = mk("div", "field");
      f.append(mk("label", undefined, label), input);
      sf.append(f);
      input.addEventListener("change", () => store.update((d) => { d.settings = { rpeEasy: Number(easy.value) || 7, rpeHard: Number(hard.value) || 9.5, deloadPct: Number(deload.value) || 5 }; }));
    }
    settings.append(sf);
    body.append(settings);

    data.days.forEach((day, di) => {
      const card = mk("section", "calc tr-day");
      card.dataset.day = day.id;
      const head = mk("div", "rec-card-head");
      const name = document.createElement("input");
      name.type = "text";
      name.value = day.name;
      name.className = "tr-day-name";
      name.addEventListener("change", () => store.update((d) => { d.days[di].name = name.value.trim() || day.name; }));
      const dayBtns = mk("div", "btn-row");
      dayBtns.append(
        btn("↑", "btn btn-ghost btn-sm", () => { if (di === 0) return; store.update((d) => { [d.days[di - 1], d.days[di]] = [d.days[di], d.days[di - 1]]; }); render(); }),
        btn("↓", "btn btn-ghost btn-sm", () => { if (di === data.days.length - 1) return; store.update((d) => { [d.days[di + 1], d.days[di]] = [d.days[di], d.days[di + 1]]; }); render(); }),
        btn("Delete day", "btn btn-ghost btn-sm", () => { if (!confirm(`Delete ${day.name}?`)) return; store.update((d) => { d.days.splice(di, 1); }); render(); }),
      );
      head.append(name, dayBtns);
      card.append(head);

      const table = mk("div", "tr-ex-table");
      const th = mk("div", "tr-ex-row tr-ex-head");
      for (const t of ["Exercise", "Sets", "Reps min", "Reps max", "Start kg", "+kg", "Round", ""]) th.append(mk("span", undefined, t));
      table.append(th);
      day.exercises.forEach((ex, ei) => {
        const row = mk("div", "tr-ex-row");
        row.dataset.exercise = ex.id;
        const nameIn = document.createElement("input");
        nameIn.type = "text";
        nameIn.value = ex.name;
        const sets = num(ex.sets, { step: "1", min: "1" });
        const rmin = num(ex.repsMin, { step: "1", min: "1" });
        const rmax = num(ex.repsMax, { step: "1", min: "1" });
        const start = num(ex.startKg, { step: "0.5", min: "0" });
        const inc = num(ex.incrementKg, { step: "0.5", min: "0" });
        const round = num(ex.roundKg, { step: "0.5", min: "0" });
        const commit = () => store.update((d) => {
          const target = d.days[di].exercises[ei];
          target.name = nameIn.value.trim() || target.name;
          target.sets = Math.max(1, Number(sets.value) || 1);
          target.repsMin = Math.max(1, Number(rmin.value) || 1);
          target.repsMax = Math.max(target.repsMin, Number(rmax.value) || target.repsMin);
          target.startKg = Number(start.value) || 0;
          target.incrementKg = Number(inc.value) || 0;
          target.roundKg = Number(round.value) || 0;
          target.bodyweight = target.startKg === 0 && target.incrementKg === 0 ? true : target.bodyweight && target.startKg === 0;
        });
        for (const i of [nameIn, sets, rmin, rmax, start, inc, round]) i.addEventListener("change", commit);
        const del = btn("×", "btn btn-ghost btn-sm", () => { store.update((d) => { d.days[di].exercises.splice(ei, 1); }); render(); });
        del.title = "Remove exercise";
        row.append(nameIn, sets, rmin, rmax, start, inc, round, del);
        table.append(row);
      });
      card.append(table);
      const add = btn("+ Exercise", "btn btn-ghost btn-sm", () => {
        store.update((d) => { d.days[di].exercises.push({ id: uid(), name: "New exercise", sets: 3, repsMin: 8, repsMax: 10, startKg: 20, incrementKg: 2.5, roundKg: 2.5 }); });
        render();
      });
      add.classList.add("tr-add-ex");
      card.append(add);
      body.append(card);
    });
    const addDay = btn("+ Training day", "btn", () => {
      store.update((d) => { d.days.push({ id: uid(), name: `Day ${String.fromCharCode(65 + d.days.length)}`, exercises: [] }); });
      render();
    });
    addDay.id = "tr-add-day";
    const reset = btn("Reset to default programme", "btn btn-ghost", () => { if (!confirm("Replace the programme with the default three days? Sessions are kept.")) return; store.update((d) => { d.days = initialTraining().days; }); render(); });
    const row = mk("div", "btn-row");
    row.append(addDay, reset);
    body.append(row);
  }

  // ── History ──
  function renderHistory(): void {
    const data = store.get();
    const sessions = [...data.sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (!sessions.length) { body.append(mk("p", "calc-blurb", "No sessions yet. Log one from Today.")); return; }
    const list = mk("div");
    list.id = "tr-history";
    for (const s of sessions) {
      const card = mk("details", "rec-card tr-session");
      const sum = mk("summary");
      const setsN = s.entries.reduce((n, e) => n + e.sets.length, 0);
      sum.append(mk("span", "rec-title", `${fmtDate(s.date)} — ${s.dayName}`), mk("span", "rec-chip", `${setsN} sets`));
      card.append(sum);
      for (const e of s.entries) {
        const line = mk("div", "rec-sub");
        line.append(mk("strong", undefined, e.name + ": "), document.createTextNode(e.sets.map((x) => `${fmtKg(x.kg)}×${x.reps}${x.rpe ? `@${x.rpe}` : ""}`).join("  ") + `  · e1RM ${Math.round(bestE1rm(e.sets))} kg`));
        card.append(line);
      }
      if (s.notes) card.append(mk("div", "rec-meta", s.notes));
      const del = btn("Delete session", "btn btn-ghost btn-sm", () => { if (!confirm("Delete this session?")) return; store.update((d) => { d.sessions = d.sessions.filter((x) => x.id !== s.id); }); render(); });
      card.append(del);
      list.append(card);
    }
    body.append(list);
  }

  // ── Progress ──
  function renderProgress(): void {
    const data = store.get();
    const t = trends(data);
    if (!t.length) { body.append(mk("p", "calc-blurb", "Progress charts appear once sessions are logged.")); return; }
    for (const ex of t) {
      const card = mk("section", "rec-card tr-trend");
      card.dataset.exercise = ex.exerciseId;
      const last = ex.points[ex.points.length - 1];
      const first = ex.points[0];
      const head = mk("div", "rec-card-head");
      head.append(mk("span", "rec-title", ex.name), mk("span", "rec-chip", `e1RM ${Math.round(last.e1rm)} kg`));
      card.append(head);
      const delta = last.e1rm - first.e1rm;
      card.append(mk("div", "rec-sub", `${ex.points.length} session${ex.points.length === 1 ? "" : "s"} · top set ${fmtKg(last.topKg)} kg · ${delta >= 0 ? "+" : ""}${Math.round(delta)} kg since ${fmtDate(first.date)}`));
      card.append(sparkline(ex.points.map((p) => p.e1rm)));
      body.append(card);
    }
  }

  function sparkline(values: number[]): SVGElement {
    const w = 320, h = 60, pad = 4;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("class", "tr-spark");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Estimated one-rep max over ${values.length} sessions`);
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", pts.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "var(--site-accent)");
    line.setAttribute("stroke-width", "2");
    svg.append(line);
    pts.forEach((p) => {
      const [x, y] = p.split(",");
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", "2.5"); c.setAttribute("fill", "var(--site-accent)");
      svg.append(c);
    });
    return svg;
  }

  render();
}
