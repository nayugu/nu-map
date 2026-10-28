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

/**
 * ── "<season> <year>", one composition for the whole app ────────────
 *
 * There used to be two. The planner rows and the sample-plan preview built
 * `t(key) + " " + year` and read season-first ("春季 2028"); the header toast,
 * the availability popover and the summer row handed the whole phrase to the
 * translation engine and got back year-first ("2028 年春季"). Either is fine.
 * Both, a few pixels apart, naming the same semester, is not.
 *
 * Unified on the written path, because the engine's cannot be reviewed: it is a
 * network call, it is not stable across releases, and it is what once turned
 * "Fall" into 落下 ("falling"). But written season keys alone would have forced
 * season-first on every language, and CJK genuinely wants the year in front — a
 * Chinese reader says 2028年春季, never 春季 2028. So the ORDER is its own locale
 * string, `sem.name.format`, filled with the hand-written season name:
 * deterministic AND idiomatic, which neither old path managed alone.
 *
 * Lives in core, not beside the component that first needed it, so the four
 * surfaces that draw a semester's name cannot drift apart again — and so it is
 * testable without a DOM.
 *
 * A term with no year (Incoming Credit) is its season alone: sending it through
 * the format would leave whatever the format wraps the year in — a stray 年, a
 * trailing space — around nothing.
 *
 * @param {(key: string, vars?: object) => string} t  the locale lookup
 * @param {string} seasonKey  a written `claude.sem.*` key
 * @param {string|number} [year]
 * @param {string} [fallback] returned when there is no season key to compose
 */
export function semName(t, seasonKey, year, fallback = "") {
  if (!seasonKey) return fallback;
  const season = t(seasonKey);
  if (!year) return season;
  return t("sem.name.format", { season, year });
}

/**
 * ── Cohort bounds: which terms a plan can start and end in ───────────
 *
 * A plan ends in a full term or in a whole SUMMER, never in one summer session,
 * because that is how the registrar confers: once per summer, after Session B
 * (Aug 19, 2026 in the 2025–26 calendar), whichever session the last courses
 * were in. The June date is "by exception", exactly like the fall and spring
 * mid-semester ones, and the picker never offered those either. So "Summer" is
 * stored as the LAST summer session's id: the timeline keeps the whole summer
 * row (both halves draw as one), and the plan turns graduated when the degree
 * is actually conferred rather than halfway through the summer.
 *
 * Entry stays the full terms only; starting in a summer is a different request.
 *
 * @param {import('../ports/ICalendar.js').ICalendar} calendar
 * @returns {{ entry: string[], graduation: string[] }} semester type ids
 */
export function cohortTermChoices(calendar) {
  const types = calendar.getSemesterTypes();
  const entry = types.filter(t => !t.optional).map(t => t.id);
  const lastOfTheme = new Map();
  for (const t of types) if (t.optional) lastOfTheme.set(t.theme, t.id);
  return { entry, graduation: [...entry, ...lastOfTheme.values()] };
}

/**
 * Chronological ordinal of a cohort bound: calendar year, then the month the
 * term starts in. A plan's years are CALENDAR years (Fall 2026, Spring 2027),
 * so ordering by the calendar's list position — Fall first — ranked Spring 2030
 * after Fall 2030, and a summer would have landed after the fall that follows it.
 *
 * @param {string} typeId  semester type id
 * @param {number} year
 * @param {import('../ports/ICalendar.js').ICalendar} calendar
 */
export function cohortOrd(typeId, year, calendar) {
  const type  = calendar.getSemesterTypes().find(t => t.id === typeId);
  const month = type ? parseInt(type.months[0], 10) : 0;
  return year * 100 + month;
}

/** The locale key naming a cohort bound: `header.cohort.<theme>`. */
export function cohortTermKey(typeId, calendar) {
  const theme = calendar.getSemesterTypes().find(t => t.id === typeId)?.theme ?? typeId;
  return `header.cohort.${theme}`;
}

/**
 * A plan's length in years of full terms, both bounds included, and whether it
 * ends in a summer. The summer is reported beside the count rather than folded
 * into it: "4 yrs + summer" is what a student would say, where "4.25 yrs" is a
 * number nobody plans by.
 */
export function cohortDuration(entSem, entYear, gradSem, gradYear, calendar) {
  const theme = id => calendar.getSemesterTypes().find(t => t.id === id)?.theme;
  const half  = (id, y) => y * 2 + (theme(id) === "fall" ? 1 : 0);
  return {
    years:  (half(gradSem, gradYear) - half(entSem, entYear) + 1) / 2,
    summer: theme(gradSem) === "summer",
  };
}
