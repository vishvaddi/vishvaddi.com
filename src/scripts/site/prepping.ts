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
const CONTACTS: [string, string][] = [
  ["000", "Police / Fire / Ambulance"],
  ["112", "Emergency from mobile (any network)"],
  ["132500", "SES — flood & storm"],
  ["131126", "Poisons Information"],
  ["1800641792", "Marine Rescue / Coast Guard"],
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

  buildVehicleRecovery(root);
}

// ── Australian hazard protocol cards ─────────────────────────────────────────
const HAZARDS = [
  {
    key: "snake", name: "Snakebite", icon: "🐍",
    warn: "PIB is for ALL Australian snakes. Delays absorption — antivenom cures it.",
    steps: [
      "Stay calm. Do NOT wash the bite — venom residue helps ID the snake.",
      "Apply pressure immobilisation bandage (PIB) immediately starting at the bite site.",
      "Bandage firmly from bite site toward the heart and over it — as firm as for a sprain.",
      "Bandage the entire limb. Splint it. Keep patient completely still.",
      "Do NOT cut, suck, tourniquet, or apply ice.",
      "Call 000. Do not drive the patient yourself — wait for ambulance.",
      "Note the time of the bite. PIB stays on until antivenom is administered at hospital.",
    ],
  },
  {
    key: "funnel", name: "Funnel-web spider", icon: "🕷️",
    warn: "Male Sydney funnel-web venom is lethal within 15 min. PIB + antivenom saves lives.",
    steps: [
      "URGENT — call 000 immediately. Funnel-web can kill in 15–30 min without treatment.",
      "Apply pressure immobilisation bandage (PIB) as for snakebite.",
      "Bandage firmly from bite site up the entire limb. Splint. Immobilise completely.",
      "Do NOT tourniquet, cut, or suck.",
      "Capture the spider safely if possible — for species confirmation.",
      "Get to hospital with antivenom as fast as possible.",
    ],
  },
  {
    key: "redback", name: "Redback spider", icon: "🕷️",
    warn: "No PIB for redback — opposite to snakebite/funnel-web. Ice + hospital.",
    steps: [
      "Redback bites cause pain, sweating, nausea — rarely immediately life-threatening.",
      "Do NOT apply PIB — increases local pain and damage for redback venom.",
      "Apply an ice pack to the bite site for pain relief.",
      "Call Poisons Information: 131 126.",
      "Seek medical attention — antivenom is available and effective.",
      "Escalate to 000 if systemic effects develop (sweating, muscle pain, headache, vomiting).",
    ],
  },
  {
    key: "marine", name: "Bluebottle / Box jellyfish", icon: "🪼",
    warn: "Hot water for bluebottle. Vinegar for box jellyfish. Treatment differs — know the species.",
    steps: [
      "BLUEBOTTLE (Physalia): remove tentacles with fingers or towel. Rinse with seawater (not fresh). Immerse in hot water (~45°C, as hot as tolerable) for 20 min.",
      "BOX JELLYFISH (Chironex): call 000 immediately. Flood sting with vinegar. Remove tentacles after vinegar. Start CPR if patient collapses.",
      "Do NOT use urine, fresh water, sand, or alcohol on either species.",
      "For either: seek medical attention if chest pain, difficulty breathing, or box jellyfish sting.",
    ],
  },
];

function buildHazardCards(root: HTMLElement): void {
  const sec = section("Australian hazard protocols");
  sec.append(blurb("Tap a card for the full protocol. Offline — no network needed."));
  const grid = mk("div", "hazard-grid");
  for (const h of HAZARDS) {
    const card = document.createElement("details"); card.className = "hazard-card";
    const sum = document.createElement("summary"); sum.className = "hazard-summary";
    sum.append(mk("span", "hazard-icon", h.icon), mk("span", "hazard-name", h.name));
    card.append(sum);
    if (h.warn) card.append(mk("p", "hazard-warn", "⚠ " + h.warn));
    const ol = document.createElement("ol"); ol.className = "hazard-steps";
    for (const step of h.steps) { const li = document.createElement("li"); li.textContent = step; ol.append(li); }
    card.append(ol); grid.append(card);
  }
  sec.append(grid); root.append(sec);
}

// ── Southern Cross navigation ─────────────────────────────────────────────────
function buildSouthCross(root: HTMLElement): void {
  const sec = section("Find South — Southern Cross");
  sec.append(blurb("No compass? Use the Southern Cross (Crux) to find south at night."));

  // SVG star diagram
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 280 190");
  svg.setAttribute("width", "100%");
  svg.setAttribute("style", "max-width:280px;display:block;margin:1rem 0;background:#060618;border-radius:8px;padding:8px;");
  const addStar = (cx: number, cy: number, r: number, label: string) => {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy)); c.setAttribute("r", String(r)); c.setAttribute("fill", "white");
    svg.append(c);
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", String(cx + r + 3)); t.setAttribute("y", String(cy + 4));
    t.setAttribute("fill", "#aaa"); t.setAttribute("font-size", "8"); t.textContent = label;
    svg.append(t);
  };
  // Crux: long axis top=γ (110,30) bottom=α (110,100). Short axis β (140,65) δ (80,65)
  addStar(110, 30,  4.5, "γ (top)");
  addStar(110, 100, 5,   "α Acrux");
  addStar(140, 65,  3.5, "β");
  addStar(80,  65,  3,   "δ");
  addStar(115, 55,  2,   "ε");
  // Pointer stars (Alpha + Beta Centauri, right side)
  addStar(210, 50,  4, "α Cen");
  addStar(210, 85,  3.5, "β Cen");
  // Long axis extended to SCP — 4.5× the cross length (70px) = 315px → fits to ~415, clip at 175
  const axisLine = document.createElementNS(svgNS, "line");
  axisLine.setAttribute("x1", "110"); axisLine.setAttribute("y1", "30");
  axisLine.setAttribute("x2", "110"); axisLine.setAttribute("y2", "175");
  axisLine.setAttribute("stroke", "#4488ff"); axisLine.setAttribute("stroke-width", "1"); axisLine.setAttribute("stroke-dasharray", "4,3");
  svg.append(axisLine);
  const scp = document.createElementNS(svgNS, "circle");
  scp.setAttribute("cx", "110"); scp.setAttribute("cy", "170"); scp.setAttribute("r", "4"); scp.setAttribute("fill", "#ff4444");
  const scpLabel = document.createElementNS(svgNS, "text");
  scpLabel.setAttribute("x", "118"); scpLabel.setAttribute("y", "174");
  scpLabel.setAttribute("fill", "#ff6644"); scpLabel.setAttribute("font-size", "9"); scpLabel.textContent = "→ South";
  svg.append(scp, scpLabel);
  sec.append(svg);

  const steps = [
    "Find the Southern Cross — 4 stars in a compact cross shape, about 6° long.",
    "Draw an imaginary line along the long axis from the top star (γ) through the bottom star (Acrux).",
    "Extend this line 4.5 times the length of the cross beyond Acrux.",
    "That point is the South Celestial Pole (SCP). Drop a line straight down to the horizon.",
    "That point on the horizon is true South.",
    "Pointer stars shortcut: find Alpha and Beta Centauri (bright pair to the left of the Cross). A perpendicular from their midpoint to the long axis of the Cross also gives the SCP.",
  ];
  const ol = document.createElement("ol"); ol.className = "hazard-steps";
  for (const s of steps) { const li = document.createElement("li"); li.textContent = s; ol.append(li); }
  sec.append(ol);

  // Magnetic declination table
  sec.append(mk("p", "calc-blurb", "Magnetic declination — compass correction by state (approx. 2025). Add easterly declination to your magnetic bearing to get true bearing."));
  const table = document.createElement("table"); table.className = "ref-table";
  const thead = document.createElement("thead"); const hrow = document.createElement("tr");
  ["State / Territory", "Declination", "Correction"].forEach((h) => {
    const th = document.createElement("th"); th.textContent = h; hrow.append(th);
  });
  thead.append(hrow); table.append(thead);
  const tbody = document.createElement("tbody");
  const decls: [string, string, string][] = [
    ["NSW / ACT (Sydney)",  "≈ +12.5° E", "Add 12.5° to magnetic bearing"],
    ["VIC (Melbourne)",     "≈ +11.8° E", "Add 11.8°"],
    ["QLD (Brisbane)",     "≈ +11.0° E", "Add 11.0°"],
    ["SA (Adelaide)",      "≈ +5.5° E",  "Add 5.5°"],
    ["WA (Perth)",         "≈ −1.5° W",  "Subtract 1.5°"],
    ["TAS (Hobart)",       "≈ +13.5° E", "Add 13.5°"],
    ["NT (Darwin)",        "≈ +3.0° E",  "Add 3.0°"],
  ];
  for (const [loc, dec, corr] of decls) {
    const tr = document.createElement("tr");
    [loc, dec, corr].forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
    tbody.append(tr);
  }
  table.append(tbody); sec.append(table); root.append(sec);
}

// ── 52-week maintenance scheduler ─────────────────────────────────────────────
const SCHED_ITEMS = [
  { label: "Water rotation",              weeks: 26 },
  { label: "Food rotation",               weeks: 4  },
  { label: "Kit check",                   weeks: 12 },
  { label: "Document review",             weeks: 52 },
  { label: "First aid kit restock",       weeks: 26 },
  { label: "Battery & electronics check", weeks: 13 },
];

function buildScheduler(root: HTMLElement): void {
  const sec = section("Maintenance scheduler");
  sec.append(blurb("Enter a start date — your full prep calendar generates automatically. Stored in this browser."));
  const wrap = mk("div", "field");
  const lab = mk("label", undefined, "Start date"); wrap.append(lab);
  const dateIn = document.createElement("input"); dateIn.type = "date";
  const savedStart = localStorage.getItem("vv_prep_sched_start") || today();
  dateIn.value = savedStart; wrap.append(dateIn); sec.append(wrap);
  const out = mk("div", "sched-out"); sec.append(out);

  function render(): void {
    out.textContent = "";
    const start = new Date(dateIn.value + "T00:00:00");
    if (isNaN(start.getTime())) return;
    const now = Date.now();
    const events: { date: Date; label: string; overdue: boolean }[] = [];
    for (const item of SCHED_ITEMS) {
      let d = new Date(start);
      for (let w = 0; w <= 52; w += item.weeks) {
        const ev = new Date(d); ev.setDate(ev.getDate() + w * 7);
        if (ev.getTime() >= now - 7 * 86400000) events.push({ date: ev, label: item.label, overdue: ev.getTime() < now });
      }
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const ev of events.slice(0, 24)) {
      const row = mk("div", "saved-row");
      const dateStr = ev.date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
      const days = Math.ceil((ev.date.getTime() - now) / 86400000);
      const tag = ev.overdue ? " ⚠ Overdue" : days <= 14 ? ` ⚠ in ${days}d` : "";
      row.append(mk("span", ev.overdue ? "hazard-warn-inline" : undefined, dateStr + tag), mk("span", "l", ev.label));
      out.append(row);
    }
    if (!events.length) out.textContent = "No events — check the start date.";
  }

  dateIn.addEventListener("change", () => { localStorage.setItem("vv_prep_sched_start", dateIn.value); render(); });
  render(); root.append(sec);
}

// ── Vehicle recovery checklist ────────────────────────────────────────────────
const RECOVERY_STEPS = [
  "Assess the situation — is it safe to attempt recovery? Is the vehicle stable?",
  "Deflate tyres to 20 PSI on soft ground (sand / mud) before mechanical recovery.",
  "Try self-recovery first: dig out wheels, place traction boards (MaxTrax) under drive wheels.",
  "If winching: identify anchor point — use a tree trunk protector if attaching to a tree.",
  "Attach snatch strap or winch cable. Never stand in line with a tensioned strap or cable.",
  "Spotter directs — all bystanders move to the side, minimum 1.5× cable length away.",
  "Recover slowly and steadily. Stop if the vehicle shows signs of going deeper.",
  "Once free: reinflate tyres, check underneath for damage before driving on.",
];

function buildVehicleRecovery(root: HTMLElement): void {
  const recState = load<Record<number, boolean>>("vv_prep_recovery", {});
  const sec = section("Vehicle recovery checklist");
  sec.append(blurb("Off-road recovery sequence. Check off as you go. Resets between incidents. Saved in this browser."));
  const cbs: HTMLInputElement[] = [];
  RECOVERY_STEPS.forEach((step, i) => {
    const row = mk("label", "saved-row"); row.style.cursor = "pointer";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.style.width = "auto"; cb.checked = !!recState[i];
    cb.addEventListener("change", () => { recState[i] = cb.checked; save("vv_prep_recovery", recState); });
    row.append(mk("span", undefined, step), cb); sec.append(row); cbs.push(cb);
  });
  const resetBtn = mk("button", "btn btn-ghost btn-sm") as HTMLButtonElement;
  resetBtn.type = "button"; resetBtn.textContent = "Reset checklist";
  resetBtn.addEventListener("click", () => {
    cbs.forEach((cb, i) => { cb.checked = false; recState[i] = false; }); save("vv_prep_recovery", recState);
  });
  const br = mk("div", "btn-row no-print"); br.append(resetBtn); sec.append(br); root.append(sec);
}

// ── On-this-page navigation ──────────────────────────────────────────────────
// Builds a scrollspy table of contents from every h2 on the page (prose
// sections + tool sections), in document order. Fixed left rail on desktop, a
// collapsible dropdown on mobile. CSP-clean: DOM built via createElement.
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

// The ~28 note sections, grouped into a handful of collapsible themes. Sections
// are matched by heading slug, so order/insertions stay robust.
const NOTE_GROUPS: { title: string; slugs: string[] }[] = [
  { title: "Emergency & first aid", slugs: ["emergency-numbers-australia", "first-aid-drsabcd", "beyond-first-aid-austere-medicine", "snake-bite-australian-protocol", "other-australian-bites-and-stings"] },
  { title: "Survival priorities", slugs: ["the-rule-of-threes", "survival-the-mindset-mnemonic", "the-five-priorities", "shelter", "fire", "water", "signalling", "food", "bradley-s-14-survival-needs"] },
  { title: "Field skills", slugs: ["six-knots-that-cover-most-situations", "sharp-tools-briefly", "natural-navigation-in-the-southern-hemisphere"] },
  { title: "Gear & kits", slugs: ["the-5cs", "the-10cs", "the-urban-10cs"] },
  { title: "Australian context", slugs: ["seasonal-threat-calendar-nsw", "australian-specific"] },
  { title: "Home resilience", slugs: ["the-everyday-baseline", "self-sufficiency-at-home-four-pillars", "gardening-principles", "diy-and-the-case-for-traditional-skills", "future-proofing-the-2026-angle"] },
  { title: "Maintenance", slugs: ["the-52-week-prep-routine"] },
];

export function buildPreppingNav(): void {
  const main = document.querySelector("main");
  if (!main) return;
  // Give every heading a stable id + scroll offset.
  const used = new Set<string>();
  for (const h of Array.from(main.querySelectorAll<HTMLElement>("h2"))) {
    const label = (h.textContent || "").trim();
    if (!label) continue;
    let id = h.id || slug(label);
    const base = id;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    h.id = id;
    h.style.scrollMarginTop = "5rem";
  }

  // ── Group the knowledge sections into collapsible accordions ──
  // Only sections inside #prep-knowledge are grouped (the Tools page has none).
  const noteGroupLinks: { id: string; label: string }[] = [];
  const know = document.getElementById("prep-knowledge");
  if (know) {
    const sections = new Map<string, HTMLElement[]>();
    const order: string[] = [];
    let curKey: string | null = null;
    for (const el of Array.from(know.children) as HTMLElement[]) {
      if (el.tagName === "H2") { curKey = el.id; sections.set(curKey, [el]); order.push(curKey); }
      else if (curKey) sections.get(curKey)!.push(el);
    }

    const assigned = new Set<string>();
    let firstOpen = true;
    const addGroup = (title: string, keys: string[]) => {
      const ks = keys.filter((k) => sections.has(k));
      if (!ks.length) return;
      const det = document.createElement("details");
      det.className = "np-group";
      det.id = `g-${slug(title)}`;
      if (firstOpen) { det.open = true; firstOpen = false; }
      det.append(mk("summary", "np-group-title", title));
      const body = mk("div", "np-group-body");
      for (const k of ks) {
        for (const node of sections.get(k)!) body.append(node);
        assigned.add(k);
      }
      det.append(body);
      know.append(det);
      noteGroupLinks.push({ id: det.id, label: title });
    };

    for (const def of NOTE_GROUPS) addGroup(def.title, def.slugs);
    addGroup("More", order.filter((k) => !assigned.has(k))); // any unexpected headings
  }

  // Include static weather/sky sections and generated tools in document order.
  const toolLinks: { id: string; label: string }[] = [];
  document.querySelectorAll<HTMLElement>("[data-prep-tool] h2, #prep-app h2").forEach((h) => {
    if (h.id) toolLinks.push({ id: h.id, label: (h.textContent || "").trim() });
  });
  if (!noteGroupLinks.length && !toolLinks.length) return;

  // ── TOC (desktop rail + mobile dropdown) ──
  const tocGroups: { title: string; links: { id: string; label: string }[]; opensAccordion?: boolean }[] = [
    { title: "Knowledge", links: noteGroupLinks, opensAccordion: true },
    { title: "Tools", links: toolLinks },
  ];
  const buildInto = (container: HTMLElement, labelClass: string): void => {
    for (const grp of tocGroups) {
      if (!grp.links.length) continue;
      container.append(mk("div", labelClass, grp.title));
      const ul = document.createElement("ul");
      for (const it of grp.links) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#${it.id}`;
        a.textContent = it.label;
        a.dataset.toc = it.id;
        if (grp.opensAccordion) a.dataset.opens = it.id;
        li.append(a);
        ul.append(li);
      }
      container.append(ul);
    }
  };

  const rail = document.createElement("nav");
  rail.className = "prep-toc no-print";
  rail.setAttribute("aria-label", "On this page");
  buildInto(rail, "prep-toc-title");
  document.body.append(rail);

  const det = document.createElement("details");
  det.className = "prep-toc-m no-print";
  det.append(mk("summary", undefined, "On this page"));
  buildInto(det, "prep-toc-m-group");
  main.prepend(det);
  det.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => det.removeAttribute("open")));

  // Open the targeted accordion when its TOC link (or a #g- hash) is used.
  const openTarget = (id: string | null) => {
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el.tagName === "DETAILS") (el as HTMLDetailsElement).open = true;
  };
  document.querySelectorAll<HTMLAnchorElement>("a[data-opens]").forEach((a) =>
    a.addEventListener("click", () => openTarget(a.dataset.opens || null))
  );
  if (location.hash.startsWith("#g-")) openTarget(location.hash.slice(1));
  window.addEventListener("hashchange", () => {
    if (location.hash.startsWith("#g-")) openTarget(location.hash.slice(1));
  });

  // ── Scrollspy on group containers + tool headings ──
  const linksById = new Map<string, HTMLElement[]>();
  document.querySelectorAll<HTMLElement>("[data-toc]").forEach((a) => {
    const id = a.dataset.toc!;
    const arr = linksById.get(id) ?? [];
    arr.push(a);
    linksById.set(id, arr);
  });
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          document.querySelectorAll("[data-toc].active").forEach((x) => x.classList.remove("active"));
          (linksById.get((e.target as HTMLElement).id) ?? []).forEach((x) => x.classList.add("active"));
        }
      },
      { rootMargin: "-10% 0px -75% 0px" }
    );
    document.querySelectorAll<HTMLElement>(".np-group").forEach((g) => obs.observe(g));
    document.querySelectorAll<HTMLElement>("[data-prep-tool] h2, #prep-app h2").forEach((h) => obs.observe(h));
  }
}
