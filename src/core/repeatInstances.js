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
    unscoped so parked takes keep their ids reserved. */
export function takesUsed(base, placements, placedOut, semIndex) {
  let n = 0;
  for (const [id, sid] of Object.entries(placements ?? {})) {
    if (baseId(id) !== base) continue;
    if (semIndex && semIndex[sid] === undefined) continue; // parked off-timeline
    n++;
  }
  if (placedOut) for (const id of placedOut) if (baseId(id) === base) n++;
  return n;
}

/**
 * Retake availability — the OTHER reason a second take can exist.
 *
 * `repeatable` courses accumulate: every take earns credit (MUS 1990).
 * A RETAKE is different: NEU lets any nonrepeatable course be retaken
 * "to earn a better grade" — the latest grade replaces the earlier one,
 * credits count once. A retake becomes available the moment every
 * existing take carries an ENTERED terminal grade (any symbol but I —
 * an incomplete resolves in place, no new registration). Without a
 * grade entered there is nothing to retake *from*, so ungraded courses
 * keep today's semantics exactly: drag moves, re-add relocates.
 *
 * No instance flag needed anywhere: an instance id on a nonrepeatable
 * course IS a retake, by construction.
 */
export function retakeUnlocked(course, placements, placedOut, grades) {
  if (!course || course.repeatable || !grades) return false;
  let takes = 0;
  for (const id of Object.keys(placements ?? {})) {
    if (baseId(id) !== course.id) continue;
    takes++;
    const g = grades[id];
    if (g == null || g === "I") return false;
  }
  if (placedOut) for (const id of placedOut) {
    if (baseId(id) !== course.id) continue;
    takes++;
    const g = grades[id];
    if (g == null || g === "I") return false;
  }
  return takes > 0;
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

  const used = takesUsed(base, placements, placedOut);
  const max  = retake ? Infinity : (course.repeatMax ?? Infinity);
  for (let n = 2; ; n++) {
    const cand = `${base}#${n}`;
    if (placements?.[cand] == null && !placedOut?.has?.(cand)) {
      return { id: cand, overLimit: used >= max };
    }
  }
}
