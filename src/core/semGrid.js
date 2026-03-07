// ═══════════════════════════════════════════════════════════════════
// SEMESTER GRID  (pure, no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { DEFAULT_START_YEAR, NUM_YEARS } from "./constants.js";

/**
 * Build the ordered list of semester objects for a given cohort window.
 * Always prepends the "Incoming Credit" slot.
 */
export function generateSemesters(startYear = DEFAULT_START_YEAR, numYears = NUM_YEARS) {
  const s = [
    { id: "incoming", label: "Incoming Credit", sub: "Transfer / AP / IB / Waiver", type: "special", maxSlots: 99 },
  ];
  for (let y = startYear; y < startYear + numYears; y++) {
    s.push({ id: `fall${y}`,     label: `Fall ${y}`,        sub: "Sep – Dec", type: "fall",   maxSlots: 5 });
    s.push({ id: `spr${y + 1}`,  label: `Spring ${y + 1}`,  sub: "Jan – Apr", type: "spring", maxSlots: 4 });
    s.push({ id: `sumA${y + 1}`, label: `Summer A ${y + 1}`,sub: "May – Jun", type: "summer", maxSlots: 2 });
    s.push({ id: `sumB${y + 1}`, label: `Summer B ${y + 1}`,sub: "Jul – Aug", type: "summer", maxSlots: 2 });
  }
  return s;
}

/** Derive SEM_INDEX (id → ordinal), SEM_NEXT (id → next id), SEM_PREV (id → prev id) from a semester list. */
export function deriveSemMaps(semesters) {
  const SEM_INDEX = Object.fromEntries(semesters.map((s, i) => [s.id, i]));
  const SEM_NEXT  = Object.fromEntries(semesters.slice(0, -1).map((s, i) => [s.id, semesters[i + 1].id]));
  const SEM_PREV  = Object.fromEntries(semesters.slice(1).map((s, i) => [s.id, semesters[i].id]));
  return { SEM_INDEX, SEM_NEXT, SEM_PREV };
}

/**
 * Build the trimmed semester list for a cohort (entry → graduation + 1 buffer year).
 * Always keeps the "incoming" slot at index 0.
 */
export function buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear) {
  // If entry is spring, we need to start from the previous year to include that spring semester.
  const startYear = planEntSem === "spring" ? planEntYear - 1 : planEntYear;
  const numY  = Math.max(2, planGradYear - startYear + 2);
  const all   = generateSemesters(startYear, numY);
  const entId  = planEntSem  === "fall" ? `fall${planEntYear}`  : `spr${planEntYear}`;
  const gradId = planGradSem === "fall" ? `fall${planGradYear}` : `spr${planGradYear}`;
  const tmpIdx = Object.fromEntries(all.map((s, i) => [s.id, i]));
  const ei = tmpIdx[entId]  ?? 1;
  const gi = tmpIdx[gradId] ?? (all.length - 1);
  return [all[0], ...all.slice(ei, Math.min(gi + 1, all.length))];
}
