// /kitchen — recipe database. All output via textContent (CSP-clean).
import { mountStoreControls, uid } from "./store";
import {
  allTags, formatQty, parseIngredients, parseSteps, parseTags, recipeToMarkdown,
  scaleIngredient, searchRecipes, sortRecipes, totalMinutes, type Recipe, type SortKey,
} from "./kitchen-model";
import { openKitchenStore, el, button, copyText } from "./kitchen-store";

interface ImportedRecipe {
  title: string; sourceUrl: string; servings: number | null; prepMinutes: number | null; cookMinutes: number | null;
  ingredients: string[]; steps: string[]; tags: string[];
}

export function initKitchen(): void {
  const root = document.getElementById("kit-app");
  const storeHost = document.getElementById("kit-store");
  if (!root || !storeHost) return;
  const store = openKitchenStore();

  let query = "";
  let activeTags: string[] = [];
  let sort: SortKey = "recent";
  let viewId: string | null = null;
  let editingId: string | null = null;
  let local = false;
  const recipes = () => store.get().recipes;

  // ── Toolbar ──
  const toolbar = el("div", "kit-toolbar no-print");
  const searchField = el("div", "field");
  searchField.append(el("label", undefined, "Search"));
  const search = el("input") as HTMLInputElement;
  search.type = "search";
  search.id = "kit-search";
  search.placeholder = "title, tag or ingredient";
  search.addEventListener("input", () => { query = search.value; renderList(); });
  searchField.append(search);
  const sortField = el("div", "field");
  sortField.append(el("label", undefined, "Sort"));
  const sortSel = el("select") as HTMLSelectElement;
  sortSel.id = "kit-sort";
  for (const [v, l] of [["recent", "Recently added"], ["title", "Title"], ["quickest", "Quickest"]]) {
    const o = el("option", undefined, l) as HTMLOptionElement;
    o.value = v;
    sortSel.append(o);
  }
  sortSel.addEventListener("change", () => { sort = sortSel.value as SortKey; renderList(); });
  sortField.append(sortSel);
  toolbar.append(searchField, sortField);

  const chips = el("div", "kit-chips no-print");
  chips.id = "kit-tags";
  const actions = el("div", "btn-row no-print");
  const addBtn = button("Add recipe", "btn", () => openForm(null));
  addBtn.id = "kit-add";
  actions.append(addBtn);

  // ── Form ──
  const form = el("div", "calc");
  form.id = "kit-form";
  form.hidden = true;
  const formTitle = el("h2", undefined, "New recipe");
  const importRow = el("div", "kit-import");
  const urlField = el("div", "field");
  urlField.append(el("label", undefined, "Source URL"));
  const urlIn = el("input") as HTMLInputElement;
  urlIn.type = "text";
  urlIn.id = "kit-url";
  urlIn.placeholder = "https://…";
  urlIn.inputMode = "url";
  urlField.append(urlIn);
  const importBtn = button("Import from URL", "btn btn-ghost", () => { void importFromUrl(); });
  importBtn.id = "kit-import";
  importRow.append(urlField, importBtn);
  const importStatus = el("div", "kit-status");
  importStatus.id = "kit-import-status";

  const grid = el("div", "calc-fields");
  const input = (id: string, label: string, type = "text", attrs: Record<string, string> = {}): HTMLInputElement => {
    const wrap = el("div", "field");
    wrap.append(el("label", undefined, label));
    const i = el("input") as HTMLInputElement;
    i.type = type;
    i.id = id;
    for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
    wrap.append(i);
    grid.append(wrap);
    return i;
  };
  const titleIn = input("kit-title", "Title");
  titleIn.parentElement!.style.gridColumn = "1 / -1";
  const servingsIn = input("kit-servings", "Serves", "number", { min: "1", step: "1", inputmode: "numeric" });
  const prepIn = input("kit-prep", "Prep (min)", "number", { min: "0", step: "1", inputmode: "numeric" });
  const cookIn = input("kit-cook", "Cook (min)", "number", { min: "0", step: "1", inputmode: "numeric" });
  const tagsIn = input("kit-tagsin", "Tags (comma separated)");
  tagsIn.placeholder = "quick, prep, veg";
  tagsIn.parentElement!.style.gridColumn = "1 / -1";

  const textarea = (id: string, label: string, rows: number, hint: string): HTMLTextAreaElement => {
    const wrap = el("div", "field");
    wrap.append(el("label", undefined, label));
    const t = el("textarea") as HTMLTextAreaElement;
    t.id = id;
    t.rows = rows;
    t.placeholder = hint;
    wrap.append(t);
    form.append(wrap);
    return t;
  };
  form.append(formTitle, importRow, importStatus, grid);
  const ingsIn = textarea("kit-ings", "Ingredients (one per line)", 6, "2 tbsp olive oil\n1/2 cup rice\n400 g tinned tomatoes\nsalt");
  const stepsIn = textarea("kit-steps", "Method (one step per line)", 6, "Heat the oil…");
  const notesIn = textarea("kit-notes", "Notes", 2, "");
  const formRow = el("div", "btn-row");
  const saveBtn = button("Save recipe", "btn", saveForm);
  saveBtn.id = "kit-save";
  const cancelBtn = button("Cancel", "btn btn-ghost", closeForm);
  formRow.append(saveBtn, cancelBtn);
  form.append(formRow);

  const detail = el("div", "calc kit-detail");
  detail.id = "kit-detail";
  detail.hidden = true;
  const count = el("div", "kit-count");
  count.id = "kit-count";
  const list = el("div");
  list.id = "kit-list";
  root.append(toolbar, chips, actions, form, detail, count, list);

  mountStoreControls(storeHost, store, { filename: "kitchen.json", onImport: renderAll });
  store.subscribe(() => { if (!local) renderAll(); });

  function commit(fn: (r: Recipe[]) => Recipe[]): void {
    local = true;
    try { store.update((d) => { d.recipes = fn(d.recipes); }); } finally { local = false; }
  }

  function openForm(r: Recipe | null): void {
    editingId = r?.id ?? null;
    formTitle.textContent = r ? "Edit recipe" : "New recipe";
    titleIn.value = r?.title ?? "";
    urlIn.value = r?.sourceUrl ?? "";
    servingsIn.value = r ? String(r.servings || "") : "2";
    prepIn.value = r ? String(r.prepMinutes || "") : "";
    cookIn.value = r ? String(r.cookMinutes || "") : "";
    tagsIn.value = r?.tags.join(", ") ?? "";
    ingsIn.value = r?.ingredients.map((i) => i.raw).join("\n") ?? "";
    stepsIn.value = r?.steps.join("\n") ?? "";
    notesIn.value = r?.notes ?? "";
    importStatus.textContent = "";
    importStatus.classList.remove("err");
    form.hidden = false;
    detail.hidden = true;
    viewId = null;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    titleIn.focus();
  }

  function closeForm(): void {
    form.hidden = true;
    editingId = null;
  }

  function saveForm(): void {
    const title = titleIn.value.trim();
    if (!title) { titleIn.focus(); return; }
    const existing = editingId ? recipes().find((r) => r.id === editingId) : null;
    const rec: Recipe = {
      id: existing?.id ?? uid(),
      title,
      sourceUrl: urlIn.value.trim(),
      servings: Math.max(1, Math.round(Number(servingsIn.value) || 1)),
      prepMinutes: Math.max(0, Math.round(Number(prepIn.value) || 0)),
      cookMinutes: Math.max(0, Math.round(Number(cookIn.value) || 0)),
      tags: parseTags(tagsIn.value),
      ingredients: parseIngredients(ingsIn.value),
      steps: parseSteps(stepsIn.value),
      notes: notesIn.value.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastCookedAt: existing?.lastCookedAt ?? null,
    };
    commit((rs) => (existing ? rs.map((r) => (r.id === rec.id ? rec : r)) : [rec, ...rs]));
    closeForm();
    viewId = rec.id;
    renderAll();
  }

  async function importFromUrl(): Promise<void> {
    const raw = urlIn.value.trim();
    if (!raw) { urlIn.focus(); return; }
    importStatus.classList.remove("err");
    importStatus.textContent = "Fetching…";
    importBtn.disabled = true;
    try {
      const res = await fetch(`/api/recipe?url=${encodeURIComponent(raw)}`, { headers: { Accept: "application/json" } });
      const body = (await res.json()) as Partial<ImportedRecipe> & { error?: string };
      if (!res.ok) throw new Error(body.error || `Import failed (${res.status}).`);
      if (body.title) titleIn.value = body.title;
      if (body.sourceUrl) urlIn.value = body.sourceUrl;
      if (body.servings) servingsIn.value = String(body.servings);
      if (body.prepMinutes != null) prepIn.value = String(body.prepMinutes);
      if (body.cookMinutes != null) cookIn.value = String(body.cookMinutes);
      if (body.tags?.length) tagsIn.value = body.tags.join(", ");
      if (body.ingredients?.length) ingsIn.value = body.ingredients.join("\n");
      if (body.steps?.length) stepsIn.value = body.steps.join("\n");
      importStatus.textContent = `Imported ${body.ingredients?.length ?? 0} ingredients and ${body.steps?.length ?? 0} steps — check, then save.`;
    } catch (err) {
      importStatus.classList.add("err");
      importStatus.textContent = err instanceof Error ? err.message : "Import failed.";
    } finally {
      importBtn.disabled = false;
    }
  }

  function renderChips(): void {
    chips.textContent = "";
    const tags = allTags(recipes());
    activeTags = activeTags.filter((t) => tags.includes(t));
    for (const t of tags) {
      const c = button(t, "kit-chip" + (activeTags.includes(t) ? " active" : ""), () => {
        activeTags = activeTags.includes(t) ? activeTags.filter((x) => x !== t) : [...activeTags, t];
        renderChips();
        renderList();
      });
      c.setAttribute("data-tag", t);
      chips.append(c);
    }
  }

  function renderList(): void {
    list.textContent = "";
    const all = recipes();
    const shown = sortRecipes(searchRecipes(all, query, activeTags), sort);
    count.textContent = all.length ? `${shown.length} of ${all.length} recipes` : "";
    if (!all.length) {
      list.append(el("p", "calc-blurb", "No recipes yet — add one above, or import from a recipe page URL."));
      return;
    }
    if (!shown.length) {
      list.append(el("p", "calc-blurb", "Nothing matches that search."));
      return;
    }
    for (const r of shown) {
      const card = el("div", "rec-card clickable");
      card.setAttribute("data-recipe-id", r.id);
      const head = el("div", "rec-card-head");
      head.append(el("span", "rec-title", r.title));
      const rc = el("div", "rec-chips");
      const mins = totalMinutes(r);
      if (mins) rc.append(el("span", "rec-chip", `${mins} min`));
      for (const t of r.tags.slice(0, 3)) rc.append(el("span", "rec-chip", t));
      head.append(rc);
      card.append(head);
      const metas = [`Serves ${r.servings}`, `${r.ingredients.length} ingredients`];
      if (r.lastCookedAt) metas.push(`Cooked ${r.lastCookedAt}`);
      card.append(el("div", "rec-meta", metas.join("  ·  ")));
      card.addEventListener("click", () => { viewId = r.id; renderDetail(); });
      list.append(card);
    }
  }

  function renderDetail(): void {
    const r = viewId ? recipes().find((x) => x.id === viewId) : null;
    if (!r) { detail.hidden = true; viewId = null; return; }
    detail.textContent = "";
    detail.hidden = false;
    form.hidden = true;
    const head = el("div", "rec-card-head");
    head.append(el("h2", undefined, r.title));
    const back = button("← Back to list", "btn btn-ghost btn-sm", () => { viewId = null; detail.hidden = true; });
    head.append(back);
    detail.append(head);

    const meta: string[] = [`Serves ${r.servings}`];
    if (r.prepMinutes) meta.push(`Prep ${r.prepMinutes} min`);
    if (r.cookMinutes) meta.push(`Cook ${r.cookMinutes} min`);
    if (r.tags.length) meta.push(r.tags.join(", "));
    detail.append(el("div", "rec-meta", meta.join("  ·  ")));
    if (r.sourceUrl) {
      const p = el("p", "calc-blurb");
      const a = el("a", undefined, r.sourceUrl.replace(/^https?:\/\//, "").slice(0, 60)) as HTMLAnchorElement;
      a.href = r.sourceUrl;
      a.target = "_blank";
      a.rel = "noopener";
      p.append("Source: ", a);
      detail.append(p);
    }

    const scaler = el("div", "kit-scaler no-print");
    scaler.append(el("span", undefined, "Servings"));
    const minus = button("−", "btn btn-ghost btn-sm");
    const scaleIn = el("input") as HTMLInputElement;
    scaleIn.type = "number";
    scaleIn.id = "kit-scale";
    scaleIn.min = "1";
    scaleIn.step = "1";
    scaleIn.value = String(r.servings);
    const plus = button("+", "btn btn-ghost btn-sm");
    scaler.append(minus, scaleIn, plus);
    detail.append(scaler);

    const ings = el("ul", "kit-ings");
    ings.id = "kit-detail-ings";
    detail.append(ings);
    const paintIngs = () => {
      const target = Math.max(1, Number(scaleIn.value) || r.servings);
      const factor = target / (r.servings || 1);
      ings.textContent = "";
      for (const raw of r.ingredients) {
        const i = scaleIngredient(raw, factor);
        const li = el("li");
        const q = i.qty == null ? "" : formatQty(i.qty) + (i.qtyMax != null ? `–${formatQty(i.qtyMax)}` : "");
        li.append(el("span", "q", [q, i.unit].filter(Boolean).join(" ")), el("span", undefined, i.note ? `${i.item} (${i.note})` : i.item));
        ings.append(li);
      }
    };
    minus.addEventListener("click", () => { scaleIn.value = String(Math.max(1, Number(scaleIn.value) - 1)); paintIngs(); });
    plus.addEventListener("click", () => { scaleIn.value = String(Number(scaleIn.value) + 1); paintIngs(); });
    scaleIn.addEventListener("input", paintIngs);
    paintIngs();

    if (r.steps.length) {
      detail.append(el("h3", undefined, "Method"));
      const ol = el("ol", "kit-steps");
      for (const s of r.steps) ol.append(el("li", undefined, s));
      detail.append(ol);
    }
    if (r.notes) {
      detail.append(el("h3", undefined, "Notes"));
      detail.append(el("p", undefined, r.notes));
    }

    const row = el("div", "btn-row no-print");
    const status = el("span", "kit-status");
    const cooked = button("Cooked today", "btn btn-ghost btn-sm", () => {
      const today = new Date().toISOString().slice(0, 10);
      commit((rs) => rs.map((x) => (x.id === r.id ? { ...x, lastCookedAt: today } : x)));
      status.textContent = `Marked cooked ${today}.`;
      renderList();
    });
    const copy = button("Copy as Markdown", "btn btn-ghost btn-sm", async () => {
      const scaled = { ...r, ingredients: r.ingredients.map((i) => scaleIngredient(i, (Number(scaleIn.value) || r.servings) / (r.servings || 1))), servings: Number(scaleIn.value) || r.servings };
      status.textContent = (await copyText(recipeToMarkdown(scaled))) ? "Copied." : "Copy failed.";
    });
    copy.id = "kit-copy-md";
    const edit = button("Edit", "btn btn-ghost btn-sm", () => openForm(r));
    const del = button("Delete", "btn btn-ghost btn-sm", () => {
      if (!confirm(`Delete "${r.title}"?`)) return;
      commit((rs) => rs.filter((x) => x.id !== r.id));
      viewId = null;
      renderAll();
    });
    row.append(edit, copy, cooked, del, status);
    detail.append(row);
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderAll(): void {
    renderChips();
    renderList();
    renderDetail();
  }

  renderAll();
}
