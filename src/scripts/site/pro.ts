// Pro (paywall) client. Every tool, feature and export is free; Pro puts the
// visitor's brand on client-facing exports and unlocks sync and the Pro-only
// audio exports (last addendum, docs/PRO_PLAN.md). This file is the page side
// of that contract, the Worker routes are built separately from it.
//
// proState() reads the vv_pro/vv_owner cookie markers for an instant,
// synchronous answer (so a gated button doesn't flash while a fetch is in
// flight), then confirms with the Worker once per page load and caches that
// answer in sessionStorage. A failed status fetch means "not Pro" — fail
// closed — but never blocks the free tool underneath.

const STATUS_KEY = "vv_pro_status";

export type Plan = "year" | "month" | "week";
// Must match the Stripe prices wired to STRIPE_PRICE_* in wrangler.jsonc.
const PLAN_BUTTONS: ReadonlyArray<[Plan, string]> = [
  ["year", "Pro — A$100 / year"],
  ["month", "A$20 / month"],
  ["week", "A$5 / week"],
];
const METRIC_ENDPOINT = "/api/metric";

export interface ProStatus {
  pro: boolean;
  source: "owner" | "licence" | null;
  plan?: Plan;
  periodEnd?: number;
  configured: boolean;
}

/**
 * Fire-and-forget funnel counter (Addendum 3, docs/PRO_PLAN.md). sendBeacon
 * survives page unload (e.g. a checkout redirect); fetch keepalive is the
 * fallback for browsers/contexts without it. Never awaited by a caller, never
 * throws, carries no PII.
 */
export function track(event: string): void {
  const payload = JSON.stringify({ event });
  try {
    if (navigator.sendBeacon?.(METRIC_ENDPOINT, new Blob([payload], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  try {
    fetch(METRIC_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  } catch {
    /* ignore — a lost metric is not worth surfacing */
  }
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

async function restore(key: string): Promise<{ ok: boolean; plan?: Plan }> {
  const res = await fetch("/api/pro/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const body = (await res.json()) as { ok: boolean; plan?: Plan };
  if (body.ok) applyStatus({ pro: true, source: "licence", plan: body.plan, configured: true });
  return body;
}

function planButton(plan: Plan, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pro-upsell-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    track("checkout_click");
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

function buildUpsellPanel(feature: string, heading: string, onRestored: () => void): HTMLDivElement {
  track("upsell_shown");
  const panel = document.createElement("div");
  panel.className = "pro-upsell";
  panel.id = "pro-upsell";
  panel.dataset.feature = feature;

  const lede = document.createElement("p");
  lede.className = "pro-upsell-lede";
  lede.textContent = heading;
  panel.append(lede);

  if (proState().configured === false) {
    const note = document.createElement("p");
    note.className = "pro-upsell-note";
    note.textContent = "Not open yet.";
    panel.append(note);
  } else {
    const plans = document.createElement("div");
    plans.className = "pro-upsell-plans";
    plans.append(...PLAN_BUTTONS.map(([plan, label]) => planButton(plan, label)));
    panel.append(plans);
    panel.append(buildRestoreForm(onRestored));
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pro-upsell-dismiss";
  dismiss.textContent = "Not now";
  dismiss.addEventListener("click", () => panel.remove());
  panel.append(dismiss);
  return panel;
}

const PRO_ONLY_HEADINGS: Record<string, string> = {
  "studio-mp3-export": "MP3 export comes with Pro — WAV export stays free.",
  "studio-stem-export": "Stem export comes with Pro — WAV master export stays free.",
  "lofi-mp3-format": "MP3 download comes with Pro — WAV stays free.",
  "audio-prep-batch-download": "Batch download comes with Pro — single files stay free.",
};

/**
 * Pro-only features: runs `run` for Pro/owner, otherwise shows the inline
 * upsell panel next to `anchor` (never a modal, never `alert`). Nothing is
 * metered, so no request is made before deciding.
 */
export function requirePro(feature: string, run: () => void, anchor: HTMLElement): void {
  if (proState().pro) {
    run();
    return;
  }
  showProOnly(feature, PRO_ONLY_HEADINGS[feature] ?? "This comes with Pro.", anchor, run);
}

/** The one panel path: a second call for the same feature closes it. */
export function showProOnly(feature: string, heading: string, anchor: HTMLElement, onRestored: () => void = () => {}): void {
  const host = anchor.parentElement;
  const existing = host?.querySelector<HTMLElement>(`.pro-upsell[data-feature="${feature}"]`);
  if (existing) {
    existing.remove();
    return;
  }
  host?.querySelectorAll(".pro-upsell").forEach((panel) => panel.remove());
  anchor.insertAdjacentElement(
    "afterend",
    buildUpsellPanel(feature, heading, () => {
      host?.querySelector<HTMLElement>(`.pro-upsell[data-feature="${feature}"]`)?.remove();
      onRestored();
    }),
  );
}

/** Mounts the buttons/restore/owner-note block used by the /pro page. */
export function mountPro(root: HTMLElement): void {
  const render = (status: ProStatus) => {
    root.innerHTML = "";
    if (status.pro) {
      const note = document.createElement("p");
      note.className = "pro-upsell-note";
      note.textContent =
        status.source === "owner" ? "You're the owner — everything is unlocked." : "You're Pro — your brand on exports, sync and Studio/audio MP3 exports are unlocked.";
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
    plans.append(...PLAN_BUTTONS.map(([plan, label]) => planButton(plan, label)));
    root.append(plans);
    root.append(buildRestoreForm(() => render(proState())));
  };
  render(proState());
  onProChanged(render);
}
