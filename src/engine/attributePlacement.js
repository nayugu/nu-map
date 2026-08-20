// ═══════════════════════════════════════════════════════════════════
// ATTRIBUTE PLACEMENT — "a course carrying this designation belongs here"  (pure)
//
// A registrar publishes designations (at Northeastern, NUPath codes) and some of them carry a
// positional convention that nothing else in the plan encodes. This module applies those
// conventions, and it does so as the LAST thing that happens: every hard constraint, every ranked
// objective and every threshold repair has already settled, and this looks at the finished plan
// and asks one question per rule.
//
// ── Why it is a table and not a function per designation ────────────
//
// The engine already had exactly one of these, spelled as two fields on the calibration
// (`capstoneAttribute` and `capstoneFloor`) and read directly by `settleCapstones`. That is fine
// for one and wrong for two: the second one arrives as another pair of fields, another named pass,
// and another copy of the same swap loop. So the rules are DATA, declared by the adapter, and this
// module is the only thing that knows how to run them.
//
// ── Hexagonal placement ────────────────────────────────────────────
//
// This is engine, so it is pure and institution-free: no NUPath code appears here. The codes and
// their conventions live in `src/adapters/northeastern/chartCalibration.js`, which is where every
// other measured Northeastern number already lives, and arrive as `cal.attributePlacement`. An
// institution that declares nothing gets no behaviour, which is the honest default.
//
// ── The vocabulary is CLOSED, and an unknown rule is reported ───────
//
// `notBefore` and `swapWith` are enumerations, not free strings. A rule this module does not
// understand is skipped and named in `unknown`, never silently dropped — a preference that stops
// applying because someone renamed a key is invisible in every corpus metric, which is exactly how
// a frozen phase-2 pass survived unnoticed. `test/unit/engine-writing-coop.test.js` asserts the
// shipped calibration contains only known kinds, so a typo fails in CI rather than in a plan.
// ═══════════════════════════════════════════════════════════════════

/** Where a rule may say a designation must not fall before. Extend deliberately. */
export const ANCHORS = Object.freeze({
  /** The first employment term — the study-term index `firstWorkBoundary` returns. */
  FIRST_WORK: "firstWork",
});

/** What a displaced cell is allowed to trade places with. Extend deliberately. */
export const PARTNERS = Object.freeze({
  /**
   * A general elective: the only cell in a plan that names no course. Moving one earlier costs
   * the student no sequencing at all, and it cannot itself be "too early" for anything.
   */
  GENERAL_ELECTIVE: "generalElective",
});

/**
 * Does this cell deliver the designation whichever option the student takes?
 *
 * `∀ option, ∃ member` — the same reading the engine uses for credit, competencies and unlock
 * value. A cell offering `ENGW 3302 or an ordinary elective` does not deliver advanced writing,
 * because the student may take the other branch; within one group the `∃` is right, since a group
 * is courses taken together.
 */
export function cellCarries(plan, courseMap, attribute) {
  if (!attribute) return false;
  const groups = plan?.cell?.groups;
  if (!groups?.length) return false;
  return groups.every(g => g.length > 0 && g.some((id) => {
    const a = courseMap?.[id]?.attributes;
    // `Array.isArray` on purpose: a scrape that hands back the string "WD" would otherwise match
    // any single-letter code through `String.includes`.
    return Array.isArray(a) && a.includes(attribute);
  }));
}

/**
 * The earliest study-term index a rule permits, or null when the rule states no bound here.
 *
 * Separated from the swap so "what does this rule mean" is testable without building a plan.
 */
export function ruleFloor(rule, { boundary, terms }) {
  if (rule?.notBefore === ANCHORS.FIRST_WORK) {
    // No employment term, or employment first: there is no "after the co-op" to speak of.
    if (boundary == null || boundary <= 0 || boundary >= terms.length) return null;
    return boundary;
  }
  return null;
}

/**
 * Apply every declared placement rule to a finished assignment.
 *
 * @returns {{termOf: Map, moves: number, applied: object[], unknown: object[]}}
 */
export function applyAttributePlacement(termOf, {
  plans, terms, boundary, courseMap, rules = [], generalElectiveTarget,
  electiveCeiling = Infinity, isLegal = () => true,
}) {
  const applied = [];
  const unknown = [];
  if (!rules.length) return { termOf, moves: 0, applied, unknown };

  let current = new Map(termOf);
  let moves = 0;

  for (const rule of rules) {
    if (!rule?.attribute
        || !Object.values(ANCHORS).includes(rule.notBefore)
        || !Object.values(PARTNERS).includes(rule.swapWith)) {
      unknown.push(rule);
      continue;
    }
    const floor = ruleFloor(rule, { boundary, terms });
    if (floor == null) continue;

    // Deterministic: two runs must produce the same plan, and a plan may carry more than one cell
    // with the same designation.
    const displaced = plans
      .filter(p => cellCarries(p, courseMap, rule.attribute)
        && (current.get(p.cell.id) ?? Infinity) < floor)
      .sort((a, b) => String(a.cell.id).localeCompare(String(b.cell.id)));

    for (const cell of displaced) {
      const i = current.get(cell.cell.id);
      if (i == null || i >= floor) continue;

      // ── The partner, and why the EARLIEST one after the floor ──────
      //
      // The rule says "not before"; it does not say "as late as possible". Taking the latest
      // partner strands the designated course at the end of the plan and drags an elective all
      // the way forward to pay for it, because a swap moves two cells. Measured on
      // `computer_science_and_physics` with latest-first: `PHYS 3602` and `CS 4530` ended up in
      // the final term and three general electives came back to terms 4 and 5 — the exact
      // arrangement `reclaimFromFiller` exists to undo.
      const partners = plans
        .filter(p => p !== cell
          && p.cell.target === generalElectiveTarget
          // Same credit and the same number of registrations, which is what makes the swap
          // load-NEUTRAL: term credit, course counts, the four-course floor and the
          // same-requirement cap are all arithmetically unchanged, so this pass cannot undo
          // what the passes above it settled.
          && (p.cell.sh ?? 0) === (cell.cell.sh ?? 0)
          && coursesIn(p.cell) === coursesIn(cell.cell))
        .map(p => ({ p, j: current.get(p.cell.id) }))
        .filter(x => x.j != null && x.j >= floor)
        .sort((a, b) => a.j - b.j || String(a.p.cell.id).localeCompare(String(b.p.cell.id)));

      for (const { p, j } of partners) {
        if (!cell.domain?.includes(j) || !p.domain?.includes(i)) continue;
        const trial = new Map(current);
        trial.set(cell.cell.id, j);
        trial.set(p.cell.id, i);
        // The one criterion a load-neutral swap can still break: an elective arriving early can
        // leave a term reading as nothing but placeholders. Bounded by what the incoming plan
        // already tolerated rather than by a constant — phase 1 is entitled to hand over a
        // three-elective term, and this pass must not be the thing that refuses it.
        if (electivesAt(plans, trial, i, generalElectiveTarget) > electiveCeiling) continue;
        if (!isLegal(trial)) continue;
        current = trial;
        moves++;
        applied.push({
          attribute: rule.attribute, course: cell.cell.title ?? "", from: i, to: j, floor,
        });
        break;
      }
    }
  }
  return { termOf: current, moves, applied, unknown };
}

/** Registrations a cell contributes to its term — a corequisite group is more than one. */
const coursesIn = (cell) =>
  cell?.groups?.length ? Math.max(...cell.groups.map(g => g.length)) : 1;

const electivesAt = (plans, assignment, ti, target) => {
  let n = 0;
  for (const p of plans) if (p.cell.target === target && assignment.get(p.cell.id) === ti) n += 1;
  return n;
};
