// Pro (paywall) client. Every tool stays free and unlimited; Pro unlocks
// exports, saves and sync. See docs/PRO_PLAN.md — this file is the page side
// of that contract, the Worker routes are built separately from it.
//
// proState() reads the vv_pro/vv_owner cookie markers for an instant,
// synchronous answer (so a gated button doesn't flash while a fetch is in
// flight), then confirms with the Worker once per page load and caches that
// answer in sessionStorage. A failed status fetch means "not Pro" — fail
// closed — but never blocks the free tool underneath.

const STATUS_KEY = "vv_pro_status";

export interface ProStatus {
  pro: boolean;
  source: "owner" | "licence" | null;
  plan?: "year" | "month";
  periodEnd?: number;
  configured: boolean;
}

function cookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function markerStatus(): ProStatus {
  const owner = cookie("vv_owner") === "1";
  const pro = owner || cookie("vv_pro") === "1";
  return { pro, source: owner ? "owner" : pro ? "licence" : null, configured: true };
}

function readCache(): ProStatus | null {
  try {
    const raw = sessionStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as ProStatus) : null;
  } catch {
    return null;
  }
}

function writeCache(status: ProStatus): void {
  try {
    sessionStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    /* private mode / quota — the marker cookies still work next load */
  }
}

let current: ProStatus | null = null;
let confirming: Promise<ProStatus> | null = null;

function applyStatus(status: ProStatus): void {
  const changed =
    !current || current.pro !== status.pro || current.source !== status.source || current.configured !== status.configured;
  current = status;
  writeCache(status);
  if (changed) window.dispatchEvent(new CustomEvent<ProStatus>("pro:changed", { detail: status }));
}

function confirmStatus(): Promise<ProStatus> {
  // One in-flight fetch per page load, however many gated buttons ask.
  confirming ??= fetch("/api/pro/status", { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<ProStatus>;
    })
    .catch(() => ({ pro: false, source: null, configured: current?.configured ?? true }) as ProStatus)
    .then((status) => {
      applyStatus(status);
      return status;
    });
  return confirming;
}

export function proState(): ProStatus {
  if (!current) {
    const marker = markerStatus();
    const cached = readCache();
    // Trust the cached (server-confirmed) fields only while its verdict still
    // matches what the cookies say now — otherwise a stale cache could keep
    // showing Pro after a logout/expiry.
    current = cached && cached.pro === marker.pro && cached.source === marker.source ? cached : marker;
    void confirmStatus();
  }
  return current;
}

export function onProChanged(fn: (status: ProStatus) => void): () => void {
  const handler = (event: Event) => fn((event as CustomEvent<ProStatus>).detail);
  window.addEventListener("pro:changed", handler);
  return () => window.removeEventListener("pro:changed", handler);
}

async function restore(key: string): Promise<{ ok: boolean; plan?: "year" | "month" }> {
  const res = await fetch("/api/pro/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const body = (await res.json()) as { ok: boolean; plan?: "year" | "month" };
  if (body.ok) applyStatus({ pro: true, source: "licence", plan: body.plan, configured: true });
  return body;
}

function planButton(plan: "year" | "month", label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pro-upsell-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    btn.setAttribute("disabled", "1");
    fetch("/api/pro/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    })
      .then((res) => res.json())
      .then((body: { url?: string }) => {
        if (body.url) location.assign(body.url);
        else btn.removeAttribute("disabled");
      })
      .catch(() => btn.removeAttribute("disabled"));
  });
  return btn;
}

function buildRestoreForm(onSuccess: () => void): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "pro-upsell-restore";
  const summary = document.createElement("summary");
  summary.textContent = "Have a key? Restore";
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "VV-XXXX-XXXX-XXXX";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Licence key");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "pro-upsell-btn";
  submit.textContent = "Restore";
  const status = document.createElement("span");
  status.className = "pro-upsell-status";
  form.append(input, submit, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    status.textContent = "Checking…";
    submit.setAttribute("disabled", "1");
    restore(key)
      .then((body) => {
        if (body.ok) onSuccess();
        else status.textContent = "Key not recognised.";
      })
      .catch(() => {
        status.textContent = "Offline — try again.";
      })
      .finally(() => submit.removeAttribute("disabled"));
  });
  details.append(summary, form);
  return details;
}

function featureLabel(feature: string): string {
  return feature.replace(/-/g, " ");
}

/** Runs `run` unchanged for Pro/owner; otherwise shows an inline upsell next to `anchor`. */
export function requirePro(feature: string, run: () => void, anchor: HTMLElement): void {
  if (proState().pro) {
    run();
    return;
  }
  const host = anchor.parentElement;
  const existing = host?.querySelector<HTMLElement>(`.pro-upsell[data-feature="${feature}"]`);
  if (existing) {
    existing.remove();
    return; // second click on the same button just closes the panel
  }
  host?.querySelectorAll(".pro-upsell").forEach((panel) => panel.remove());

  const panel = document.createElement("div");
  panel.className = "pro-upsell";
  panel.id = "pro-upsell";
  panel.dataset.feature = feature;

  const lede = document.createElement("p");
  lede.className = "pro-upsell-lede";
  lede.textContent = `${featureLabel(feature)} is a Pro feature. Every tool here stays free and unlimited — Pro adds exports, saves and sync.`;
  panel.append(lede);

  if (proState().configured === false) {
    const note = document.createElement("p");
    note.className = "pro-upsell-note";
    note.textContent = "Not open yet.";
    panel.append(note);
  } else {
    const plans = document.createElement("div");
    plans.className = "pro-upsell-plans";
    plans.append(planButton("year", "Pro — A$39 / year"), planButton("month", "A$5 / month"));
    panel.append(plans);
    panel.append(
      buildRestoreForm(() => {
        panel.remove();
        run();
      }),
    );
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pro-upsell-dismiss";
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", () => panel.remove());
  panel.append(dismiss);

  anchor.insertAdjacentElement("afterend", panel);
}

/** Mounts the buttons/restore/owner-note block used by the /pro page. */
export function mountPro(root: HTMLElement): void {
  const render = (status: ProStatus) => {
    root.innerHTML = "";
    if (status.pro) {
      const note = document.createElement("p");
      note.className = "pro-upsell-note";
      note.textContent =
        status.source === "owner" ? "You're the owner — everything is unlocked." : "You're Pro — exports, saves and sync are unlocked.";
      root.append(note);
      return;
    }
    if (status.configured === false) {
      const note = document.createElement("p");
      note.className = "pro-upsell-note";
      note.textContent = "Not open yet.";
      root.append(note);
      return;
    }
    const plans = document.createElement("div");
    plans.className = "pro-upsell-plans";
    plans.append(planButton("year", "Pro — A$39 / year"), planButton("month", "A$5 / month"));
    root.append(plans);
    root.append(buildRestoreForm(() => render(proState())));
  };
  render(proState());
  onProChanged(render);
}
