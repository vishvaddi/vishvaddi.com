// Field-survival toolkit for the /site section. Ported from the OneScope app's
// prepping view, rebuilt CSP-clean: external module (no inline script), all
// dynamic output written via textContent (never innerHTML of user/computed
// data). Anything saved lives only in THIS browser (localStorage).
import { mountCalcs, type CalcSpec } from "./calc";

// ── small DOM helpers ────────────────────────────────────────────────────────
const mk = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const section = (title: string): HTMLElement => {
  const s = mk("section", "calc");
  s.append(mk("h2", undefined, title));
  return s;
};
const blurb = (text: string): HTMLElement => mk("p", "calc-blurb", text);
const today = (): string => new Date().toISOString().slice(0, 10);

// ── reference data ───────────────────────────────────────────────────────────
const RULE3: [string, string][] = [
  ["3 sec", "Attitude — the will to act"],
  ["3 min", "Air, or uncontrolled bleeding"],
  ["3 hr", "Shelter in harsh conditions"],
  ["3 days", "Water"],
  ["3 wks", "Food"],
];

const CONTACTS: [string, string][] = [
  ["000", "Police / Fire / Ambulance"],
  ["112", "Emergency from mobile (any network)"],
  ["132500", "SES — flood & storm"],
  ["131126", "Poisons Information"],
  ["1800641792", "Marine Rescue / Coast Guard"],
];

const THREATS: [string, string][] = [
  ["Jan–Feb", "Heatwave, severe storms, bushfire (peak)"],
  ["Mar–May", "East Coast Lows, flooding, cyclone tail-ends"],
  ["Jun–Aug", "Cold fronts, fog, storm surge"],
  ["Sep–Nov", "Bushfire onset, spring storms"],
  ["Oct–Mar", "Elevated fire danger — stay kit-ready"],
];

const BRADLEY14 = [
  "Positive mental attitude", "First aid", "Shelter", "Fire", "Signalling",
  "Personal protection (clothing)", "Will to survive", "Food", "Water",
  "Navigation", "Tools / knives", "Rope & cordage", "Cross-training", "Luck",
];

const PILLARS = ["Power", "Water", "Food", "Skills"] as const;

interface KitItem { key: string; label: string; days: number; cadence: string }
const KIT: KitItem[] = [
  { key: "kit", label: "Kit check", days: 90, cadence: "every 3 months" },
  { key: "water", label: "Water rotation", days: 180, cadence: "every 6 months" },
  { key: "food", label: "Food rotation", days: 30, cadence: "monthly" },
];

const WEEK52 = [
  "Audit your grab bag — replace expired items",
  "Check water storage — taste & condition",
  "Practise fire-starting without matches",
  "Review evacuation route on foot",
  "Update emergency contact card",
  "Rotate canned food stock (FIFO)",
  "Check first aid kit — restock bandages & gloves",
  "Test battery-powered radio",
  "Learn or review tourniquet application",
  "Check fuel levels in vehicles",
  "Practise shelter setup (tarp/tent)",
  "Check all flashlights + spare batteries",
  "Review financial emergency plan",
  "Check medications — expiry dates",
  "Walk/drive alternate exit routes",
  "Verify document backups (digital + hard copy)",
  "Practise navigation with map + compass (no GPS)",
  "Stock-take food pantry",
  "Test smoke & CO detectors",
  "Review BOM seasonal outlook",
  "Check fire extinguisher pressure + expiry",
  "Practise basic knots (bowline, clove hitch, figure-8)",
  "Review communications plan with household",
  "Check water filtration kit (filter, tablets)",
  "Audit spare clothing in grab bag",
  "Stock-check power bank + solar charger",
  "Review bushfire plan if in a risk zone",
  "Practise hands-free comms (radio, whistle signals)",
  "Check tyre pressures + spare tyre",
  "Learn or review wound irrigation technique",
  "Test & refill gas canister stash",
  "Practise fire evacuation drill",
  "Update emergency plan for kids/elderly in household",
  "Check rain catchment setup",
  "Review cyber-resilience (password manager, 2FA)",
  "Stock-check seeds for the garden (food resilience)",
  "Practise water purification end-to-end",
  "Check footwear in grab bag — fit & condition",
  "Review SES flood map for your area",
  "Restock personal hygiene items",
  "Practise signalling techniques (mirror, whistle)",
  "Check generator fuel + test run (if applicable)",
  "Review any changes to local emergency services",
  "Test UV water purification device",
  "Practise building an emergency shelter",
  "Stock-check duct tape, zip ties, cordage",
  "Full grab-bag rehearsal — pack in under 10 min",
  "Update digital cloud backup",
  "Review annual prepping budget",
  "Practise basic first aid scenarios (choking, CPR)",
  "Final FIFO food rotation for the year",
  "Year-end review + set goals for next year",
];

// ── localStorage helpers ─────────────────────────────────────────────────────
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ── kit status ───────────────────────────────────────────────────────────────
function daysUntilDue(last: string | undefined, cadence: number): number | null {
  if (!last) return null;
  const diff = Date.now() - new Date(last + "T00:00:00").getTime();
  return cadence - Math.floor(diff / 86400000);
}
function statusText(days: number | null): string {
  if (days === null) return "Never logged — overdue";
  if (days <= 0) return `Overdue by ${Math.abs(days)}d`;
  return `Due in ${days}d`;
}

// ── SOS morse: audio + vibrate + screen flash (no network, CSP-clean) ─────────
function playSOS(): void {
  // S O S = ... --- ...
  const pattern = [100, 100, 100, 100, 100, 100, 300, 100, 300, 100, 300, 100, 100, 100, 100, 100, 100];
  if ("vibrate" in navigator) navigator.vibrate(pattern);

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (Ctx) {
    const ctx = new Ctx();
    let t = ctx.currentTime;
    const seq = [
      ...Array(3).fill({ dur: 0.1, gap: 0.1 }),
      ...Array(3).fill({ dur: 0.3, gap: 0.1 }),
      ...Array(3).fill({ dur: 0.1, gap: 0.1 }),
    ] as { dur: number; gap: number }[];
    for (const { dur, gap } of seq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.setValueAtTime(0, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + gap;
    }
  }

  let flashes = 0;
  const prev = document.body.style.background;
  const iv = setInterval(() => {
    document.body.style.background = flashes % 2 === 0 ? "#FFCC00" : prev;
    if (++flashes > 12) { clearInterval(iv); document.body.style.background = prev; }
  }, 250);
}

// ── main ─────────────────────────────────────────────────────────────────────
export function initPrepping(): void {
  const root = document.getElementById("prep-app");
  if (!root) return;

  // Calculators (declarative, XSS-safe via mountCalcs/textContent)
  const calcs: CalcSpec[] = [
    {
      id: "food",
      title: "Food reserve",
      blurb: "How many calories a reserve needs to carry your household for a target window.",
      fields: [
        { id: "cal", label: "Cal / person / day", def: "2000", min: "800", step: "100" },
        { id: "people", label: "People", def: "2", min: "1", step: "1" },
        { id: "days", label: "Target days", def: "90", min: "1", step: "1" },
      ],
      compute: (v) => {
        const total = v.cal * v.people * v.days;
        if (!total) return null;
        return {
          rows: [
            [total.toLocaleString("en-AU"), "Total calories"],
            [`${(total / 1000).toFixed(0)}k`, "kcal"],
            [`${v.people ? (total / 100 / v.people).toFixed(0) : "0"}`, "100-cal packs / person"],
          ],
        };
      },
    },
    {
      id: "water",
      title: "Water need",
      blurb: "Drinking and cooking water by household size, days and activity level.",
      fields: [
        { id: "persons", label: "Persons", def: "2", min: "1", step: "1" },
        { id: "days", label: "Days", def: "3", min: "1", step: "1" },
        { id: "perday", label: "L / person / day (2 rest – 6 heat)", def: "3", min: "1", step: "0.5" },
        { id: "cook", label: "Cooking L / person / day", def: "0", min: "0", step: "0.5" },
      ],
      compute: (v) => {
        const total = v.persons * v.days * (v.perday + v.cook);
        if (!total) return null;
        return {
          rows: [
            [`${total.toFixed(0)} L`, "Water needed"],
            [`${Math.ceil(total / 20)}`, "20 L jerricans"],
          ],
        };
      },
    },
    {
      id: "gethome",
      title: "Get-home walk",
      blurb: "On-foot time to cover a distance home, allowing for terrain and load.",
      fields: [
        { id: "dist", label: "Distance home (km)", def: "10", min: "0", step: "0.5" },
        { id: "pace", label: "Pace (km/h)", def: "4", min: "1", step: "0.5" },
        { id: "factor", label: "Terrain / load factor", def: "1.3", min: "1", step: "0.1" },
      ],
      compute: (v) => {
        if (!v.dist || !v.pace) return null;
        const hours = (v.dist / v.pace) * (v.factor || 1);
        return {
          rows: [
            [`${hours.toFixed(1)} h`, "Walk time"],
            [`${(hours / 8).toFixed(1)}`, "Days @ 8h walking"],
          ],
          warn: hours > 8 ? "Over a day on foot — plan water, shelter and a rest point." : undefined,
        };
      },
    },
  ];

  // ── Emergency contacts ──
  const contacts = section("Emergency numbers");
  contacts.append(blurb("Australia. Tap to call. Save a copy off-screen too — a card in the kit and wallet."));
  for (const [num, label] of CONTACTS) {
    const a = document.createElement("a");
    a.href = `tel:${num}`;
    a.className = "saved-row";
    a.style.textDecoration = "none";
    a.style.color = "inherit";
    const left = mk("span", undefined, num.replace(/(\d{2,4})(?=(\d{3})+(?!\d))/g, "$1 ").trim());
    a.append(left, mk("span", "l", label));
    contacts.append(a);
  }
  root.append(contacts);

  // ── Rule of threes ──
  const r3 = section("Rule of threes");
  const r3grid = mk("div", "stat-grid");
  for (const [time, label] of RULE3) {
    const cell = mk("div", "stat");
    cell.append(mk("div", "n", time), mk("div", "l", label));
    r3grid.append(cell);
  }
  r3.append(r3grid);
  root.append(r3);

  // ── Calculators ──
  mountCalcs(root, calcs);

  // ── Find nearby (live map; tiles + Overpass proxied same-origin) ──
  const nearby = section("Find nearby");
  nearby.append(blurb("Maps essentials within ~2 km — water, toilets, fuel, hospital, pharmacy, police, supermarkets. Your location is sent only to this site's own server to run the lookup; it is never stored."));
  const loadBtn = mk("button", "btn") as HTMLButtonElement;
  loadBtn.type = "button";
  loadBtn.textContent = "Load map";
  const loadRow = mk("div", "btn-row no-print");
  loadRow.append(loadBtn);
  nearby.append(loadRow);
  const mapWrap = mk("div");
  mapWrap.id = "prep-map";
  mapWrap.style.cssText = "height:360px;border:1px solid var(--site-line-strong);border-radius:6px;overflow:hidden;margin-top:0.5rem;display:none;";
  nearby.append(mapWrap);
  const poiRow = mk("div", "btn-row no-print");
  poiRow.style.display = "none";
  nearby.append(poiRow);
  const nbStatus = mk("p", "calc-blurb");
  nearby.append(nbStatus);
  root.append(nearby);

  const POI: [string, string, string, string][] = [
    ["drinking_water", "Water", "amenity", "drinking_water"],
    ["toilets", "Toilets", "amenity", "toilets"],
    ["fuel", "Petrol", "amenity", "fuel"],
    ["hospital", "Hospital", "amenity", "hospital"],
    ["pharmacy", "Pharmacy", "amenity", "pharmacy"],
    ["police", "Police", "amenity", "police"],
    ["supermarket", "Supermarket", "shop", "supermarket"],
    ["atm", "ATM", "amenity", "atm"],
  ];

  loadBtn.addEventListener("click", async () => {
    loadBtn.disabled = true;
    loadBtn.textContent = "Loading map…";
    let L: any;
    try {
      const mod: any = await import("leaflet");
      L = mod.default ?? mod;
      await import("leaflet/dist/leaflet.css");
    } catch {
      nbStatus.textContent = "Map failed to load — check your connection or ad blocker.";
      loadBtn.disabled = false;
      loadBtn.textContent = "Load map";
      return;
    }
    loadBtn.style.display = "none";
    mapWrap.style.display = "block";
    poiRow.style.display = "flex";

    const map = L.map(mapWrap).setView([-33.87, 151.21], 13); // Sydney fallback
    L.tileLayer("/api/poi/tiles/{z}/{x}/{y}", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);

    let here: { lat: number; lon: number } | null = null;
    const layers = new Map<string, any>();
    const active = new Set<string>();

    const locate = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
    locate.type = "button";
    locate.textContent = "📍 My location";
    locate.addEventListener("click", () => {
      if (!navigator.geolocation) { nbStatus.textContent = "Geolocation not available on this device."; return; }
      nbStatus.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          map.setView([here.lat, here.lon], 15);
          L.circleMarker([here.lat, here.lon], { radius: 8, color: "#2f6df0", fillColor: "#2f6df0", fillOpacity: 0.6 }).addTo(map).bindPopup("You are here");
          nbStatus.textContent = "";
        },
        () => { nbStatus.textContent = "Couldn't get your location — allow access and tap “My location” again."; }
      );
    });
    poiRow.append(locate);

    async function overpass(k: string, v: string, lat: number, lon: number): Promise<any[]> {
      const q = `[out:json][timeout:15];(node["${k}"="${v}"](around:2000,${lat},${lon}););out body;`;
      try {
        const r = await fetch("/api/poi/overpass", { method: "POST", body: q });
        if (!r.ok) return [];
        const data = await r.json();
        return data.elements || [];
      } catch { return []; }
    }

    for (const [id, label, k, v] of POI) {
      const b = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", async () => {
        const c = map.getCenter();
        const center = here ?? { lat: c.lat, lon: c.lng };
        if (active.has(id)) {
          active.delete(id); b.style.borderColor = "";
          const lg = layers.get(id); if (lg) map.removeLayer(lg); layers.delete(id);
          return;
        }
        active.add(id); b.style.borderColor = "var(--site-accent)";
        nbStatus.textContent = `Searching ${label.toLowerCase()}…`;
        const els = await overpass(k, v, center.lat, center.lon);
        const lg = L.layerGroup();
        for (const e of els) {
          if (e.lat == null || e.lon == null) continue;
          const name = (e.tags && (e.tags.name || e.tags.amenity || e.tags.shop)) || label;
          L.circleMarker([e.lat, e.lon], { radius: 6, color: "#1f7a3d", fillColor: "#28a745", fillOpacity: 0.85 }).bindPopup(name).addTo(lg);
        }
        lg.addTo(map); layers.set(id, lg);
        nbStatus.textContent = els.length ? `${els.length} ${label.toLowerCase()} within 2 km.` : `No ${label.toLowerCase()} found within 2 km.`;
      });
      poiRow.append(b);
    }

    locate.click(); // try to centre on the user immediately
  });

  // ── Kit maintenance tracker ──
  const kitState = load<Record<string, string>>("vv_prep_kit", {});
  const kitSec = section("Kit maintenance");
  kitSec.append(blurb("Log when each was last done. Stored only in this browser."));
  for (const item of KIT) {
    const wrap = mk("div", "field");
    const lab = mk("label", undefined, `${item.label} — last done (${item.cadence})`);
    const status = mk("span", "l");
    const refresh = () => { status.textContent = statusText(daysUntilDue(kitState[item.key], item.days)); };
    const input = document.createElement("input");
    input.type = "date";
    input.max = today();
    if (kitState[item.key]) input.value = kitState[item.key];
    input.addEventListener("change", () => {
      kitState[item.key] = input.value;
      save("vv_prep_kit", kitState);
      refresh();
    });
    refresh();
    lab.append(" — ", status);
    wrap.append(lab, input);
    kitSec.append(wrap);
  }
  root.append(kitSec);

  // ── Bradley's 14 checklist ──
  const b14State = load<Record<string, boolean>>("vv_prep_b14", {});
  const b14Sec = section("Bradley's 14 needs");
  b14Sec.append(blurb("A granular audit of everything that keeps you alive."));
  BRADLEY14.forEach((need, i) => {
    const row = mk("label", "saved-row");
    row.style.cursor = "pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.style.width = "auto";
    cb.checked = !!b14State[i];
    cb.addEventListener("change", () => { b14State[i] = cb.checked; save("vv_prep_b14", b14State); });
    const span = mk("span", undefined, need);
    span.style.fontFamily = "var(--font-sans)";
    row.append(span, cb);
    b14Sec.append(row);
  });
  root.append(b14Sec);

  // ── Four pillars ──
  const pillarState = load<Record<string, number>>("vv_prep_pillars", {});
  const pillarSec = section("Self-sufficiency pillars (0–5)");
  pillarSec.append(blurb("Rate where you stand on each. Honest beats optimistic."));
  const pillarFields = mk("div", "calc-fields");
  for (const p of PILLARS) {
    const wrap = mk("div", "field");
    wrap.append(mk("label", undefined, p));
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "5";
    input.step = "1";
    input.value = String(pillarState[p] ?? 0);
    input.addEventListener("change", () => {
      pillarState[p] = Math.max(0, Math.min(5, Number(input.value) || 0));
      input.value = String(pillarState[p]);
      save("vv_prep_pillars", pillarState);
    });
    wrap.append(input);
    pillarFields.append(wrap);
  }
  pillarSec.append(pillarFields);
  root.append(pillarSec);

  // ── 52-week routine ──
  const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
  const week = Math.min(52, Math.max(1, Math.ceil((Date.now() - startOfYear) / (7 * 86400000))));
  const weekSec = section("This week's prep task");
  weekSec.append(mk("p", "calc-blurb", `Week ${week} of 52`));
  const weekStat = mk("div", "stat");
  weekStat.append(mk("div", "n", `Wk ${week}`), mk("div", "l", WEEK52[week - 1]));
  weekSec.append(weekStat);
  const det = document.createElement("details");
  det.style.marginTop = "0.9rem";
  const sum = document.createElement("summary");
  sum.textContent = "Full 52-week routine";
  sum.style.cursor = "pointer";
  det.append(sum);
  const ol = document.createElement("ol");
  ol.style.fontSize = "0.85rem";
  ol.style.lineHeight = "1.8";
  ol.style.color = "var(--muted)";
  WEEK52.forEach((task, i) => {
    const li = mk("li", undefined, task);
    if (i + 1 === week) { li.style.color = "var(--fg)"; li.style.fontWeight = "600"; }
    ol.append(li);
  });
  det.append(ol);
  weekSec.append(det);
  root.append(weekSec);

  // ── Seasonal threat calendar ──
  const threatSec = section("Seasonal threat calendar — NSW");
  for (const [months, threat] of THREATS) {
    const row = mk("div", "saved-row");
    const m = mk("span", undefined, months);
    m.style.color = "var(--site-accent)";
    m.style.minWidth = "5rem";
    const t = mk("span", "l", threat);
    t.style.textAlign = "right";
    row.append(m, t);
    threatSec.append(row);
  }
  root.append(threatSec);

  // ── SOS morse signaller ──
  const sosSec = section("SOS signaller");
  sosSec.append(blurb("Plays · · · — — — · · · as sound, screen flash and vibration. Use only in a genuine emergency."));
  const morse = mk("p", "conv-out", "· · · — — — · · ·");
  const btnRow = mk("div", "btn-row no-print");
  const sosBtn = mk("button", "btn") as HTMLButtonElement;
  sosBtn.type = "button";
  sosBtn.textContent = "▶ Play SOS";
  sosBtn.addEventListener("click", playSOS);
  btnRow.append(sosBtn);
  sosSec.append(morse, btnRow);
  root.append(sosSec);
}
