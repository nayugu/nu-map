// ═══════════════════════════════════════════════════════════════════
// Repeat instances — multiple takes of a repeatable course in one plan.
//
// The FIRST take uses the plain course id ("MUS1990"); each later take
// gets a synthetic instance id ("MUS1990#2", "MUS1990#3"). "#" cannot
// collide with real ids (always SUBJECT+NUMBER). Because every take is
// its own placement key, the placement store, semester ordering, drag
// ids, share links and undo history all work untouched — consumers
// resolve an instance id to a clone of its base course through the
// courseMap (materialized in PlannerContext).
//
// Shared by the browser (drop handler, applyMCPActions) and the Node/
// worker MCP action adapter, so both sides assign identical ids when
// replaying the same changeset against the same placements snapshot.
// ═══════════════════════════════════════════════════════════════════

import { takeConsumesSlot } from "./gradeSystem.js";

/** "MUS1990#2" → "MUS1990"; plain ids pass through unchanged. */
export function baseId(id) {
  const i = String(id).indexOf("#");
  return i === -1 ? id : id.slice(0, i);
}

export function isInstanceId(id) {
  return String(id).includes("#");
}

/** How many takes of `base` the plan holds (placements plus placed-out).
    Pass `semIndex` (SEM_INDEX) to count only takes INSIDE the plan's
    timeline — the display rule; id-assignment (resolveAddId) stays
    unscoped so parked takes keep their ids reserved.
    Pass `grades` to count EFFECTIVE takes: a definitively failed take
    (F/U/W — see takeConsumesSlot) hands its slot back and is not
    counted. Omit it to count raw placements (display: the ↻ marker
    should still say a course appears twice). */
export function takesUsed(base, placements, placedOut, semIndex, grades) {
  let n = 0;
  for (const [id, sid] of Object.entries(placements ?? {})) {
    if (baseId(id) !== base) continue;
    if (semIndex && semIndex[sid] === undefined) continue; // parked off-timeline
    if (grades && !takeConsumesSlot(grades[id])) continue;
    n++;
  }
  if (placedOut) for (const id of placedOut) {
    if (baseId(id) !== base) continue;
    if (grades && !takeConsumesSlot(grades[id])) continue;
    n++;
  }
  return n;
}

/**
 * Build the `takesOf` resolver evalPrereqTree consumes: base course id →
 * every take of it, with semester index and entered grade. Lives here —
 * takes and instance ids are this module's domain — so the core grade
 * modules form a DAG (prereqEval → gradeSystem ← repeatInstances), not a
 * cycle.
 *
 * Returns NULL when no grades are entered — the caller passes that straight
 * through, the evaluator runs its legacy path bit-for-bit, and the default
 * experience cannot change. The whole feature hangs off this line.
 *
 * Placement filtering is EXACTLY the legacy lookup's: membership in
 * `semIndex`, nothing else. semIndex includes "incoming" (transfer credits
 * satisfy prereqs — planModel.js "Timeline scope"); a cleverer filter here
 * once sprayed phantom grade violations across every transfer-satisfied
 * course the moment a single unrelated grade was entered. Any divergence
 * from what `semIndex[placements[id]]` would yield is a bug in this
 * function, and there is a test asserting the equivalence.
 *
 * @param {Record<string,string>} placements  effective placements (incl.
 *   substitution-virtual entries)
 * @param {Iterable<string>} placedOut
 * @param {Record<string,string>} grades      { placementId → symbol }
 * @param {Record<string,number>} semIndex
 * @returns {null | (baseCourseId: string) => {fi: number|"out", grade: string|null}[]}
 */
export function buildTakesResolver(placements, placedOut, grades, semIndex) {
  if (!grades || !Object.keys(grades).length) return null;
  const byBase = new Map();
  for (const [pid, sid] of Object.entries(placements ?? {})) {
    const fi = semIndex[sid];
    if (fi === undefined) continue; // parked off-timeline
    const b = baseId(pid);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push({ fi, grade: grades[pid] ?? null });
  }
  for (const pid of placedOut ?? []) {
    const b = baseId(pid);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push({ fi: "out", grade: grades[pid] ?? null });
  }
  return id => byBase.get(id) ?? [];
}

/**
 * Retake availability — the OTHER reason a second take can exist.
 *
 * The counter rule (takeConsumesSlot): a take occupies its slot unless it
 * DEFINITIVELY FAILED — F/U/W hand the slot back, an I occupies it
 * (resolves in place, no new registration), a passing grade LOCKS it (no
 * duplicates of a course you already have credit for; NEU technically
 * permits retaking a passed course for a better grade, but a planner has
 * no business offering that). So for a nonrepeatable course a retake is
 * available exactly when it has takes and every one of them failed —
 * "failing resets the counter to zero".
 *
 * No instance flag needed anywhere: an instance id on a nonrepeatable
 * course IS a retake, by construction.
 */
export function retakeUnlocked(course, placements, placedOut, grades) {
  if (!course || course.repeatable || !grades) return false;
  const raw = takesUsed(course.id, placements, placedOut);
  if (raw === 0) return false;
  return takesUsed(course.id, placements, placedOut, null, grades) === 0;
}

/**
 * Resolve the placement id a NEW add of `course` should use.
 *
 * NU Map trusts the user: the repeat limit is never enforced, only
 * reported — `overLimit` is true when this add EXCEEDS the catalog's
 * stated maximum, and the UI renders it with the same warn treatment
 * as an overloaded semester or a prereq violation. (College retake
 * limits vary — Khoury grad ×2, COE grad ×1 — so retakes never flag.)
 *
 * @param {object} [grades]  optional { placementId → symbol }; enables
 *   the retake path above. MCP paths deliberately DON'T pass it —
 *   grades are never exposed over MCP, and the browser applier and the
 *   server validator must assign identical ids from the same snapshot.
 *
 * @returns {{ id: string, overLimit: boolean }}
 *   - base id when the course isn't in the plan yet
 *   - base id when it is but the course isn't repeatable and no retake
 *     is unlocked (callers keep their existing semantics: drag moves,
 *     MCP relocates)
 *   - the lowest free instance id for an additional take or a retake
 */
export function resolveAddId(course, placements, placedOut, grades) {
  const base = course.id;
  const placed = placements?.[base] != null || placedOut?.has?.(base);
  if (!placed) return { id: base, overLimit: false };
  const retake = !course.repeatable && retakeUnlocked(course, placements, placedOut, grades);
  if (!course.repeatable && !retake) return { id: base, overLimit: false };

  // Effective takes: failed ones handed their slot back, so they don't
  // count against repeatMax either.
  const used = takesUsed(base, placements, placedOut, null, grades);
  const max  = retake ? Infinity : (course.repeatMax ?? Infinity);
  for (let n = 2; ; n++) {
    const cand = `${base}#${n}`;
    if (placements?.[cand] == null && !placedOut?.has?.(cand)) {
      return { id: cand, overLimit: used >= max };
    }
  }
}
