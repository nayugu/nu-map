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

/** How many takes of `base` the plan holds (placements plus placed-out). */
export function takesUsed(base, placements, placedOut) {
  let n = 0;
  for (const id of Object.keys(placements ?? {})) if (baseId(id) === base) n++;
  if (placedOut) for (const id of placedOut) if (baseId(id) === base) n++;
  return n;
}

/**
 * Resolve the placement id a NEW add of `course` should use.
 *
 * NU Map trusts the user: the repeat limit is never enforced, only
 * reported — `overLimit` is true when this add EXCEEDS the catalog's
 * stated maximum, and the UI renders it with the same warn treatment
 * as an overloaded semester or a prereq violation.
 *
 * @returns {{ id: string, overLimit: boolean }}
 *   - base id when the course isn't in the plan yet
 *   - base id when it is but the course isn't repeatable (callers keep
 *     their existing semantics for that case: drag moves, MCP relocates)
 *   - the lowest free instance id for an additional take
 */
export function resolveAddId(course, placements, placedOut) {
  const base = course.id;
  const placed = placements?.[base] != null || placedOut?.has?.(base);
  if (!placed || !course.repeatable) return { id: base, overLimit: false };

  const used = takesUsed(base, placements, placedOut);
  const max  = course.repeatMax ?? Infinity;
  for (let n = 2; ; n++) {
    const cand = `${base}#${n}`;
    if (placements?.[cand] == null && !placedOut?.has?.(cand)) {
      return { id: cand, overLimit: used >= max };
    }
  }
}
