// Indicative AU construction quick-reference. NOT a compliance document — every
// figure must be checked against the current NCC, the relevant AS and any state
// variation. Common, widely-published values only.
type Ref = { cat: string; name: string; val: string; note?: string };

const REFS: Ref[] = [
  // Stairs
  { cat: "Stairs", name: "Riser height (R)", val: "115–190 mm", note: "Private stairs, NCC. Keep consistent within a flight." },
  { cat: "Stairs", name: "Going / tread (G)", val: "240–355 mm", note: "Min 250 mm is comfortable for most." },
  { cat: "Stairs", name: "Slope relationship", val: "2R + G = 550–700 mm", note: "Comfort/safety check for the riser–going pair." },
  { cat: "Stairs", name: "Max risers per flight", val: "18", note: "Then a landing." },
  { cat: "Stairs", name: "Min tread/landing slip", val: "P3 / R10", note: "Indicative external slip rating; check exposure." },
  // Barriers & balustrades
  { cat: "Barriers & balustrades", name: "Barrier required when drop >", val: "1 m", note: "To a lower level (NCC)." },
  { cat: "Barriers & balustrades", name: "Min barrier height", val: "1000 mm", note: "Above floor/decking." },
  { cat: "Barriers & balustrades", name: "Min height above stair nosing", val: "865 mm", note: "Measured vertically above the nosing line." },
  { cat: "Barriers & balustrades", name: "Max opening / gap", val: "125 mm", note: "Sphere must not pass; no climbable elements 150–760 mm where drop > 4 m." },
  // Access & ramps
  { cat: "Access & ramps", name: "Accessible ramp grade", val: "1:14 max", note: "With landings; AS1428." },
  { cat: "Access & ramps", name: "Step ramp", val: "1:8 max", note: "Rise ≤ 190 mm." },
  { cat: "Access & ramps", name: "Driveway grade (residential)", val: "1:4 max", note: "Transitions needed; check council." },
  // Ceiling heights
  { cat: "Ceiling heights", name: "Habitable rooms", val: "2.4 m", note: "NCC minimum." },
  { cat: "Ceiling heights", name: "Kitchen / laundry / bathroom", val: "2.1 m", note: "Non-habitable minimum." },
  { cat: "Ceiling heights", name: "Corridors / hallways", val: "2.1 m", note: "Minimum." },
  { cat: "Ceiling heights", name: "Garage (residential)", val: "2.1 m", note: "Min clearance." },
  // Doors & openings
  { cat: "Doors & openings", name: "Standard internal door", val: "2040 × 820 mm", note: "Also 720/770/870 widths." },
  { cat: "Doors & openings", name: "Min accessible clear width", val: "850 mm", note: "Clear opening, AS1428." },
  { cat: "Doors & openings", name: "Standard stud height", val: "2400 / 2700 mm", note: "Wall framing." },
  // Waterproofing
  { cat: "Waterproofing", name: "Shower floor fall to waste", val: "1:60–1:80", note: "AS3740. ~12–16 mm/m." },
  { cat: "Waterproofing", name: "Bathroom floor fall (outside shower)", val: "1:80–1:100", note: "To floor waste where required." },
  { cat: "Waterproofing", name: "Wall membrane height (shower)", val: "1800 mm", note: "Min over taps/rose; check AS3740." },
  { cat: "Waterproofing", name: "Hob / step-down", val: "≥ 25 mm", note: "Or flush with compliant fall + screen." },
  // Tiling
  { cat: "Tiling", name: "Movement joints (internal)", val: "every 4.5–6 m", note: "And at all changes of plane/perimeter. AS3958." },
  { cat: "Tiling", name: "Movement joints (external)", val: "every 3–4.5 m", note: "Greater thermal movement." },
  { cat: "Tiling", name: "Adhesive coverage (floor)", val: "≈ 4–6 kg/m²", note: "Varies with notch + tile size." },
  // Bricks & blocks
  { cat: "Bricks & blocks", name: "Standard brick", val: "230 × 110 × 76 mm", note: "Plus 10 mm joint." },
  { cat: "Bricks & blocks", name: "Brick course height", val: "86 mm", note: "76 brick + 10 mm bed joint." },
  { cat: "Bricks & blocks", name: "Bricks per m²", val: "≈ 50", note: "Single skin, standard format." },
  { cat: "Bricks & blocks", name: "200-series block per m²", val: "≈ 12.5", note: "390 × 190 face." },
  { cat: "Bricks & blocks", name: "Articulation joints", val: "every ≤ 6 m", note: "Masonry; per engineer/AS." },
  // Plasterboard & linings
  { cat: "Linings", name: "Wall board thickness", val: "10 mm", note: "13 mm for fire/impact." },
  { cat: "Linings", name: "Ceiling board thickness", val: "13 mm", note: "10 mm sags on wide spacing." },
  { cat: "Linings", name: "Sheet sizes", val: "1200 × 2400–6000 mm", note: "Common: 2400/2700/3000/3600." },
  { cat: "Linings", name: "Ceiling batten/joist spacing", val: "≤ 600 mm", note: "For 13 mm board; check manufacturer." },
  // Decking & framing
  { cat: "Decking & framing", name: "Decking board gap", val: "3–5 mm", note: "Allow for movement; hardwood swells." },
  { cat: "Decking & framing", name: "Stud spacing", val: "450 / 600 mm", note: "Load-dependent; AS1684." },
  { cat: "Decking & framing", name: "Noggin/blocking rows", val: "≤ 1350 mm", note: "Between studs." },
  { cat: "Decking & framing", name: "Concrete cover (exposure)", val: "20–65 mm", note: "Varies by class; AS3600." },
  // Fixings
  { cat: "Fixings", name: "Screw edge distance (timber)", val: "≥ 5 × shank Ø", note: "Avoid splitting." },
  { cat: "Fixings", name: "Plasterboard screw spacing", val: "200–300 mm", note: "Walls 300, ceilings 200." },
  { cat: "Fixings", name: "Decking screw length", val: "≈ 2.5 × board thickness", note: "Into joist." },
  // Site & safety
  { cat: "Site & safety", name: "Working-at-heights threshold", val: "2 m", note: "Fall-protection duty (varies by state/WHS)." },
  { cat: "Site & safety", name: "Smoke alarms", val: "every storey", note: "Interconnected, AS3786; check state." },
  { cat: "Site & safety", name: "Trench shoring depth", val: "> 1.5 m", note: "Battering/shoring/benching required." },
  { cat: "Site & safety", name: "Scaffold inspection", val: "every 30 days", note: "And after alteration/weather." },
];

export function initQuickRef(): void {
  const list = document.getElementById("qr-list");
  const search = document.getElementById("qr-search") as HTMLInputElement | null;
  const empty = document.querySelector<HTMLElement>(".qr-empty");
  if (!list || !search) return;

  const render = (q: string): void => {
    const term = q.trim().toLowerCase();
    list.textContent = "";
    const groups = new Map<string, Ref[]>();
    let shown = 0;
    for (const r of REFS) {
      const hay = `${r.cat} ${r.name} ${r.val} ${r.note || ""}`.toLowerCase();
      if (term && !hay.includes(term)) continue;
      if (!groups.has(r.cat)) groups.set(r.cat, []);
      groups.get(r.cat)!.push(r);
      shown++;
    }
    for (const [cat, items] of groups) {
      const g = document.createElement("section");
      g.className = "qr-group";
      const h = document.createElement("h2");
      h.textContent = cat;
      g.append(h);
      for (const r of items) {
        const row = document.createElement("div");
        row.className = "qr-item";
        const name = document.createElement("span"); name.className = "qr-name"; name.textContent = r.name;
        const val = document.createElement("span"); val.className = "qr-val"; val.textContent = r.val;
        row.append(name, val);
        if (r.note) {
          const note = document.createElement("span"); note.className = "qr-note"; note.textContent = r.note;
          row.append(note);
        }
        g.append(row);
      }
      list.append(g);
    }
    if (empty) empty.hidden = shown > 0;
  };

  search.addEventListener("input", () => render(search.value));
  render("");
}
