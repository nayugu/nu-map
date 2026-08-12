// ═══════════════════════════════════════════════════════════════════
// CHART · DOMAINS — the terms a cell could legally occupy
//
// A cell does not need a position in the prereq DAG. It needs a DOMAIN: the set
// of terms in which SOME course that can answer it is takeable. That reframing
// is what dissolves the question "how does a reservation get a DAG node" — it
// never needed one. The DAG supplies a lower bound on the domain and nothing
// more.
//
//   domain(c) = { T : ∃ x ∈ candidates(c) with
//                     depth(x) ≤ index(T)
//                   ∧ offeringProbability(x, season(T)) ≠ 0 }
//
// Capacity is deliberately absent. Whether a term has room depends on what else
// is placed there, so it is a propagation step, not a property of the cell.
//
// ── The DAG bound is weak, and that is measured ────────────────────
//
// 71% of the catalog has depth 0, and per program the bound leaves every study
// term legal for 52–65% of the courses the program names outright. So domains
// are mostly wide, and most-constrained-first ordering gets its signal from
// AVAILABILITY: 42.0% of courses have a season provably never offered and 17.1%
// admit only one of the four. See prereqDepth.js for the numbers.
//
// The consequence is stated where it is easy to get wrong: a narrow domain here
// means "few terms are legal", never "this belongs early". Placing a cell at its
// minimum depth would put a broad Khoury Elective in year 1, which is exactly the
// defect this engine exists to fix. Sequencing is the objective's job.
//
// ── Unknown is permission ──────────────────────────────────────────
//
// `offeringProbability` returns null for the 40.8% of the catalog with no usable
// history. Reading that as "not offered" would make two fifths of the catalog
// unschedulable. Only an explicit 0 removes a term.
// ═══════════════════════════════════════════════════════════════════

import { materialize } from "../core/candidateSpec.js";
import { groupDepth } from "./prereqDepth.js";

/**
 * @typedef {Object} CellPlan
 * @property {object} cell
 * @property {number[]} domain     legal study-term indices, ascending
 * @property {string[]|null} candidates  course ids, or null for "any course"
 * @property {Map<string,string[]|null>} seasonOk
 *   candidates not barred from each season, TRUNCATED at `wideAt` — see below
 * @property {number} minDepth     the DAG lower bound, for reporting
 */

/**
 * Why `seasonOk` may be truncated, and why `candidates` may not.
 *
 * The search re-runs the distinctness propagator at every node, and rebuilding a
 * 415-course elective pool each time cost 247 seconds on one program. The lists
 * are fixed per season, so they are computed once.
 *
 * Truncating them is sound for THAT check and only that one. At most `cellCount`
 * courses are ever spoken for, so a cell offering more than `cellCount`
 * candidates can never be blocked by distinctness — Hall's condition, read
 * directly. Keeping `cellCount + 1` of them is therefore lossless.
 *
 * It is NOT sound for the final, prereq-aware witness: the only candidate whose
 * prerequisites are met might be the 200th, and truncating would reject a plan
 * that is perfectly legal. So `candidates` stays whole and the final witness reads
 * that instead. The two callers pass different accessors, and which one they pass
 * is the whole of the distinction.
 *
 * A truncated list is still a list. `null` is reserved for the one cell kind that
 * genuinely admits any course, and making "this got long" share that value is what
 * let the witness answer a Khoury Electives cell with an ineligible course.
 */
export const wideAtFor = (cellCount) => cellCount + 1;

/**
 * How many cells one term may hold.
 *
 * MEASURED as the worst any published plan does: 9 in a full term, 5 in a summer
 * half, across both the undergraduate and graduate corpora. CHART produced an
 * 11-cell term — legal on credit, because eleven 1 SH seminars fit inside 19, and
 * absurd as advice.
 *
 * The bound is deliberately the observed MAXIMUM rather than the p90 of 6. A term
 * with seven courses is unusual and real; one with eleven is not, and a cap set at
 * the typical case would forbid plans departments actually publish.
 *
 * `semester.maxSlots` in semGrid is 4 and 2 — that is LAYOUT, how many cards a row
 * draws before scrolling, and 1,692 real terms exceed it. Using it as a constraint
 * would reject most of the corpus.
 */
export const SLOT_CAP_FULL = 9;
export const SLOT_CAP_HALF = 5;

/**
 * How many courses this term may hold.
 *
 * The inherited plan's own worst term wins where there is one, because "no worse than
 * the plan we started from" is a stronger promise than "inside what some department
 * somewhere does" — and measured, CHART was packing a term harder than the program's
 * own plan in 27 cases while still respecting the corpus-wide 9.
 *
 * The corpus maximum is the fallback, for the 363 programs that publish no plan and
 * therefore have nothing to be no-worse-than.
 */
export const termSlotCap = (term, shape = null) => {
  const full = (term?.weight ?? 1) >= 1;
  const inherited = full ? shape?.maxCoursesFull : shape?.maxCoursesHalf;
  return inherited ?? (full ? SLOT_CAP_FULL : SLOT_CAP_HALF);
};

/**
 * How many COURSES one term may hold, which is not the same as how many cells.
 *
 * A cell can name several courses — `CHEM 1211 and CHEM 1212 and CHEM 1213` is one
 * cell and three registrations — so a 9-cell cap still permitted an 11-course term
 * where the worst published plan has 9. The student registers for courses, so the
 * bound belongs on courses.
 */
export const coursesInCell = (cell) =>
  cell?.groups?.length ? Math.max(...cell.groups.map(g => g.length)) : 1;

/**
 * Materialise a cell's candidate courses, or null when it admits any.
 *
 * The distinction is the one `candidates.js` already draws and that the whole
 * planner rests on: an empty spec means "names nothing", the exact opposite of
 * "admits anything". A cell with a null spec is the second, and must never be
 * enumerated into an empty list.
 *
 * A `named` cell's candidates are its own group. A `choice` cell's are the union
 * of its groups — but a group that names a course the catalog no longer has is
 * dropped whole, because half of `PT 5410 and PT 5411` was never an answer.
 */
export function candidatesFor(cell, courseMap) {
  if (cell.kind === "named" || cell.kind === "choice") {
    const live = (cell.groups ?? []).filter(g => g.every(id => courseMap[id]));
    // Every course of every surviving group: the witness needs ids, and a group
    // is answerable exactly when all of its members are.
    return [...new Set(live.flat())];
  }
  if (!cell.spec) return null;                    // admits any course
  return [...materialize(cell.spec, courseMap)].sort();
}

/**
 * The groups a cell can still be answered by — the unit a `choice` really offers.
 *
 * Kept separate from `candidatesFor` because the witness matches COURSES while
 * legibility and the emitted plan speak in GROUPS, and flattening a group into
 * its courses is the mistake that offers PT 5410 on its own.
 */
export function liveGroups(cell, courseMap) {
  if (!cell.groups) return null;
  const live = cell.groups.filter(g => g.every(id => courseMap[id]));
  return live.length ? live : null;
}

/**
 * The earliest term a cell could possibly sit in.
 *
 * The minimum over its candidates, because the cell needs only ONE of them to be
 * takeable. For a `named` or `choice` cell the unit is the group (max within a
 * group, since co-required courses share a term; min across groups, since any
 * group answers it).
 */
export function minDepthOf(cell, { depthOf, courseMap, planDepthOf = null }) {
  // The stronger of the two bounds. Catalog depth counts chains through courses
  // this program may not schedule; plan depth counts only what it does, and for
  // named courses it is usually the larger — MATH 2321 measures 0 catalog-wide and
  // 2 within a plan that also names MATH 1341 and MATH 1342. Taking the max means
  // neither reading can license a placement the other forbids.
  const both = (id) => Math.max(depthOf(id), planDepthOf ? planDepthOf(id) : 0);

  if (cell.kind === "named" || cell.kind === "choice") {
    const live = liveGroups(cell, courseMap);
    // A cell whose every group names a renumbered course has no answer we can
    // verify. 0 rather than infinity: the requirement is real and the department
    // means it, so the plan still has to carry the cell — the diagnostic says
    // what we could not check.
    if (!live) return 0;
    return Math.min(...live.map(g => groupDepth(g, both)));
  }
  if (!cell.spec) return 0;                       // any course, including depth-0
  let best = Infinity;
  for (const id of materialize(cell.spec, courseMap)) best = Math.min(best, both(id));
  return Number.isFinite(best) ? best : 0;
}

/**
 * Domains for every cell against a shape.
 *
 * @param {object[]} cells
 * @param {object[]} terms   study terms in order (work terms already removed)
 * @param {object} ctx
 * @param {Record<string,object>} ctx.courseMap
 * @param {(id: string) => number} ctx.depthOf
 * @param {(id: string, semTypeId: string) => number|null} [ctx.offeringProbability]
 * @returns {{plans: CellPlan[], impossible: object[]}}
 */
export function buildDomains(cells, terms, {
  courseMap = {}, depthOf = () => 0, offeringProbability = () => null,
  planDepthOf = null, wideAt = wideAtFor((cells ?? []).length),
} = {}) {
  const plans = [];
  const impossible = [];
  const seasons = [...new Set(terms.map(t => t.semTypeId))];

  // Which seasons a course is not provably barred from. Cached per course, since
  // a 400-course elective pool asks the same question for every one of its cells.
  const seasonCache = new Map();
  const allowedSeasons = (id) => {
    let s = seasonCache.get(id);
    if (!s) {
      s = new Set();
      for (const t of terms) {
        if (offeringProbability(id, t.semTypeId) !== 0) s.add(t.semTypeId);
      }
      seasonCache.set(id, s);
    }
    return s;
  };

  for (const cell of cells) {
    const candidates = candidatesFor(cell, courseMap);
    const minDepth = minDepthOf(cell, { depthOf, courseMap, planDepthOf });
    const depthBoth = (id) => Math.max(depthOf(id), planDepthOf ? planDepthOf(id) : 0);

    const domain = [];
    for (let ti = 0; ti < terms.length; ti++) {
      const term = terms[ti];
      if (ti < minDepth) continue;
      if (candidates === null) { domain.push(ti); continue; }
      // A term is legal when SOME OPTION is entirely takeable in it.
      //
      // The unit is the option, not the course, and getting that wrong is how a season
      // violation survived every other gate. `CHEM 2311 and CHEM 2313` is one option
      // of two courses taken together, and `candidates.some(...)` accepted a term
      // where only ONE of them runs — because it asked "is any of these courses
      // offered" when the question is "is any WHOLE option available".
      //
      // Both conditions on the same option too: testing depth and season separately
      // would admit a term where one course is deep enough and a different one is
      // offered.
      const options = liveGroups(cell, courseMap)
        ?? candidates.map(id => [id]);      // an open pool: each candidate stands alone
      const ok = options.some(g =>
        g.every(id => depthBoth(id) <= ti && allowedSeasons(id).has(term.semTypeId)));
      if (ok) domain.push(ti);
    }

    if (!domain.length) {
      impossible.push({
        cell: cell.id, title: cell.title, target: cell.target, minDepth,
        candidates: candidates === null ? null : candidates.length,
        // Which bound killed it, so the refusal is actionable rather than
        // "infeasible".
        reason: minDepth >= terms.length ? "prereq-chain-longer-than-plan"
              : candidates?.length === 0 ? "no-catalog-course-answers-it"
              : "never-offered-in-any-term-this-plan-uses",
        // Which seasons its candidates DO run in, so the refusal is actionable: a
        // plan that needs a term the calendar does not offer is a different problem
        // from a course nothing can answer.
        seasons: candidates
          ? [...new Set(candidates.flatMap(id => [...allowedSeasons(id)]))].sort()
          : null,
      });
    }

    // Per-season lists for the search's propagator, truncated at `wideAt`.
    //
    // `null` means one thing only: THE CELL ADMITS ANY COURSE. It must not also
    // mean "this list got long", even though both are unblockable by distinctness.
    // Conflating them made the witness answer a 247-candidate Khoury Electives cell
    // with the first course in the catalog — ineligible for the requirement, and
    // worse, entered into the placement set where other cells' prerequisites are
    // checked against it. A truncated list of the cell's OWN candidates carries the
    // same Hall guarantee and cannot say anything false.
    const seasonOk = new Map();
    for (const s of seasons) {
      if (candidates === null) { seasonOk.set(s, null); continue; }
      const list = [];
      for (const id of candidates) {
          if (!allowedSeasons(id).has(s)) continue;
        list.push(id);
        if (list.length >= wideAt) break;
      }
      seasonOk.set(s, list);
    }

    plans.push({ cell, domain, candidates, seasonOk, minDepth });
  }
  return { plans, impossible };
}

/**
 * The credit a term may carry, scaled by its weight.
 *
 * Two limits, and they are different questions. The REGISTRATION cap (19 SH
 * undergraduate, 16 graduate) is what a student may enrol in and is the hard
 * one. The shape's `targetSH` is what the department intended and is soft —
 * whole cells rarely add to a stated number, so treating the target as a cap
 * would reject plans that are perfectly legal. Billing hours are a third thing
 * entirely and CHART says nothing about cost.
 */
export function termCapacity(term, { creditMax, studentType, slack = 0 }) {
  const cap = creditMax(studentType) * (term.weight ?? 1);
  return Number.isFinite(cap) ? cap + slack : Infinity;
}
