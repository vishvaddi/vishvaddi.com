// Pure training-log logic: programme shape, progression rules and e1RM maths.
// No DOM here so `node --test` can drive it.

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  startKg: number;
  incrementKg: number;
  roundKg: number;
  bodyweight?: boolean;
  notes?: string;
}

export interface ProgrammeDay {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface SetEntry { kg: number; reps: number; rpe: number | null }
export interface SessionEntry { exerciseId: string; name: string; sets: SetEntry[] }
export interface Session {
  id: string;
  date: string;
  dayId: string;
  dayName: string;
  entries: SessionEntry[];
  notes?: string;
}

export interface TrainingSettings {
  rpeEasy: number;
  rpeHard: number;
  deloadPct: number;
}

export interface TrainingData {
  days: ProgrammeDay[];
  sessions: Session[];
  settings: TrainingSettings;
}

export const DEFAULT_SETTINGS: TrainingSettings = { rpeEasy: 7, rpeHard: 9.5, deloadPct: 5 };

export function defaultProgramme(): ProgrammeDay[] {
  const ex = (id: string, name: string, sets: number, repsMin: number, repsMax: number, startKg: number, incrementKg: number, roundKg = 2.5, bodyweight = false): Exercise =>
    ({ id, name, sets, repsMin, repsMax, startKg, incrementKg, roundKg, bodyweight });
  return [
    { id: "a", name: "Day A — Squat focus", exercises: [
      ex("squat", "Back squat", 3, 5, 5, 60, 5),
      ex("bench", "Bench press", 3, 5, 5, 40, 2.5),
      ex("row", "Barbell row", 3, 8, 10, 40, 2.5),
      ex("plank", "Plank (seconds)", 3, 30, 60, 0, 0, 1, true),
    ] },
    { id: "b", name: "Day B — Hinge focus", exercises: [
      ex("deadlift", "Deadlift", 3, 5, 5, 80, 5),
      ex("ohp", "Overhead press", 3, 5, 8, 30, 2.5),
      ex("pullup", "Pull-up / lat pulldown", 3, 6, 10, 0, 2.5, 2.5, true),
      ex("curl", "Dumbbell curl", 2, 10, 12, 10, 2, 2),
    ] },
    { id: "c", name: "Day C — Volume", exercises: [
      ex("frontsquat", "Front squat", 3, 8, 8, 40, 2.5),
      ex("incline", "Incline dumbbell press", 3, 8, 12, 16, 2, 2),
      ex("rdl", "Romanian deadlift", 3, 8, 10, 60, 5),
      ex("facepull", "Face pull", 3, 12, 15, 15, 2.5),
    ] },
  ];
}

export function initialTraining(): TrainingData {
  return { days: defaultProgramme(), sessions: [], settings: { ...DEFAULT_SETTINGS } };
}

export function isTrainingData(value: unknown): value is TrainingData {
  const v = value as TrainingData;
  return !!v && Array.isArray(v.days) && Array.isArray(v.sessions) && !!v.settings;
}

export function roundTo(kg: number, step: number): number {
  if (!step || step <= 0) return Math.round(kg * 100) / 100;
  return Math.round(kg / step) * step;
}

export function epley(kg: number, reps: number): number {
  if (reps <= 0 || kg <= 0) return 0;
  if (reps === 1) return kg;
  return kg * (1 + reps / 30);
}

export function bestE1rm(sets: SetEntry[]): number {
  return sets.reduce((best, s) => Math.max(best, epley(s.kg, s.reps)), 0);
}

export function volume(sets: SetEntry[]): number {
  return sets.reduce((sum, s) => sum + s.kg * s.reps, 0);
}

export function lastPerformance(sessions: Session[], exerciseId: string): SessionEntry | null {
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const session of sorted) {
    const entry = session.entries.find((e) => e.exerciseId === exerciseId && e.sets.length);
    if (entry) return entry;
  }
  return null;
}

export type Verdict = "start" | "progress" | "hold" | "deload";

export interface Suggestion { kg: number; verdict: Verdict; reason: string }

// Rule-based progression: every set at the top of the rep range with nothing
// harder than rpeEasy → add the increment (double it when it was clearly
// easy). A missed set at the bottom of the range, or anything at rpeHard or
// above, backs the load off by deloadPct. Otherwise repeat the load.
export function suggestLoad(ex: Exercise, last: SessionEntry | null, settings: TrainingSettings = DEFAULT_SETTINGS): Suggestion {
  if (!last || !last.sets.length) return { kg: ex.startKg, verdict: "start", reason: "First session — start weight." };
  const worked = last.sets.filter((s) => s.reps > 0);
  if (!worked.length) return { kg: ex.startKg, verdict: "start", reason: "No completed sets last time." };
  const lastKg = Math.max(...worked.map((s) => s.kg));
  const rpes = worked.map((s) => s.rpe).filter((r): r is number => typeof r === "number" && r > 0);
  const maxRpe = rpes.length ? Math.max(...rpes) : null;
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const missed = worked.some((s) => s.reps < ex.repsMin) || worked.length < ex.sets;
  const allTop = worked.length >= ex.sets && worked.every((s) => s.reps >= ex.repsMax);

  if (missed) {
    const kg = roundTo(lastKg * (1 - settings.deloadPct / 100), ex.roundKg);
    return { kg, verdict: "deload", reason: `Missed reps at ${lastKg} kg — back off ${settings.deloadPct}%.` };
  }
  if (maxRpe !== null && maxRpe >= settings.rpeHard) {
    return { kg: lastKg, verdict: "hold", reason: `Top set was RPE ${maxRpe} — repeat ${lastKg} kg.` };
  }
  if (allTop && (maxRpe === null || maxRpe <= settings.rpeEasy)) {
    const step = ex.incrementKg * (avgRpe !== null && avgRpe <= settings.rpeEasy - 1 ? 2 : 1);
    const kg = roundTo(lastKg + step, ex.roundKg);
    return { kg, verdict: "progress", reason: `All sets at ${ex.repsMax} reps${maxRpe !== null ? ` under RPE ${settings.rpeEasy}` : ""} — add ${step} kg.` };
  }
  if (allTop) {
    return { kg: lastKg, verdict: "hold", reason: `Hit the reps but RPE ${maxRpe} — one more session at ${lastKg} kg.` };
  }
  return { kg: lastKg, verdict: "hold", reason: `Reps still inside ${ex.repsMin}–${ex.repsMax} — build to ${ex.repsMax} at ${lastKg} kg.` };
}

export function nextDayId(days: ProgrammeDay[], sessions: Session[]): string {
  if (!days.length) return "";
  const last = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last) return days[0].id;
  const idx = days.findIndex((d) => d.id === last.dayId);
  return days[(idx + 1) % days.length]?.id ?? days[0].id;
}

export interface ExerciseTrend { exerciseId: string; name: string; points: { date: string; e1rm: number; volume: number; topKg: number }[] }

export function trends(data: TrainingData): ExerciseTrend[] {
  const byId = new Map<string, ExerciseTrend>();
  const order = data.days.flatMap((d) => d.exercises.map((e) => e.id));
  for (const session of [...data.sessions].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const entry of session.entries) {
      const worked = entry.sets.filter((s) => s.reps > 0);
      if (!worked.length) continue;
      const t = byId.get(entry.exerciseId) ?? { exerciseId: entry.exerciseId, name: entry.name, points: [] };
      t.points.push({ date: session.date, e1rm: bestE1rm(worked), volume: volume(worked), topKg: Math.max(...worked.map((s) => s.kg)) });
      byId.set(entry.exerciseId, t);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ai = order.indexOf(a.exerciseId), bi = order.indexOf(b.exerciseId);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

export function weekSummary(sessions: Session[], today: string): { sessions: number; sets: number; volume: number } {
  const start = new Date(today + "T00:00:00");
  start.setDate(start.getDate() - 6);
  const from = start.toISOString().slice(0, 10);
  const recent = sessions.filter((s) => s.date >= from && s.date <= today);
  const sets = recent.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.filter((x) => x.reps > 0).length, 0), 0);
  const vol = recent.reduce((n, s) => n + s.entries.reduce((m, e) => m + volume(e.sets), 0), 0);
  return { sessions: recent.length, sets, volume: vol };
}
