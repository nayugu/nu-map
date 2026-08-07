// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN  (pure — no React, no I/O)
//
// Turns a department's published Sample Plan of Study (scripts/lib/plan-grid.js,
// shipped as src/data/**/plan.json) into planner state: placements, co-op
// blocks, and an honest account of everything it could NOT place.
//
// ── The rule this module is built around ───────────────────────────
//
// A sample plan is a suggestion, and applying it must never destroy a decision
// the student already made. So it is strictly ADDITIVE: a course already
// placed anywhere stays exactly where it is, an existing co-op is never moved
// or replaced, and nothing is removed. Applying the same plan twice changes
// nothing the second time.
//
// ── What it deliberately refuses to do ─────────────────────────────
//
// A grid cell reading "MATH 1365 or 1465" is a CHOICE, and the plan does not
// make it — the student does. Filling one in silently would be the planner
// quietly picking a course and then checking its own work, which is the
// failure mode the whole tool exists to avoid. Same for "General Elective":
// there is no course to place, only a slot to tell the student about.
//
// Everything unplaced comes back as a `notes` entry rather than being dropped,
// because a sample plan that quietly loses a third of itself looks like it
// worked.
//
// ── Co-ops are runs, not cells ─────────────────────────────────────
//
// The catalog writes a six-month co-op as TWO cells — Spring "Co-op" and
// Summer 1 "Co-op" — because its grid has one column per term. Reading them
// as two separate co-ops would give a student twice as many as their program
// requires. So consecutive co-op terms are merged into one block, and its
// length comes from the terms it spans: a full term is four months, a summer
// half is two, so Spring + Summer 1 is the six-month co-op it actually is.
// ═══════════════════════════════════════════════════════════════════

/**
 * Months in a full-weight term. NU's semester weights are 1.0 for fall/spring
 * (four months) and 0.5 for each summer half (two), and its co-ops are sold in
 * exactly those units. Overridable so an institution with a different calendar
 * is not forced through NU's arithmetic.
 */
const MONTHS_PER_UNIT_WEIGHT = 4;

/**
 * Split a semester list into academic years.
 *
 * A new year starts each time the FIRST semester type comes round again, which
 * is how src/core/semGrid.js lays them out — rather than parsing the year out
 * of the id, which would break on any calendar whose academic year does not
 * start in the fall.
 *
 * @param {object[]} semesters  generateSemesters() output
 * @returns {object[][]} one array per academic year, in order
 */
export function academicYears(semesters) {
  const real = (semesters ?? []).filter(s => s.semTypeId !== "incoming" && s.type !== "special");
  if (!real.length) return [];
  const firstType = real[0].semTypeId;
  const years = [];
  for (const sem of real) {
    if (sem.semTypeId === firstType || !years.length) years.push([]);
    years[years.length - 1].push(sem);
  }
  return years;
}

/**
 * Resolve one plan term to a semester in the student's timeline.
 * Returns null when the plan runs past the end of it — a five-year plan on a
 * four-year cohort, which is a thing to report, not to silently truncate.
 */
function semesterFor(years, yearIndex, termType) {
  return years[yearIndex]?.find(s => s.semTypeId === termType) ?? null;
}

/** A stable id for a co-op the plan created, so re-applying does not duplicate. */
const coopId = (semId, typeId) => `${typeId}-plan-${semId}`;

/**
 * Map a sample plan onto planner state.
 *
 * @param {object}   plan                  one entry from plan.json `plans[]`
 * @param {object}   ctx
 * @param {object[]} ctx.semesters         generateSemesters() output
 * @param {object}   ctx.courseMap         id → course, for "is this real?"
 * @param {object}   [ctx.placements]      current placements (never mutated)
 * @param {object}   [ctx.specialTermPl]   current special terms (never mutated)
 * @param {number}   [ctx.startYearIndex]  academic year the plan's Year 1 lands on
 * @param {string}   [ctx.coopTypeId]      special-term type for grid co-ops
 * @param {number[]} [ctx.coopDurations]   durations the institution offers, months
 * @param {number}   [ctx.monthsPerUnitWeight]
 * @returns {{placements: object, specialTermPl: object, placed: string[],
 *            coops: object[], notes: object[]}}
 */
export function mapSamplePlan(plan, {
  semesters,
  courseMap = {},
  placements = {},
  specialTermPl = {},
  startYearIndex = 0,
  coopTypeId = "coop",
  coopDurations = [4, 6],
  monthsPerUnitWeight = MONTHS_PER_UNIT_WEIGHT,
} = {}) {
  const years = academicYears(semesters);
  const nextPlacements = { ...placements };
  const nextSpecial    = { ...specialTermPl };
  const placed = [];
  const coops  = [];
  const notes  = [];

  // Every course already in the plan, by base id, so a repeat instance
  // ("CS2500#2") still counts as "the student has this".
  const held = new Set(Object.keys(placements).map(baseId));

  // Co-op cells are collected first and merged afterwards: a run cannot be
  // recognised one cell at a time.
  const coopTerms = [];

  for (const [i, gridYear] of (plan?.years ?? []).entries()) {
    const yearIndex = startYearIndex + i;
    for (const term of gridYear.terms ?? []) {
      const sem = semesterFor(years, yearIndex, term.type);
      if (!sem) {
        if (term.entries?.length) {
          notes.push({
            kind: "outside-timeline",
            year: gridYear.label, term: term.term,
            text: `${gridYear.label} ${term.term}`,
          });
        }
        continue;
      }

      for (const entry of term.entries ?? []) {
        if (entry.kind === "coop") {
          coopTerms.push({ sem, text: entry.text, year: gridYear.label });
          continue;
        }
        if (entry.kind === "choice") {
          // The one thing this must not do for the student.
          notes.push({ kind: "choice", semId: sem.id, codes: entry.codes, text: entry.text });
          continue;
        }
        if (entry.kind === "placeholder") {
          notes.push({ kind: "placeholder", semId: sem.id, text: entry.text });
          continue;
        }

        for (const code of entry.codes ?? []) {
          if (held.has(code)) {
            notes.push({ kind: "already-placed", semId: sem.id, code });
            continue;
          }
          if (!courseMap[code]) {
            // The catalog retires and renumbers courses; a plan naming one we
            // do not have is information, not a reason to fail.
            notes.push({ kind: "unknown-course", semId: sem.id, code });
            continue;
          }
          nextPlacements[code] = sem.id;
          held.add(code);
          placed.push(code);
        }
      }

      if (term.fullSummer) {
        notes.push({ kind: "full-summer", semId: sem.id, text: term.term });
      }
    }
  }

  // ── Merge consecutive co-op terms into blocks ────────────────────
  const order = new Map((semesters ?? []).map((s, i) => [s.id, i]));
  coopTerms.sort((a, b) => order.get(a.sem.id) - order.get(b.sem.id));

  let run = [];
  const flush = () => {
    if (!run.length) return;
    const start  = run[0].sem;
    const weight = run.reduce((n, t) => n + (t.sem.weight ?? 1), 0);
    const months = weight * monthsPerUnitWeight;
    // Snap to what the institution actually offers; a grid can describe a
    // length no one can register for.
    const duration = [...coopDurations].sort(
      (a, b) => Math.abs(a - months) - Math.abs(b - months) || a - b)[0] ?? months;
    const id = coopId(start.id, coopTypeId);

    // An existing co-op anywhere in the run means the student already planned
    // this stretch; leave every part of it alone.
    const occupied = run.some(t =>
      Object.values(specialTermPl).some(d => d?.semId === t.sem.id));
    if (occupied) {
      notes.push({ kind: "coop-kept", semId: start.id, text: run.map(t => t.sem.label).join(" + ") });
    } else {
      nextSpecial[id] = { typeId: coopTypeId, semId: start.id, duration };
      coops.push({ id, semId: start.id, duration, spans: run.map(t => t.sem.id) });
    }
    run = [];
  };

  for (const term of coopTerms) {
    const prev = run[run.length - 1];
    if (prev && order.get(term.sem.id) !== order.get(prev.sem.id) + 1) flush();
    run.push(term);
  }
  flush();

  return { placements: nextPlacements, specialTermPl: nextSpecial, placed, coops, notes };
}

/** Strip a repeat-instance suffix: "CS2500#2" → "CS2500". */
function baseId(pid) {
  const i = String(pid).indexOf("#");
  return i < 0 ? String(pid) : String(pid).slice(0, i);
}

/**
 * A one-line-per-category summary of what applying a plan would do, for the
 * confirmation the student sees before anything changes.
 */
export function summarizeSamplePlan(result) {
  const by = kind => result.notes.filter(n => n.kind === kind);
  return {
    placed:        result.placed.length,
    coops:         result.coops.length,
    choices:       by("choice").length,
    placeholders:  by("placeholder").length,
    alreadyPlaced: by("already-placed").length,
    unknown:       by("unknown-course").length,
    outsideRange:  by("outside-timeline").length,
    coopsKept:     by("coop-kept").length,
  };
}
