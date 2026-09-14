// Shared persistence for the personal tools. Every tool keeps one JSON document
// in localStorage under `vv_<key>` and can opt in to mirroring it through the
// Worker's /api/store/<key> route so phone and laptop see the same data.
// Sync is off until the user turns it on per tool; the local copy always wins
// for reads so the pages work offline and before the first sync.

export interface StoreDoc<T> {
  version: number;
  data: T;
}

export interface SyncState {
  enabled: boolean;
  revision: number;
  lastSync: number | null;
  error: string | null;
}

export interface Store<T> {
  readonly key: string;
  get(): T;
  set(data: T): void;
  update(fn: (data: T) => T | void): T;
  subscribe(fn: (data: T) => void): () => void;
  exportJson(): string;
  importJson(text: string): T;
  sync(): SyncState;
  setSyncEnabled(enabled: boolean): Promise<SyncState>;
  pull(): Promise<SyncState>;
  push(): Promise<SyncState>;
}

const LOCAL_PREFIX = "vv_";
const SYNC_PREFIX = "vv_sync_";

function readLocal<T>(key: string, version: number, fallback: () => T, migrate?: (doc: StoreDoc<unknown>) => T): T {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key);
    if (!raw) return fallback();
    const doc = JSON.parse(raw) as StoreDoc<unknown>;
    if (!doc || typeof doc !== "object" || !("data" in doc)) return fallback();
    if (doc.version !== version) return migrate ? migrate(doc) : fallback();
    return doc.data as T;
  } catch {
    return fallback();
  }
}

function writeLocal<T>(key: string, version: number, data: T): void {
  try { localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify({ version, data })); } catch { /* quota or private mode */ }
}

function readSync(key: string): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_PREFIX + key);
    if (raw) return { enabled: false, revision: 0, lastSync: null, error: null, ...(JSON.parse(raw) as Partial<SyncState>) };
  } catch { /* fall through */ }
  return { enabled: false, revision: 0, lastSync: null, error: null };
}

function writeSync(key: string, state: SyncState): void {
  try { localStorage.setItem(SYNC_PREFIX + key, JSON.stringify(state)); } catch { /* ignore */ }
}

export function createStore<T>(options: {
  key: string;
  version: number;
  initial: () => T;
  migrate?: (doc: StoreDoc<unknown>) => T;
  validate?: (data: unknown) => data is T;
}): Store<T> {
  const { key, version, initial, migrate, validate } = options;
  let data = readLocal<T>(key, version, initial, migrate);
  let syncState = readSync(key);
  const listeners = new Set<(data: T) => void>();
  let pushTimer: number | undefined;

  const notify = () => listeners.forEach((fn) => fn(data));
  const persist = () => {
    writeLocal(key, version, data);
    notify();
    if (syncState.enabled) schedulePush();
  };

  function schedulePush(): void {
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => { void push(); }, 1500);
  }

  function setState(next: Partial<SyncState>): SyncState {
    syncState = { ...syncState, ...next };
    writeSync(key, syncState);
    return syncState;
  }

  async function pull(): Promise<SyncState> {
    if (!syncState.enabled) return syncState;
    try {
      const res = await fetch(`/api/store/${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
      if (res.status === 404) {
        // Nothing in the cloud yet: seed it from this device.
        return push();
      }
      if (!res.ok) return setState({ error: `pull failed (${res.status})` });
      const body = (await res.json()) as { revision: number; updatedAt: number; doc: StoreDoc<unknown> };
      if (body.revision === syncState.revision) return setState({ error: null, lastSync: Date.now() });
      const incoming = body.doc;
      if (!incoming || incoming.version !== version || (validate && !validate(incoming.data))) {
        return setState({ error: "cloud copy has a different format" });
      }
      data = incoming.data as T;
      writeLocal(key, version, data);
      notify();
      return setState({ revision: body.revision, error: null, lastSync: Date.now() });
    } catch {
      return setState({ error: "offline" });
    }
  }

  async function push(): Promise<SyncState> {
    if (!syncState.enabled) return syncState;
    try {
      const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: syncState.revision, doc: { version, data } }),
      });
      if (res.status === 409) {
        // Another device wrote first. Take its copy, then the user's next edit re-pushes.
        const body = (await res.json()) as { revision: number };
        setState({ revision: 0 });
        const pulled = await pull();
        return pulled.error ? pulled : setState({ revision: body.revision ?? pulled.revision });
      }
      if (!res.ok) return setState({ error: `push failed (${res.status})` });
      const body = (await res.json()) as { revision: number };
      return setState({ revision: body.revision, error: null, lastSync: Date.now() });
    } catch {
      return setState({ error: "offline" });
    }
  }

  const store: Store<T> = {
    key,
    get: () => data,
    set(next) { data = next; persist(); },
    update(fn) {
      const result = fn(data);
      if (result !== undefined) data = result;
      persist();
      return data;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    exportJson: () => JSON.stringify({ key, version, exportedAt: new Date().toISOString(), data }, null, 2),
    importJson(text) {
      const parsed = JSON.parse(text) as { key?: string; version?: number; data?: unknown };
      if (parsed.key !== key) throw new Error(`This file is for "${parsed.key ?? "unknown"}", not "${key}".`);
      const doc = parsed.version === version ? parsed.data : migrate ? migrate({ version: parsed.version ?? 0, data: parsed.data }) : undefined;
      if (doc === undefined || (validate && !validate(doc))) throw new Error("File contents don't match this tool.");
      data = doc as T;
      persist();
      return data;
    },
    sync: () => syncState,
    async setSyncEnabled(enabled) {
      setState({ enabled, error: null, ...(enabled ? {} : { revision: 0 }) });
      return enabled ? pull() : syncState;
    },
    pull,
    push,
  };

  if (syncState.enabled) {
    void pull();
    window.addEventListener("online", () => { void pull(); });
  }
  return store;
}

// Small shared UI: export / import buttons plus the sync toggle, so every tool
// exposes the same controls in the same order.
export function mountStoreControls<T>(host: HTMLElement, store: Store<T>, opts: { filename: string; onImport?: () => void }): void {
  host.innerHTML = "";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-ghost btn-sm";
  exportBtn.textContent = "Export JSON";
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = opts.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const importLabel = document.createElement("label");
  importLabel.className = "btn btn-ghost btn-sm";
  importLabel.textContent = "Import JSON";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.hidden = true;
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      store.importJson(await file.text());
      opts.onImport?.();
      status.textContent = "Imported.";
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Import failed.";
    }
    importInput.value = "";
  });
  importLabel.append(importInput);

  const syncLabel = document.createElement("label");
  syncLabel.className = "store-sync";
  const syncBox = document.createElement("input");
  syncBox.type = "checkbox";
  syncBox.checked = store.sync().enabled;
  syncBox.setAttribute("data-store-sync", store.key);
  syncLabel.append(syncBox, document.createTextNode(" Sync across devices"));
  const status = document.createElement("span");
  status.className = "store-status";
  const paintStatus = (s: ReturnType<typeof store.sync>) => {
    if (!s.enabled) { status.textContent = "On this device only."; return; }
    status.textContent = s.error ? `Sync: ${s.error}` : s.lastSync ? `Synced ${new Date(s.lastSync).toLocaleTimeString()}` : "Syncing…";
  };
  syncBox.addEventListener("change", async () => {
    paintStatus(await store.setSyncEnabled(syncBox.checked));
    if (syncBox.checked) opts.onImport?.();
  });
  paintStatus(store.sync());
  store.subscribe(() => setTimeout(() => paintStatus(store.sync()), 1600));

  host.append(exportBtn, importLabel, syncLabel, status);
}

export function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
