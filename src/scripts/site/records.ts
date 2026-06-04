// Site Records — running registers for an estimator/site role: variations,
// punch list, deliveries, contacts, daily log. Schema-driven so every register
// shares one add/edit/delete/export engine. Stored in localStorage only; CSP
// clean (all output via textContent, never innerHTML of user data).
import { download, auFmt } from "./calc";

type FieldType = "text" | "number" | "date" | "textarea" | "select";
interface Field { key: string; label: string; type: FieldType; options?: string[] }
interface RecType {
  id: string;
  title: string;
  titleKey: string;
  subKey?: string;
  sumKey?: string;
  sumWhen?: [string, string];
  fields: Field[];
}
type Rec = Record<string, string>;

const TYPES: RecType[] = [
  {
    id: "variations", title: "Variations", titleKey: "number", subKey: "description",
    sumKey: "value", sumWhen: ["status", "Approved"],
    fields: [
      { key: "number", label: "VO number", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "value", label: "Value ($)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Pending", "Submitted", "Approved", "Rejected"] },
      { key: "date", label: "Date", type: "date" },
    ],
  },
  {
    id: "punch", title: "Punch list", titleKey: "item", subKey: "location",
    fields: [
      { key: "item", label: "Item", type: "textarea" },
      { key: "location", label: "Location", type: "text" },
      { key: "trade", label: "Trade", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["Open", "Done"] },
      { key: "date", label: "Date", type: "date" },
    ],
  },
  {
    id: "deliveries", title: "Deliveries", titleKey: "supplier", subKey: "description",
    fields: [
      { key: "supplier", label: "Supplier", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "date", label: "Due / date", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["Pending", "Received"] },
    ],
  },
  {
    id: "contacts", title: "Contacts", titleKey: "name", subKey: "company",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "company", label: "Company", type: "text" },
      { key: "trade", label: "Trade", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
    ],
  },
  {
    id: "log", title: "Daily log", titleKey: "date", subKey: "notes",
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "weather", label: "Weather", type: "text" },
      { key: "labour", label: "Labour on site", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

const mk = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function load(id: string): Rec[] {
  try {
    const r = JSON.parse(localStorage.getItem("vv_rec_" + id) || "[]");
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}
function save(id: string, recs: Rec[]): void {
  try { localStorage.setItem("vv_rec_" + id, JSON.stringify(recs)); } catch { /* ignore */ }
}
function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function initRecords(): void {
  const root = document.getElementById("rec-app");
  if (!root) return;
  let activeIdx = 0;

  const tabs = mk("div", "rec-tabs no-print");
  TYPES.forEach((t, i) => {
    const b = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
    b.type = "button";
    b.textContent = t.title;
    b.addEventListener("click", () => { activeIdx = i; paintTabs(); renderBody(); });
    tabs.append(b);
  });
  const body = mk("div");
  root.append(tabs, body);

  function paintTabs(): void {
    Array.from(tabs.children).forEach((b, i) => {
      const el = b as HTMLElement;
      el.style.borderColor = i === activeIdx ? "var(--site-accent)" : "";
      el.style.color = i === activeIdx ? "var(--fg)" : "";
    });
  }

  function renderBody(): void {
    const type = TYPES[activeIdx];
    body.textContent = "";
    let recs = load(type.id);
    let editingId: string | null = null;

    // ── Add / edit form ──
    const form = mk("div", "calc");
    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
    const fieldsWrap = mk("div", "calc-fields");
    for (const f of type.fields) {
      const wrap = mk("div", "field");
      wrap.append(mk("label", undefined, f.label));
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (f.type === "textarea") {
        const ta = document.createElement("textarea");
        ta.rows = 2;
        input = ta;
      } else if (f.type === "select") {
        const sel = document.createElement("select");
        for (const o of f.options || []) {
          const op = document.createElement("option");
          op.value = o;
          op.textContent = o;
          sel.append(op);
        }
        input = sel;
      } else {
        const inp = document.createElement("input");
        inp.type = f.type;
        input = inp;
      }
      inputs[f.key] = input;
      wrap.append(input);
      fieldsWrap.append(wrap);
    }
    form.append(fieldsWrap);
    const addBtn = mk("button", "btn") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.textContent = "Add";
    const formRow = mk("div", "btn-row no-print");
    formRow.append(addBtn);
    form.append(formRow);
    body.append(form);

    const clearForm = (): void => {
      for (const f of type.fields) (inputs[f.key] as HTMLInputElement).value = "";
      editingId = null;
      addBtn.textContent = "Add";
    };

    addBtn.addEventListener("click", () => {
      const rec: Rec = { _id: editingId || uid() };
      let hasVal = false;
      for (const f of type.fields) {
        const v = (inputs[f.key] as HTMLInputElement).value.trim();
        rec[f.key] = v;
        if (v) hasVal = true;
      }
      if (!hasVal) return;
      recs = editingId ? recs.map((r) => (r._id === editingId ? rec : r)) : [rec, ...recs];
      save(type.id, recs);
      clearForm();
      renderList();
    });

    const totalsWrap = mk("div");
    const listWrap = mk("div");
    body.append(totalsWrap, listWrap);

    const exportRow = mk("div", "btn-row no-print");
    const exportBtn = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
    exportBtn.type = "button";
    exportBtn.textContent = "Export CSV";
    exportBtn.addEventListener("click", () => exportCsv(type, recs));
    const clearBtn = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
    clearBtn.type = "button";
    clearBtn.textContent = "Clear all";
    clearBtn.addEventListener("click", () => {
      if (!recs.length) return;
      if (confirm(`Delete all ${type.title.toLowerCase()} records? This can't be undone.`)) {
        recs = [];
        save(type.id, recs);
        clearForm();
        renderList();
      }
    });
    exportRow.append(exportBtn, clearBtn);
    body.append(exportRow);

    function renderTotals(): void {
      totalsWrap.textContent = "";
      const grid = mk("div", "stat-grid");
      const count = mk("div", "stat");
      count.append(mk("div", "n", String(recs.length)), mk("div", "l", "Records"));
      grid.append(count);
      if (type.sumKey) {
        let sum = 0;
        for (const r of recs) {
          if (type.sumWhen && r[type.sumWhen[0]] !== type.sumWhen[1]) continue;
          const n = parseFloat(r[type.sumKey] || "");
          if (Number.isFinite(n)) sum += n;
        }
        const c = mk("div", "stat");
        c.append(mk("div", "n", "$" + auFmt(sum, 0)), mk("div", "l", type.sumWhen ? `${type.sumWhen[1]} value` : "Total value"));
        grid.append(c);
      }
      totalsWrap.append(grid);
    }

    function renderList(): void {
      renderTotals();
      listWrap.textContent = "";
      if (!recs.length) {
        listWrap.append(mk("p", "calc-blurb", "No records yet — add one above."));
        return;
      }
      for (const r of recs) {
        const card = mk("div", "rec-card");
        const head = mk("div", "rec-card-head");
        head.append(mk("span", "rec-title", r[type.titleKey] || "(untitled)"));
        if (r.status) head.append(mk("span", "rec-chip", r.status));
        card.append(head);
        if (type.subKey && r[type.subKey]) card.append(mk("div", "rec-sub", r[type.subKey]));
        const metas: string[] = [];
        for (const f of type.fields) {
          if (f.key === type.titleKey || f.key === type.subKey || f.key === "status") continue;
          if (r[f.key]) metas.push(`${f.label}: ${r[f.key]}`);
        }
        if (metas.length) card.append(mk("div", "rec-meta", metas.join("  ·  ")));
        const act = mk("div", "btn-row no-print");
        const ed = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
        ed.type = "button";
        ed.textContent = "Edit";
        ed.addEventListener("click", () => {
          for (const f of type.fields) (inputs[f.key] as HTMLInputElement).value = r[f.key] || "";
          editingId = r._id;
          addBtn.textContent = "Save changes";
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        const del = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
        del.type = "button";
        del.textContent = "Delete";
        del.addEventListener("click", () => {
          recs = recs.filter((x) => x._id !== r._id);
          save(type.id, recs);
          if (editingId === r._id) clearForm();
          renderList();
        });
        act.append(ed, del);
        card.append(act);
        listWrap.append(card);
      }
    }

    renderList();
  }

  function exportCsv(type: RecType, recs: Rec[]): void {
    const esc = (s: string): string => `"${(s || "").replace(/"/g, '""')}"`;
    const lines = [type.fields.map((f) => esc(f.label)).join(",")];
    for (const r of recs) lines.push(type.fields.map((f) => esc(r[f.key])).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    download(`${type.id}.csv`, URL.createObjectURL(blob));
  }

  paintTabs();
  renderBody();
}
