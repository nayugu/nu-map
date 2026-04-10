// ═══════════════════════════════════════════════════════════════════
// SEMESTER GRID  (pure, no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { NUM_YEARS } from "./constants.js";

const MONTH_NAMES = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];
const MONTH_SHORT = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthNameToNum(name) {
  return MONTH_NAMES.indexOf(name.toLowerCase()) + 1;
}

function buildSub(months) {
  if (!months || months.length === 0) return "";
  const first = MONTH_SHORT[parseInt(months[0], 10)];
  const last  = MONTH_SHORT[parseInt(months[months.length - 1], 10)];
  return first === last ? first : `${first} \u2013 ${last}`;
}

/**
 * Build the ordered list of semester objects for a given cohort window.
 * Always prepends the "Incoming Credit" slot.
 *
 * When `calendar` is provided, semester rows are generated from
 * `calendar.getSemesterTypes()` — so adding or removing term types in the
 * adapter immediately changes which rows appear.
 *
 * Each generated semester has a `semTypeId` field (the SemesterType.id)
 * in addition to `type` (the theme, e.g. "fall"/"spring"/"summer").
 * Use `semTypeId` for offering comparisons; use `type` for row rendering.
 *
 * @param {number}  startYear  - First academic year to generate (fall of that year).
 * @param {number}  [numYears] - Number of academic years to generate.
 * @param {import('../ports/ICalendar.js').ICalendar} [calendar]
 */
export function generateSemesters(startYear, numYears = NUM_YEARS, calendar) {
  const s = [
    { id: "incoming", label: "Incoming Credit", sub: "Transfer / AP / IB / Waiver", type: "special", semTypeId: "incoming", maxSlots: 99 },
  ];

  if (!calendar) {
    // Legacy fallback — NU-compatible hardcoded layout (no calendar adapter provided)
    for (let y = startYear; y < startYear + numYears; y++) {
      s.push({ id: `fall${y}`,     label: `Fall ${y}`,         sub: "Sep \u2013 Dec", type: "fall",   semTypeId: "fall",   weight: 1.0, maxSlots: 5 });
      s.push({ id: `spr${y + 1}`,  label: `Spring ${y + 1}`,   sub: "Jan \u2013 Apr", type: "spring", semTypeId: "spring", weight: 1.0, maxSlots: 4 });
      s.push({ id: `sumA${y + 1}`, label: `Summer 1 ${y + 1}`, sub: "May \u2013 Jun", type: "summer", semTypeId: "sumA",   weight: 0.5, maxSlots: 2 });
      s.push({ id: `sumB${y + 1}`, label: `Summer 2 ${y + 1}`, sub: "Jul \u2013 Aug", type: "summer", semTypeId: "sumB",   weight: 0.5, maxSlots: 2 });
    }
    return s;
  }

  const anchorNum    = monthNameToNum(calendar.getYearAnchor());
  const semTypes     = calendar.getSemesterTypes();

  for (let y = startYear; y < startYear + numYears; y++) {
    for (const semType of semTypes) {
      const prefix     = semType.idPrefix ?? semType.id;
      const firstMonth = parseInt(semType.months[0], 10);
      const calYear    = y + (firstMonth < anchorNum ? 1 : 0);
      s.push({
        id:        `${prefix}${calYear}`,
        label:     `${semType.label} ${calYear}`,
        sub:       semType.sub ?? buildSub(semType.months),
        type:      semType.theme,    // "fall" | "spring" | "summer" — drives row rendering
        semTypeId: semType.id,       // "fall" | "spring" | "sumA" | "sumB" — for offering checks
        weight:    semType.weight,
        maxSlots:  semType.weight >= 1.0 ? 4 : 2,
      });
    }
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
 *
 * @param {string}  planEntSem   - Entry semester type id, e.g. "fall" | "spring"
 * @param {number}  planEntYear
 * @param {string}  planGradSem  - Graduation semester type id, e.g. "fall" | "spring"
 * @param {number}  planGradYear
 * @param {import('../ports/ICalendar.js').ICalendar} [calendar]
 */
export function buildCohortSemesters(planEntSem, planEntYear, planGradSem, planGradYear, calendar) {
  let entPrefix    = planEntSem;
  let gradPrefix   = planGradSem;
  let entYearOffset = 0;

  if (calendar) {
    const anchorNum = monthNameToNum(calendar.getYearAnchor());
    const semTypes  = calendar.getSemesterTypes();
    const entType   = semTypes.find(t => t.id === planEntSem);
    const gradType  = semTypes.find(t => t.id === planGradSem);
    entPrefix  = entType?.idPrefix  ?? entType?.id  ?? planEntSem;
    gradPrefix = gradType?.idPrefix ?? gradType?.id ?? planGradSem;
    if (entType) {
      const firstMonth = parseInt(entType.months[0], 10);
      entYearOffset = firstMonth < anchorNum ? 1 : 0;
    }
  } else {
    // Legacy: spring maps to "spr" prefix and was generated in the y+1 slot
    if (planEntSem  === "spring") { entPrefix  = "spr"; entYearOffset = 1; }
    if (planGradSem === "spring")   gradPrefix = "spr";
  }

  const startYear = entYearOffset > 0 ? planEntYear - 1 : planEntYear;
  const numY  = Math.max(2, planGradYear - startYear + 2);
  const all   = generateSemesters(startYear, numY, calendar);
  const entId  = `${entPrefix}${planEntYear}`;
  const gradId = `${gradPrefix}${planGradYear}`;
  const tmpIdx = Object.fromEntries(all.map((s, i) => [s.id, i]));
  const ei = tmpIdx[entId]  ?? 1;
  const gi = tmpIdx[gradId] ?? (all.length - 1);
  return [all[0], ...all.slice(ei, Math.min(gi + 1, all.length))];
}
