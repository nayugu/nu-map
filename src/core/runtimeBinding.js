// ═══════════════════════════════════════════════════════════════════
// RUNTIME BINDING  (pure — no React, no I/O)
//
// Which requirements each undecided card could still be for, recomputed against
// the plan as it stands.
//
// ── Why this is computed and not carried ───────────────────────────
//
// `applySamplePlan` records a requirement on a reservation only when the
// binding was FORCED. Every ambiguous card — 3,882 of them — therefore arrives
// knowing nothing, reads as "anything counts", and offers all 7,966 courses.
// The union of what its real candidates admit is a median of 34.
//
// Carrying the answer instead was measured: +54% on the reservations payload,
// which is on the wire in every share link, and frozen at the moment the plan
// was applied so it drifts against the next scrape. Recomputing costs nothing
// to store, cannot go stale, and gets SHARPER as the student places courses,
// because the obligations it solves against shrink.
//
// ── Narrowing only, never re-pointing ──────────────────────────────
//
// §3 of the design rejected binding as a runtime query, and was right about the
// failure it named: satisfy Khoury by hand and a fresh solve re-points the
// "Khoury Elective" card at general electives. It still means Khoury.
//
// §11 resolves it. A live solve may only INTERSECT with what was already
// possible:
//
//   stored requirement resolves  → that is the answer; a live solve may not
//                                  contradict a binding the scrape forced
//   nothing stored               → the live solve, intersected with `previous`
//
// When a card loses every candidate the caller reports "already covered" (see
// `isSpare` in candidates.js) rather than rebinding — the case §3 protected.
//
// ── Why `previous` is not optional bookkeeping ─────────────────────
//
// A live solve is NOT monotone on its own, and assuming it was is a mistake
// this file made first. Elimination is relative to competition: cell A is
// excluded from requirement R only because cells B and C must go there. Satisfy
// B and C by hand and R has room again, so A ACQUIRES R as a candidate —
// observed on the real corpus, a card gaining a target as the plan filled up.
//
// More information making a card MORE ambiguous is exactly the churn §3 warned
// about, so monotonicity is imposed rather than hoped for: passing the last
// answer back in makes each solve a refinement of the one before. The baseline
// resets on reload, which is right — a fresh session re-derives against today's
// data instead of inheriting a stale narrowing.
//
// ── Named cells take part too ──────────────────────────────────────
//
// A cell reading "CS 4300 or 4100" is still an unanswered cell that will
// consume one requirement's capacity, so it belongs in the same solve rather
// than in a second one that cannot see these seats (§12.0 measured 44 sections
// claimed twice when they were separate; this brings it to 34).
//
// It does NOT reach zero, and cannot: "forced" means *no other requirement is
// possible for this cell*, which is a per-cell test. Two cells can each have
// exactly one possible home and still not both fit — a plan demanding more than
// a requirement holds. That is a real finding about the data, and §6 already
// lists it as a verification gate; it is not something this solve can remove.
// ═══════════════════════════════════════════════════════════════════

import { obligationsOf, bindCells, courseEligible } from "./requirementBinding.js";
import { resolveRequirement, cleanOptionGroups } from "./reservations.js";
import { baseId } from "./repeatInstances.js";

/**
 * The course ids a plan has actually committed to, as the audit counts them.
 * Repeat instances collapse to their base — a requirement is satisfied by the
 * course, not by which take of it.
 */
function placedSetOf(placements) {
  const out = new Set();
  for (const key of Object.keys(placements ?? {})) out.add(baseId(key));
  return out;
}

/**
 * Could this card count toward this requirement at all?
 *
 * A CHECKABLE fact, so it deletes edges outright. For a card that names its
 * options, the requirement must admit at least one of them — a cell that could
 * become CS 4300 or CS 4100 can land in a requirement admitting either.
 * "Admits every option" is a different and stronger question (certainty), and
 * using it here would delete edges that are genuinely possible.
 *
 * Sentinels carry no spec and admit anything.
 */
function optionsAdmitted(groups, obligation, courseMap) {
  if (!obligation?.spec) return true;
  // Groups arrive already cleaned, so every member is a real course.
  return groups.some(g => g.every(id => courseEligible(courseMap[id], obligation.spec)));
}

/**
 * Solve every undecided card against what the program still demands.
 *
 * @param {object} reservations   id → reservation
 * @param {object} ctx
 * @param {object} ctx.programData
 * @param {object} ctx.placements     the student's real placements
 * @param {object} ctx.courseMap
 * @param {object} [ctx.hints]        `{admits, prefers}` — wording evidence,
 *   supplied by the institution adapter. The solver runs correctly without it,
 *   just less often decisively.
 * @param {Map<string, (number|string)[]>} [ctx.previous]  the last answer, so
 *   this one can only refine it. Omit it and the result is the raw solve, which
 *   is not monotone — see the header.
 * @returns {Map<string, (number|string)[]>} reservation id → candidate targets
 */
export function bindReservations(reservations, {
  programData, placements = {}, courseMap = {}, hints = null, previous = null,
} = {}) {
  const out = new Map();
  const list = Object.values(reservations ?? {}).filter(r => r?.id);
  if (!list.length || !programData) return out;

  const obligations = obligationsOf(programData, {
    placedSet: placedSetOf(placements), courseMap,
  });
  if (!obligations.length) return out;

  // Deterministic order. The target sets themselves do not depend on it — each
  // is decided by re-solving that one cell — but the soft pass breaks ties by
  // position, and a Map that reorders between renders would make the picker
  // flicker.
  const cells = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // `admits` is checkable evidence and may delete edges. The institution's
  // reading of the label is composed with the option check; either may veto.
  const admits = (cell, obligation) => {
    if (cell.groups && !optionsAdmitted(cell.groups, obligation, courseMap)) return false;
    return hints?.admits ? hints.admits(cell, obligation) : true;
  };

  const shaped = cells.map(r => ({
    text: r.label ?? "",
    groups: cleanOptionGroups(r.options, courseMap),
  }));

  const result = bindCells(shaped, obligations, { admits, prefers: hints?.prefers ?? null });

  cells.forEach((r, i) => {
    // §11: never contradict a binding the scrape forced. Where one exists it IS
    // the answer, and the live solve is not consulted — that is the whole of
    // "narrowing only, never re-pointing".
    //
    // The case where the stored requirement has since been satisfied is NOT
    // handled by swapping in the live answer, which would be the re-pointing §3
    // rejected. It is handled downstream: `withoutSatisfiedRequirements` drops
    // it for having no demand, leaving the card with none, which `isSpare`
    // reports as "your plan already covers this".
    const stored = resolveRequirement(r, programData);
    if (stored) { out.set(r.id, [stored.index]); return; }

    // Refine the last answer, never replace it. Without this a card can gain a
    // candidate when its competition is satisfied elsewhere.
    const live = result[i]?.targets ?? [];
    const prior = previous?.get(r.id);
    out.set(r.id, prior ? live.filter(t => prior.includes(t)) : live);
  });
  return out;
}
