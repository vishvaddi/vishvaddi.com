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
const METRIC_ENDPOINT = "/api/metric";

export interface ProStatus {
  pro: boolean;
  source: "owner" | "licence" | null;
  plan?: "year" | "month";
  periodEnd?: number;
  configured: boolean;
  freeRemaining?: number | null;
  // Configured quota (Addendum 3, docs/PRO_PLAN.md) — so copy never hardcodes it.
  freeLimit?: number;
}

/** "1 export" / "3 exports" — the one place the plural is spelled out. */
export function freeLimitLabel(limit: number): string {
  return `${limit} export${limit === 1 ? "" : "s"}`;
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
  // freeLimit is compared too (Addendum 3) — it starts undefined from the
  // synchronous marker read and only arrives once /api/pro/status answers, so
  // a listener relying purely on pro/source/configured would never be told.
  const changed =
    !current ||
    current.pro !== status.pro ||
    current.source !== status.source ||
    current.configured !== status.configured ||
    current.freeLimit !== status.freeLimit;
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
    plans.append(planButton("year", "Pro — A$39 / year"), planButton("month", "A$5 / month"));
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

function showFreeUseNote(anchor: HTMLElement, feature: string, remaining: number, freeLimit: number): void {
  const host = anchor.parentElement;
  host?.querySelector<HTMLElement>(`.pro-free-note[data-feature="${feature}"]`)?.remove();
  const left = Math.max(0, remaining);
  const note = document.createElement("p");
  note.className = "pro-free-note";
  note.dataset.feature = feature;
  // freeLimit === 1 means this use was the free quota — "left" reads oddly at 0.
  note.textContent =
    left > 0
      ? `${left} free export${left === 1 ? "" : "s"} left this month — Pro removes the limit`
      : `That was your ${freeLimit === 1 ? "free export" : "last free export"} this month — Pro removes the limit`;
  anchor.insertAdjacentElement("afterend", note);
}

/**
 * Runs `run` unchanged for Pro/owner. Otherwise calls POST /api/pro/use first:
 * allowed (within the free quota) runs `run` and leaves a one-line note next
 * to `anchor`; blocked (402) or a network error (fail closed) shows the inline
 * upsell panel instead — never a modal, never `alert`.
 */
export function requirePro(feature: string, run: () => void, anchor: HTMLElement): void {
  if (proState().pro) {
    run();
    return;
  }
  const host = anchor.parentElement;
  const existingPanel = host?.querySelector<HTMLElement>(`.pro-upsell[data-feature="${feature}"]`);
  if (existingPanel) {
    existingPanel.remove();
    return; // second click on the same button just closes the panel
  }
  host?.querySelectorAll(".pro-upsell").forEach((panel) => panel.remove());
  host?.querySelector<HTMLElement>(`.pro-free-note[data-feature="${feature}"]`)?.remove();

  const showPanel = (heading: string) => {
    anchor.insertAdjacentElement(
      "afterend",
      buildUpsellPanel(feature, heading, () => {
        host?.querySelector<HTMLElement>(`.pro-upsell[data-feature="${feature}"]`)?.remove();
        run();
      }),
    );
  };

  fetch("/api/pro/use", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature }),
  })
    .then((res) => res.json() as Promise<{ allowed?: boolean; remaining?: number; pro?: boolean; freeLimit?: number }>)
    .then((body) => {
      const freeLimit = body.freeLimit ?? 1;
      if (body.allowed) {
        run();
        if (!body.pro && typeof body.remaining === "number") showFreeUseNote(anchor, feature, body.remaining, freeLimit);
        return;
      }
      showPanel(`You've used your ${freeLimit === 1 ? "free export" : `${freeLimit} free exports`} this month`);
    })
    .catch(() => {
      showPanel("Couldn't check your free uses — try again.");
    });
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
