// ═══════════════════════════════════════════════════════════════════
// SEED — the department's arrangement as a search HINT
//
// International Business refuses with `search-budget-exhausted`, and the reason is not that
// the degree cannot be arranged. The department publishes an arrangement, and we measured it:
// every full term in it reaches four real courses once corequisites are grouped. A legal
// completion demonstrably exists, and our search fails to find it inside the budget.
//
// That is a SEARCH failure, and search failures have a standard remedy — look in the right
// place first. The published plan says exactly where an advisor puts each course, so it is
// the best branch ordering available for the programs that publish one (385 of them).
//
// ── A hint, emphatically not a constraint ───────────────────────────
//
// `search.js` argues the point at `termPreference` and it holds here: branch order cannot
// change what is LEGAL, only which legal thing is found first and whether one is found at
// all. So a wrong hint costs time, never correctness — the domains, the precedence chains and
// the four-course bar are all untouched, and a cell whose seed term is not in its domain
// simply falls through to the ordering below.
//
// This is also why the seed does not conflict with the standing rule that the Sample Plan of
// Study is a WITNESS and never a source. We are not copying the plan, asserting our
// requirements are a subset of it, or taking its branch of any choice: we read it only for
// "an advisor put this course in term 5", try term 5 first, and verify everything about the
// result the same way we would have anyway. It cannot make a wrong plan legal; it can only
// stop us from timing out on the way to a right one.
//
// The traversal must match `shapeFromPlan` exactly — years in order, every term object
// pushed, including work and unused ones — because the index it produces IS the shape's term
// index. Drift between the two would aim every hint one term off.
// ═══════════════════════════════════════════════════════════════════

/** Every entry in a term, including nested `either` children. */
function flatten(entries, out = []) {
  for (const e of entries ?? []) {
    if (!e || typeof e !== "object") continue;
    out.push(e);
    flatten(e.children, out);
  }
  return out;
}

/**
 * Where the department puts each named course, AND how it spreads its reservations.
 *
 * The second half is the one that matters most, and it was the whole of the International
 * Business failure. Seeding only named courses left every "Elective" row unhinted, so our
 * elective cells all drifted to the earliest term that would take them — and Year 3 Fall,
 * which the department fills with a concentration course and three electives, came out EMPTY.
 * A term of pure reservations is invisible to a hint that only knows course ids.
 *
 * So `reservationTerms` records one term index per reserved row, in term order. It is a
 * distribution, not an assignment: it says the department put four reservations in term 8 and
 * two in term 11, and our unnamed cells are handed those terms in that order.
 *
 * @param {object} [publishedPlan]  one entry of plan.json `plans[]`
 * @returns {{courseTerm: Map<string, number>, reservationTerms: number[]}}
 */
export function seedFromPlan(publishedPlan) {
  const courseTerm = new Map();
  const reservationTerms = [];
  let ti = -1;
  for (const year of publishedPlan?.years ?? []) {
    for (const term of year?.terms ?? []) {
      if (!term || typeof term !== "object") continue;
      ti += 1;
      for (const e of flatten(term.entries)) {
        if (e.coop || e.vacation || e.heading) continue;
        const ids = e.options?.length === 1 ? e.options[0] : null;
        if (ids?.length === 1) {
          // First placement wins: a course repeated across terms (rare, and always a
          // department's own duplicate row) should not have its hint overwritten by the
          // later copy, since the earlier one is what the prereq chain was built around.
          if (!courseTerm.has(ids[0])) courseTerm.set(ids[0], ti);
          continue;
        }
        // Everything else is a row the student fills themselves — an elective, a
        // concentration course, an `either` we are not entitled to decide from here. All of
        // them occupy a slot in this term, which is the fact we need.
        reservationTerms.push(ti);
      }
    }
  }
  return { courseTerm, reservationTerms };
}

/**
 * The seeded term for a cell, or null.
 *
 * A cell is seeded when its candidates AGREE — every candidate the department placed points
 * at the same term. Candidates that scatter carry no signal, and picking one of them would be
 * choosing a branch of a choice rather than following the advisor.
 *
 * @param {string[]|null} candidates  the cell's course ids, or null for a filler cell
 * @param {Map<string, number>} seed
 * @returns {number|null}
 */
export function seedTermFor(candidates, courseTerm) {
  if (!courseTerm?.size || !candidates?.length) return null;
  let found = null;
  for (const id of candidates) {
    const ti = courseTerm.get(id);
    if (ti == null) continue;
    if (found == null) found = ti;
    else if (found !== ti) return null;
  }
  return found;
}

/**
 * One hinted term per cell: the department's own arrangement, mapped onto our cells.
 *
 * Named cells take the term their course sits in. Every cell left over — the electives, the
 * concentration slots, the choices — is dealt a term from the department's reservation
 * spread, in order. That is what stops the electives clumping: the departments distribute
 * them across the whole degree, and following that distribution costs nothing, because a hint
 * is only ever a branch order.
 *
 * Deterministic by construction. Cells are dealt in id order and the spread is read in term
 * order, so the same program always produces the same hints — generation must not vary run to
 * run, and the engine has been bitten by exactly that twice.
 *
 * @param {{cell: {id: string|number}, candidates: string[]|null}[]} plans
 * @param {{courseTerm: Map<string, number>, reservationTerms: number[]}} [seed]
 * @returns {Map<string|number, number>}  cell id → hinted term index
 */
export function assignSeedHints(plans, seed) {
  const hints = new Map();
  if (!seed) return hints;
  const unseeded = [];
  for (const p of plans ?? []) {
    const ti = seedTermFor(p.candidates, seed.courseTerm);
    if (ti != null) hints.set(p.cell.id, ti);
    else unseeded.push(p);
  }
  // ── The reservation SPREAD is no longer dealt, and should not be ────
  //
  // It paired our unhinted cells against the department's reserved rows in cell-id ORDER,
  // which is not a pairing at all — "CS Required Courses" could be handed Year 1 Spring
  // because its id happens to sort early. A named course's hint is a fact ("an advisor put
  // MATH 1341 in term 0"); this was a fact about alphabetical order wearing the same clothes.
  //
  // It measured well on the numbers I was watching — refusals, empty terms — and those are
  // blind to sequencing. What it actually produced was `CS 4530 or 4535` in year one and
  // CS 3000 at the end of the degree. The level and unlock orderings it displaced are
  // measured over 12,848 placements; this was not measured at all.
  //
  // Named cells keep their hints, because those are real. `unseeded` is left unhinted and
  // ordered by the preferences, exactly as before any of this existed.
  void unseeded;
  return hints;
}
