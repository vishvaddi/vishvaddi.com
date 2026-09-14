// /kitchen/plan — fortnight meal planner and aggregated shopping list.
import { mountStoreControls, todayIso } from "./store";
import {
  AISLES, SLOTS, aggregateShopping, applyCooked, autoFillDinners, dayOfWeek, itemKey, nextMonday,
  planDates, shoppingLineText, shoppingListText, type Aisle, type KitchenDoc, type PlanCell, type Slot,
} from "./kitchen-model";
import { openKitchenStore, el, button, copyText } from "./kitchen-store";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_LABEL: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };

export function initKitchenPlan(): void {
  const planRoot = document.getElementById("plan-app");
  const shopRoot = document.getElementById("shop-app");
  const storeHost = document.getElementById("kit-store");
  if (!planRoot || !shopRoot || !storeHost) return;
  const store = openKitchenStore();
  const today = todayIso();
  let local = false;

  const commit = (fn: (d: KitchenDoc) => void): void => {
    local = true;
    try { store.update((d) => { fn(d); }); } finally { local = false; }
  };

  // Housekeeping on open: stamp cooked recipes, default the start date.
  {
    const d = store.get();
    const { doc, changed } = applyCooked(d, today);
    if (changed || !d.plan.startDate) {
      commit((x) => { x.recipes = doc.recipes; if (!x.plan.startDate) x.plan.startDate = nextMonday(today); });
    }
  }

  const dates = () => planDates(store.get().plan.startDate || nextMonday(today));
  const recipeById = (id: string) => store.get().recipes.find((r) => r.id === id);
  const recipeByTitle = (title: string) => {
    const t = title.trim().toLowerCase();
    return t ? store.get().recipes.find((r) => r.title.toLowerCase() === t) : undefined;
  };

  // ── Settings ──
  const settingsBox = el("div", "calc no-print");
  settingsBox.append(el("h2", undefined, "Fortnight"));
  const settingsGrid = el("div", "kit-settings");
  const numField = (id: string, label: string, get: () => number, set: (n: number) => void, attrs: Record<string, string>): HTMLInputElement => {
    const wrap = el("div", "field");
    wrap.append(el("label", undefined, label));
    const i = el("input") as HTMLInputElement;
    i.type = attrs.type || "number";
    i.id = id;
    for (const [k, v] of Object.entries(attrs)) if (k !== "type") i.setAttribute(k, v);
    i.value = String(get());
    i.addEventListener("change", () => { set(Number(i.value)); });
    wrap.append(i);
    settingsGrid.append(wrap);
    return i;
  };
  const checkField = (id: string, label: string, get: () => boolean, set: (b: boolean) => void): HTMLInputElement => {
    const lab = el("label", "check");
    const i = el("input") as HTMLInputElement;
    i.type = "checkbox";
    i.id = id;
    i.checked = get();
    i.addEventListener("change", () => set(i.checked));
    lab.append(i, document.createTextNode(label));
    settingsGrid.append(lab);
    return i;
  };
  const startWrap = el("div", "field");
  startWrap.append(el("label", undefined, "Start date"));
  const startIn = el("input") as HTMLInputElement;
  startIn.type = "date";
  startIn.id = "plan-start";
  startIn.value = store.get().plan.startDate;
  startIn.addEventListener("change", () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startIn.value)) return;
    commit((d) => { d.plan.startDate = startIn.value; });
    renderAll();
  });
  startWrap.append(startIn);
  settingsGrid.append(startWrap);
  numField("plan-servings", "Servings per meal", () => store.get().settings.servings, (n) => commit((d) => { d.settings.servings = Math.max(1, Math.round(n) || 1); }), { min: "1", step: "1", inputmode: "numeric" });
  numField("plan-max", "Weekday dinner ≤ min", () => store.get().settings.weekdayMaxMinutes, (n) => commit((d) => { d.settings.weekdayMaxMinutes = Math.max(0, Math.round(n) || 0); }), { min: "0", step: "5", inputmode: "numeric" });
  numField("plan-leftovers", "Leftover days after Sunday", () => store.get().settings.leftoverDays, (n) => commit((d) => { d.settings.leftoverDays = Math.min(2, Math.max(0, Math.round(n) || 0)); }), { min: "0", max: "2", step: "1", inputmode: "numeric" });
  numField("plan-seed", "Shuffle seed", () => store.get().settings.seed, (n) => commit((d) => { d.settings.seed = Math.round(n) || 1; }), { min: "1", step: "1", inputmode: "numeric" });
  checkField("plan-prepday", "Sunday is meal-prep day", () => store.get().settings.prepDay, (b) => commit((d) => { d.settings.prepDay = b; }));
  checkField("plan-snacks", "Show snacks row", () => store.get().settings.showSnacks, (b) => { commit((d) => { d.settings.showSnacks = b; }); renderGrid(); });
  settingsBox.append(settingsGrid);
  const settingsRow = el("div", "btn-row");
  const fillBtn = button("Auto-fill dinners", "btn", () => {
    const d = store.get();
    if (!d.recipes.length) { planStatus.textContent = "Add some recipes first."; return; }
    const days = autoFillDinners(d.recipes, d.plan.days, dates(), d.settings);
    commit((x) => { x.plan.days = days; });
    planStatus.textContent = "Dinners filled — edit any cell to override.";
    renderAll();
  });
  fillBtn.id = "plan-autofill";
  const clearBtn = button("Clear fortnight", "btn btn-ghost", () => {
    if (!confirm("Clear every cell in this fortnight?")) return;
    commit((d) => { for (const date of dates()) delete d.plan.days[date]; });
    renderAll();
  });
  const planStatus = el("span", "kit-status");
  planStatus.id = "plan-status";
  settingsRow.append(fillBtn, clearBtn, planStatus);
  settingsBox.append(settingsRow);

  const datalist = el("datalist") as HTMLDataListElement;
  datalist.id = "recipe-list";
  const grid = el("div", "kit-plan");
  grid.id = "plan-grid";
  planRoot.append(settingsBox, datalist, grid);

  // ── Shopping ──
  const shopHead = el("div", "btn-row no-print");
  const shopStatus = el("span", "kit-status");
  const copyBtn = button("Copy list", "btn btn-ghost btn-sm", async () => {
    const d = store.get();
    const text = shoppingListText(aggregateShopping(d.recipes, d.plan.days, dates(), d.aisles), d.ticks);
    shopStatus.textContent = (await copyText(text)) ? "Copied." : "Copy failed.";
  });
  copyBtn.id = "shop-copy";
  const printBtn = button("Print", "btn btn-ghost btn-sm", () => window.print());
  const untickBtn = button("Clear ticks", "btn btn-ghost btn-sm", () => { commit((d) => { d.ticks = {}; }); renderShopping(); });
  shopHead.append(copyBtn, printBtn, untickBtn, shopStatus);
  const shopList = el("div");
  shopList.id = "shop-list";
  shopRoot.append(shopHead, shopList);

  mountStoreControls(storeHost, store, { filename: "kitchen.json", onImport: renderAll });
  store.subscribe(() => { if (!local) renderAll(); });

  function renderDatalist(): void {
    datalist.textContent = "";
    for (const r of [...store.get().recipes].sort((a, b) => a.title.localeCompare(b.title))) {
      const o = el("option") as HTMLOptionElement;
      o.value = r.title;
      datalist.append(o);
    }
  }

  function cellLabel(cell: PlanCell | undefined): string {
    if (!cell) return "";
    if (cell.recipeId) {
      const r = recipeById(cell.recipeId);
      const title = r?.title ?? "(deleted recipe)";
      return cell.leftover ? `Leftovers: ${title}` : title;
    }
    return cell.text ?? "";
  }

  function setCell(date: string, slot: Slot, value: string, servings: number | undefined): void {
    const text = value.trim();
    const leftoverMatch = text.match(/^leftovers?:\s*(.+)$/i);
    const recipe = recipeByTitle(leftoverMatch ? leftoverMatch[1] : text);
    commit((d) => {
      const day = (d.plan.days[date] ??= { away: false, slots: {} });
      if (!text) { delete day.slots[slot]; return; }
      const per = servings || d.settings.servings;
      day.slots[slot] = recipe
        ? { recipeId: recipe.id, servings: per, ...(leftoverMatch ? { leftover: true } : {}) }
        : { text, servings: per };
    });
  }

  function renderGrid(): void {
    grid.textContent = "";
    const d = store.get();
    const slots = SLOTS.filter((s) => s !== "snack" || d.settings.showSnacks);
    for (const date of dates()) {
      const day = d.plan.days[date];
      const dow = dayOfWeek(date);
      const card = el("div", "kit-day");
      card.setAttribute("data-date", date);
      if (day?.away) card.classList.add("away");
      if (date === today) card.classList.add("today");
      if (dow === 0 && d.settings.prepDay) card.classList.add("prep");
      const head = el("div", "kit-day-head");
      const dt = new Date(date + "T00:00:00");
      head.append(el("strong", undefined, `${DAY_NAMES[dow]} ${dt.getDate()}/${dt.getMonth() + 1}${dow === 0 && d.settings.prepDay ? " · prep day" : ""}`));
      const awayLab = el("label");
      const away = el("input") as HTMLInputElement;
      away.type = "checkbox";
      away.checked = !!day?.away;
      away.setAttribute("data-away", date);
      away.addEventListener("change", () => {
        commit((x) => { (x.plan.days[date] ??= { away: false, slots: {} }).away = away.checked; });
        card.classList.toggle("away", away.checked);
        renderShopping();
      });
      awayLab.append(away, document.createTextNode("away"));
      head.append(awayLab);
      card.append(head);

      for (const slot of slots) {
        const cell = day?.slots[slot];
        const row = el("div", "kit-slot");
        if (cell?.leftover) row.classList.add("leftover");
        row.append(el("span", "l", SLOT_LABEL[slot]));
        const inp = el("input") as HTMLInputElement;
        inp.type = "text";
        inp.setAttribute("list", "recipe-list");
        inp.setAttribute("data-cell", `${date}:${slot}`);
        inp.placeholder = slot === "dinner" ? "recipe, “out”, “leftovers”…" : "—";
        inp.autocomplete = "off";
        inp.value = cellLabel(cell);
        const sv = el("input") as HTMLInputElement;
        sv.type = "number";
        sv.min = "1";
        sv.step = "1";
        sv.inputMode = "numeric";
        sv.title = "Servings";
        sv.setAttribute("data-servings", `${date}:${slot}`);
        sv.value = cell?.servings ? String(cell.servings) : "";
        sv.placeholder = String(d.settings.servings);
        const apply = () => {
          setCell(date, slot, inp.value, Number(sv.value) || undefined);
          const next = store.get().plan.days[date]?.slots[slot];
          row.classList.toggle("leftover", !!next?.leftover);
          if (next?.servings && !sv.value) sv.value = String(next.servings);
          renderShopping();
        };
        inp.addEventListener("change", apply);
        sv.addEventListener("change", apply);
        row.append(inp, sv);
        card.append(row);
      }
      grid.append(card);
    }
  }

  function renderShopping(): void {
    const d = store.get();
    const lines = aggregateShopping(d.recipes, d.plan.days, dates(), d.aisles);
    shopList.textContent = "";
    if (!lines.length) {
      shopList.append(el("p", "calc-blurb", "Assign recipes to the plan and the list builds itself here."));
      return;
    }
    let current: Aisle | null = null;
    for (const line of lines) {
      if (line.aisle !== current) {
        current = line.aisle;
        shopList.append(el("div", "shop-aisle", line.aisle));
      }
      const row = el("div", "shop-line" + (d.ticks[line.key] ? " done" : ""));
      row.setAttribute("data-shop-key", line.key);
      const lab = el("label");
      const box = el("input") as HTMLInputElement;
      box.type = "checkbox";
      box.checked = !!d.ticks[line.key];
      box.setAttribute("data-tick", line.key);
      box.addEventListener("change", () => {
        commit((x) => { if (box.checked) x.ticks[line.key] = true; else delete x.ticks[line.key]; });
        row.classList.toggle("done", box.checked);
      });
      const t = el("span", "t", shoppingLineText(line));
      t.append(el("small", undefined, line.from.join(", ")));
      lab.append(box, t);
      const sel = el("select", "no-print") as HTMLSelectElement;
      sel.title = "Aisle";
      for (const a of AISLES) {
        const o = el("option", undefined, a) as HTMLOptionElement;
        o.value = a;
        o.selected = a === line.aisle;
        sel.append(o);
      }
      sel.addEventListener("change", () => {
        commit((x) => { x.aisles[itemKey(line.item)] = sel.value as Aisle; });
        renderShopping();
      });
      row.append(lab, sel);
      shopList.append(row);
    }
  }

  function renderAll(): void {
    startIn.value = store.get().plan.startDate;
    renderDatalist();
    renderGrid();
    renderShopping();
  }

  renderAll();
}
