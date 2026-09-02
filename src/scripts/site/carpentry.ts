// Pure roof, stair and cut-angle maths for /site/geometry — Construction
// Master Pro parity, metric-first. No DOM here so it can be unit-tested in
// plain node (`node --experimental-strip-types`).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface RafterInput {
  span: number;        // mm, main roof span (double the common run)
  pitch: number;       // degrees, main roof
  overhang?: number;   // mm, horizontal eave overhang (0 = none)
  endPitch?: number;   // degrees, adjacent (end) roof — omit or equal for a regular hip
  spacing?: number;    // mm, jack rafter centres (0 = no jack table)
}

export interface RafterResult {
  run: number; rise: number;
  commonLength: number;          // plate to ridge centre line, incl. overhang
  plumbCut: number; levelCut: number;
  hipRun: number; hipLength: number; hipPitch: number;
  hipPlumb: number; hipLevel: number;
  hipCheekMain: number; hipCheekEnd: number;   // hip's own cheek, measured from the hip's edge
  jackCheekMain: number; jackCheekEnd: number; // jack side cut, measured from the jack's edge
  jackDiffMain: number; jackDiffEnd: number;   // common difference per spacing
  jacksMain: number[]; jacksEnd: number[];     // lengths, longest first, no overhang
  endRun: number; endPitch: number; irregular: boolean;
}

// Cheek (side) cut on a sloped member meeting a line at plan angle `plan`:
// the member's true length is its plan length / cos(pitch), so on the face
// the angle closes up:  tan(cheek) = cos(pitch) * tan(plan).
const cheek = (pitchDeg: number, planDeg: number) =>
  Math.atan(Math.cos(pitchDeg * D2R) * Math.tan(planDeg * D2R)) * R2D;

export function solveRafters(i: RafterInput): RafterResult {
  const run = i.span / 2;
  const t1 = i.pitch * D2R;
  const rise = run * Math.tan(t1);
  const endPitch = i.endPitch && i.endPitch > 0 ? i.endPitch : i.pitch;
  const t2 = endPitch * D2R;
  const endRun = rise / Math.tan(t2);
  const irregular = Math.abs(endPitch - i.pitch) > 1e-9;
  const o = i.overhang ?? 0;

  const commonLength = (run + o) / Math.cos(t1);
  const hipRun = Math.hypot(run, endRun);
  const hipPitch = Math.atan(rise / hipRun) * R2D;
  // Overhang extends the hip in plan by (o, o*endRun/run) so both eaves keep
  // the same horizontal overhang; the drop below the plate follows the main pitch.
  const oEnd = o * (endRun / run);
  const hipLength = Math.hypot(run + o, endRun + oEnd, rise + o * Math.tan(t1));

  const planMain = Math.atan(endRun / run) * R2D; // hip vs a main-side jack, in plan
  const planEnd = 90 - planMain;

  const spacing = i.spacing ?? 0;
  // Each jack along the eave loses (fullRun / otherRun) of run per spacing.
  const jacks = (fullRun: number, otherRun: number, pitchRad: number) => {
    const out: number[] = [];
    if (spacing <= 0) return out;
    const step = spacing * (fullRun / otherRun);
    for (let r = fullRun - step; r > 1 && out.length < 40; r -= step) out.push(r / Math.cos(pitchRad));
    return out;
  };

  return {
    run, rise, commonLength,
    plumbCut: i.pitch, levelCut: 90 - i.pitch,
    hipRun, hipLength, hipPitch, hipPlumb: hipPitch, hipLevel: 90 - hipPitch,
    hipCheekMain: cheek(hipPitch, planEnd),
    hipCheekEnd: cheek(hipPitch, planMain),
    jackCheekMain: cheek(i.pitch, planMain),
    jackCheekEnd: cheek(endPitch, planEnd),
    jackDiffMain: spacing > 0 ? (spacing * (run / endRun)) / Math.cos(t1) : 0,
    jackDiffEnd: spacing > 0 ? (spacing * (endRun / run)) / Math.cos(t2) : 0,
    jacksMain: jacks(run, endRun, t1),
    jacksEnd: jacks(endRun, run, t2),
    endRun, endPitch, irregular,
  };
}

export interface StairInput {
  rise: number;        // mm, floor to floor
  going: number;       // mm
  maxRiser: number;    // mm — or the exact riser you want (riser-limited layout)
  headroom?: number;   // mm, vertical clearance to the soffit above (NCC 2000)
  floorDepth?: number; // mm, floor structure above (joists + flooring + lining)
}

export interface StairResult {
  risers: number; riserHeight: number; treads: number; run: number;
  stringer: number; incline: number; twoRG: number; opening: number;
}

export function solveStairs(i: StairInput): StairResult {
  const risers = Math.max(1, Math.ceil(i.rise / i.maxRiser - 1e-9));
  const riserHeight = i.rise / risers;
  const treads = risers - 1;
  const run = treads * i.going;
  const headroom = i.headroom ?? 2000;
  const floorDepth = i.floorDepth ?? 0;
  return {
    risers, riserHeight, treads, run,
    stringer: Math.hypot(run, i.rise),
    incline: Math.atan(riserHeight / i.going) * R2D,
    twoRG: 2 * riserHeight + i.going,
    // Horizontal well length back from the top riser face so the nosing line
    // clears the soffit: (headroom + floor depth) at the stair's slope.
    opening: ((headroom + floorDepth) * i.going) / riserHeight,
  };
}

// Crown / splayed compound mitre. `spring` = angle between the moulding (or
// hopper side) and the wall/vertical; `corner` = wall corner angle (90 square).
export function compoundMitre(spring: number, corner: number): { mitre: number; bevel: number } {
  const s = spring * D2R, half = (corner / 2) * D2R;
  return {
    mitre: Math.atan(Math.sin(s) / Math.tan(half)) * R2D,
    bevel: Math.asin(Math.cos(s) * Math.cos(half)) * R2D,
  };
}

export function dmsToDeg(d: number, m: number, s: number): number {
  const sign = d < 0 || Object.is(d, -0) ? -1 : 1;
  return sign * (Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600);
}

export function degToDms(deg: number): { d: number; m: number; s: number } {
  const sign = deg < 0 ? -1 : 1;
  let total = Math.round(Math.abs(deg) * 3600 * 100) / 100; // arc-seconds to 0.01
  const d = Math.floor(total / 3600); total -= d * 3600;
  const m = Math.floor(total / 60); total -= m * 60;
  return { d: sign * d, m, s: Math.round(total * 100) / 100 };
}

// Rake (gable) wall studs at centres along a sloping top plate.
export function rakeWallStuds(length: number, pitch: number, startHeight: number, spacing: number): number[] {
  const out: number[] = [];
  if (length <= 0 || spacing <= 0) return out;
  const t = Math.tan(pitch * D2R);
  for (let x = 0; x <= length + 1e-9 && out.length < 60; x += spacing) out.push(startHeight + x * t);
  if ((out.length - 1) * spacing < length - 1e-6 && out.length < 60) out.push(startHeight + length * t);
  return out;
}

// Studs under a segmental arch (chord `chord`, rise `rise` at mid-span) above
// a straight wall of `startHeight`, spaced from the left springing.
export function archedRakeStuds(chord: number, rise: number, startHeight: number, spacing: number): { radius: number; studs: number[] } {
  const radius = (chord * chord) / (8 * rise) + rise / 2;
  const studs: number[] = [];
  if (chord <= 0 || rise <= 0 || spacing <= 0) return { radius, studs };
  const h = (x: number) => Math.sqrt(Math.max(0, radius * radius - (x - chord / 2) ** 2)) - (radius - rise);
  for (let x = 0; x <= chord + 1e-9 && studs.length < 60; x += spacing) studs.push(startHeight + h(x));
  if ((studs.length - 1) * spacing < chord - 1e-6 && studs.length < 60) studs.push(startHeight + h(chord));
  return { radius, studs };
}

export function regularPolygon(n: number, side: number) {
  const interior = (180 * (n - 2)) / n;
  return {
    interior,
    central: 360 / n,
    cut: 180 / n,                       // mitre on each piece end (half the corner)
    perimeter: n * side,
    area: (n * side * side) / (4 * Math.tan(Math.PI / n)),
    acrossCorners: side / Math.sin(Math.PI / n),
    acrossFlats: side / Math.tan(Math.PI / n),
  };
}

// Arc from radius and included angle (degrees).
export function arcFromRadius(radius: number, angle: number) {
  const th = angle * D2R;
  return {
    arc: radius * th,
    chord: 2 * radius * Math.sin(th / 2),
    rise: radius * (1 - Math.cos(th / 2)),
    sector: (radius * radius * th) / 2,
    segment: (radius * radius * (th - Math.sin(th))) / 2,
  };
}
