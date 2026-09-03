// ═══════════════════════════════════════════════════════════════════
// MINOR OVERLAP  (pure — no React, no I/O)
//
// Northeastern caps how much of a minor may be paid for twice:
//
//   "Students are permitted to double count a maximum of 50% of the credits
//    required for a minor from their major, transfer credit, or advanced
//    standing credit. Individual programs may have stricter requirements."
//      — Undergraduate catalog, Degrees, Majors, and Minors § Minors
//
// The companion sentence, on the same page and on the CPS minors page, is the
// one that makes this a cap rather than a ban: "courses used to fulfil
// requirements for the minor may also be used to complete undergraduate degree
// requirements". Overlap is expected — a minor is meant to fit inside the free
// electives — so the only thing measured here is overlap with a MAJOR's
// requirement sections. A minor course that lands in the degree's general
// electives is the normal case and is not shared credit.
//
// ── What this does NOT do ─────────────────────────────────────────
//
// It never un-allocates anything. The audit's allocation is unchanged with and
// without this module: a course the minor counts still counts, and the report
// is a separate statement about the plan. Choosing courses to drop in order to
// respect a percentage would be inventing an advising decision, and it would
// make the requirement rows disagree with the courses on the board.
//
// Transfer and advanced-standing credit share the same 50% budget in the
// policy and are NOT measured here, because this app models neither: a
// placed-out course carries no credit ("no credit, but satisfy prerequisites")
// and there is no transfer-credit input at all. So the figure reported is a
// LOWER bound on the policy's own numerator, which is the permissive
// direction — see the note on the denominator for the other one.
//
// ── The denominator, and why it is derived ────────────────────────
//
// "the credits required for a minor" is mostly not published in a field we
// hold: 169 of 181 minor pages state no total at all, and the 12 that do state
// one shipped as `totalCreditsRequired: 0` until the scraper learned to read a
// minor-sized figure (see MINOR_CREDIT_WINDOW in catalog-program-parser.js).
// So the requirement is read off the same allocator the rest of the audit uses:
// Σ `demandOf` over the minor's sections.
//
// Those 12 are the only place that derivation can be CHECKED against the
// registrar, and it holds: derived equals stated exactly on **9 of 10** minors
// where both numbers exist — Aerospace 20, Audiology 15, Behavioral
// Neuroscience 20, English 16, Global Perspectives in Engineering 24, and the
// rest. Not "within a credit": equal.
//
// ⚠ The tenth is Computer Science, Minor, which derives **52 SH against a page
// that says 20**, because eight of its ten parsed sections are the colleges
// making up the "Khoury meaningful minors list" — one elective's MENU, printed
// as siblings of the requirement it belongs to. That is the defect CLAUDE.md
// records for Data Science MSAlign, it lives in the section parse, and it is
// not repaired here.
//
// It is deliberately not repaired by preferring `totalCreditsRequired` either,
// which is the obvious move and is wrong: the denominator would become the
// registrar's 20 while the numerator went on being counted against the same
// inflated sections, and a course claimed by one of those phantom menu sections
// would then be charged against a cap less than half the size. Two accountings,
// one subtraction — the trap `demandOf` and `satisfiedOf` were merged to avoid.
// Left as it is, the cap on that one minor is too GENEROUS (26 SH where the
// truth is 10), and that is the survivable direction: a missed warning leaves a
// student where they already were, a false one tells them to take courses they
// do not owe.
// ═══════════════════════════════════════════════════════════════════

import { allocateSections, allocateMajorSections, courseKey } from "./gradRequirements.js";
import { demandOf, satisfiedOf, typicalSH, DEFAULT_UNIT_SH } from "./requirementDemand.js";
import { specForNode } from "./programEligibility.js";
import { baseId } from "./repeatInstances.js";

/**
 * The grade that means "these hours transferred".
 *
 * `T` covers transfer, AP, IB and waiver credit — hours earned, no quality
 * points. Named here rather than written as a literal because this module reads
 * it for a POLICY reason (the 50% ceiling counts transfer credit against the
 * minor) that has nothing to do with grade arithmetic.
 */
const TRANSFER_GRADE = "T";

/** The policy's fraction. A parameter of Northeastern's rule, not of degrees. */
export const MINOR_SHARE_FRACTION = 0.5;

/** Credit sums are integers in practice; this guards a `.5` cap against FP dust. */
const EPS = 1e-9;

/**
 * The sections of a minor that state requirements.
 *
 * "Required General Electives" is a placeholder the audit generates for majors
 * and never a minor's own requirement. Four call sites filtered it inline with
 * four copies of the same string literal — both minor allocations in
 * `RelevanceContext` and both in `MinorBlock` — and this is that string once
 * for the minor path. `gradRequirements` keeps its own two copies for the
 * MAJOR path: this module imports it, so reaching back would close a cycle.
 */
export function minorRequirementSections(minor) {
  return (minor?.requirementSections ?? []).filter(
    section => section && section.title !== "Required General Electives"
  );
}

/**
 * What the MAJORS claim, as a function of a hypothetical placed set.
 *
 * The shape `minorShare` wants for `majorClaim`, built once so the three places
 * that need it cannot form three opinions: the graduation panel, the board's
 * relevance layer, and the printed report. The panel and the board in
 * particular MUST agree — one draws the requirement rows and the other draws
 * the badge on the card, and a student looking at both at once is the person
 * who finds out when they disagree.
 *
 * A function rather than a set, because the cap asks counterfactuals: "could
 * the major have satisfied that requirement without this course?"
 *
 * Returns per-section satisfied credit rather than one total. A total cannot
 * tell "nothing changed" from "one section lost exactly what another gained",
 * and the second is a broken requirement.
 *
 * General Electives is excluded by construction — `allocatedSet` is the
 * requirement claim — because a minor course landing in the degree's free
 * electives is not double-counted credit, it is the room a minor is meant to
 * occupy. The catalog says so outright: "courses used to fulfil requirements
 * for the minor may also be used to complete undergraduate degree
 * requirements."
 *
 * @param {{data: object, concentration?: object|null}[]} programs
 *        Each major, with its chosen concentration SECTION already resolved
 *        (title resolution is the caller's; `concentrationResolve` owns it).
 * @param {Record<string, object>} courseMap
 * @returns {(placed: Set<string>) => {sat: number[], claimed: Set<string>}}
 */
export function majorClaimOf(programs, courseMap = {}) {
  const list = (programs ?? []).filter(p => p?.data);
  return (placed) => {
    const set = placed instanceof Set ? placed : new Set(placed ?? []);
    const claimed = new Set();
    const sat = [];
    for (const { data, concentration } of list) {
      const { sections, allocatedSet } = allocateMajorSections(data, set, courseMap);
      const all = [...sections];
      // The concentration is allocated with the major's used set passed in,
      // which is exactly what the graduation panel does — the point here is to
      // match it, not to improve on it.
      //
      // ⚠ Passing that set in does NOT guarantee the concentration avoids the
      // major's courses; `allocateSection` decides blocking against a snapshot,
      // and a concentration naming a course the major's core already claimed
      // will still take it (checked, not assumed). That is the audit's existing
      // behaviour and it is left alone: the catalog calls a concentration "a
      // component of a major", states no double-counting rule for one, and
      // changing it here would move requirement rows on 81 programs to serve a
      // badge that never reads this. Either way the same key lands in
      // `claimed`, which is all `minorShare` asks of us.
      if (concentration) {
        all.push(...allocateSections([concentration], set, allocatedSet, courseMap));
      }
      // A CONSTANT unit, not the per-section modal credit: the two runs being
      // compared must measure the same way, and `typicalSH` needs the raw
      // section, which `mergeDuplicateSections` no longer lines up with.
      for (const s of all) sat.push(satisfiedOf(s, DEFAULT_UNIT_SH, courseMap));
      allocatedSet.forEach(k => claimed.add(k));
    }
    return { sat, claimed };
  };
}

/**
 * How much of a minor is paid for by courses a major already claims.
 *
 * ── Two readings of "shared", and why the verdict uses the smaller ──
 *
 * `sharedSH` is the plain one: the credit of every course this minor's
 * allocation claims that a major's allocation also claims. It is what the
 * expansion lists, and every course in that list genuinely counts toward both.
 *
 * `dependentSH` is what the minor could not have done without them —
 * satisfied credit with the major's courses withheld, subtracted from
 * satisfied credit with everything available. The two differ only when a
 * shared course was REPLACEABLE: the student placed a spare non-major course
 * eligible for the same pool, and allocation, which is greedy in catalog
 * order, happened to reach for the major's one first. That is an artefact of
 * ordering rather than a fact about the plan, so the violation is decided on
 * `dependentSH` and can never fire on a minor the student could satisfy
 * independently with what they have already placed.
 *
 * The gap was measured rather than assumed, because "greedy allocation might
 * pick badly" is exactly the kind of worry that turns out to be theoretical.
 * Over 500 (major, minor) pairs — 20 majors x 25 minors, each against a
 * student who has placed every course EITHER program names, which is the most
 * choice the allocator can ever have and so the worst case for the artefact —
 * the two disagree on 21 pairs (4.2%), 240 SH against 133 SH in total. Rare,
 * but not small when it happens: Film Production minor against Media and
 * Screen Studies and Theatre BA reads 12 SH shared on the plain definition and
 * 4 SH on this one, so the plain reading would have declared a violation of a
 * 10 SH cap that the student's own placed courses already avoid.
 *
 * ── The MAJOR gets the same defence, and it needed it ─────────────
 *
 * The minor-side measure above only asks whether the MINOR could have reached
 * its credit another way. The symmetric question — could the MAJOR have
 * satisfied that requirement with a different course the student already
 * placed? — is just as real, and answering "no" by default is what makes the
 * whole thing lopsided: a course only counts toward both if BOTH audits claim
 * it, and this app chooses both assignments.
 *
 * Releasing a shared course from the major is free, which is the property that
 * makes it legitimate rather than wishful. The major swaps in another placed
 * course for that requirement and the released one becomes a general elective;
 * both were already on the board, so the degree total does not move by a single
 * credit. It is a re-labelling, and NU's own audit would accept either label.
 *
 * So when the naive reading says "over", `majorClaim` is asked whether the
 * major can do without each shared course — accumulating, so what comes back is
 * a set the major can release ALL AT ONCE, not a list of individually harmless
 * removals. The test is per-section and one-directional (`every section at
 * least as satisfied`), not a comparison of totals: removing a course can free
 * one the greedy allocator was hoarding, so a section can gain exactly as
 * another loses, and a total would call that swap harmless when it just broke a
 * requirement.
 *
 * Measured over 6,920 pairs (40 majors x all 173 minors): the cap fires 19
 * times, 5 of those have a releasable shared course, and **1 verdict flips** —
 * Video Arts minor against Media and Screen Studies and Theatre BA, 22 SH
 * against a 20 SH cap, where the major has another way to fill the requirement.
 * One false violation in nineteen is the expensive direction, and the pass
 * costs 0.1 ms per allocation on the largest undergraduate program.
 *
 * The release runs ONLY when the naive verdict is "over", and that is a
 * decision about the panel rather than about speed: the major card on screen
 * shows the greedy allocation, so quietly re-labelling a course the student can
 * see ticked under a major requirement would make the two cards contradict each
 * other. Applied only where it changes the verdict, the story stays coherent —
 * "these courses count toward both, and there is an arrangement that fits".
 *
 * @param {object}      args.minor      minor program record (Major2 JSON shape)
 * @param {Set<string>} args.placedSet  canonical keys of everything placed
 * @param {Set<string>} args.majorKeys  keys claimed by a major's requirement
 *                                      sections (concentration included,
 *                                      general electives excluded)
 * @param {Record<string, object>} args.courseMap
 * @param {null | ((placed: Set<string>) => {sat: number[], claimed: Set<string>})}
 *        args.majorClaim  re-runs the MAJOR's allocation over a hypothetical
 *        placed set, returning per-section satisfied credit and the claimed
 *        keys. Optional: without it the release pass cannot run and the answer
 *        is the stricter one, so a caller that can supply it should.
 * @returns {null | {requiredSH: number, capSH: number, sharedSH: number,
 *                   dependentSH: number, claimedSH: number, uniqueSH: number,
 *                   overSH: number, over: boolean, sharedKeys: string[],
 *                   releasedKeys: string[]}}
 *          null when the minor states no requirement at all — there is no
 *          denominator, so there is no percentage to report.
 */
export function minorShare({ minor, placedSet, majorKeys, courseMap = {},
                             majorClaim = null, outsideKeys = null,
                             substitutions = [], realPlacedSet = null } = {}) {
  const sections = minorRequirementSections(minor);
  if (!sections.length) return null;

  const placed  = placedSet instanceof Set ? placedSet : new Set(placedSet ?? []);
  const major   = majorKeys instanceof Set ? majorKeys : new Set(majorKeys ?? []);
  const outside = outsideKeys instanceof Set ? outsideKeys : new Set(outsideKeys ?? []);

  // Every question below is "did these two audits claim the SAME COURSE", and
  // a substitution is precisely a second name for one course — so it is asked
  // of the real course, never of the key.
  const { originsOf, familyOf } = substitutionOrigins(substitutions, placed, realPlacedSet);
  /** Every real course any of these keys could be paid for by. */
  const originSet = (keys) => new Set([...keys].flatMap(originsOf));
  /**
   * Is this key paid for out of `origins`?
   *
   * EVERY candidate, not any: with two courses offering to pay for one key the
   * student can mean either, and charging on the strength of the charged one
   * invents a violation (see `substitutionOrigins`). Identical to the old test
   * for the single-candidate case, which is every plan measured.
   */
  const paidFrom = (origins) => (k) => originsOf(k).every(o => origins.has(o));

  // One unit per section, computed once: `demandOf` and `satisfiedOf` must be
  // given the SAME unit or their difference stops meaning anything.
  const units = sections.map(s => typicalSH(specForNode(s), courseMap));

  const claimed = new Set();
  const full = allocateSections(sections, placed, claimed, courseMap);
  const requiredSH = sections.reduce((n, _, i) => n + demandOf(full[i], units[i], courseMap), 0);
  const claimedSH  = sections.reduce((n, _, i) => n + satisfiedOf(full[i], units[i], courseMap), 0);
  const capSH = requiredSH * MINOR_SHARE_FRACTION;

  // Courses the minor counts that a MAJOR also counts, and courses it counts
  // that were never Northeastern coursework taken for it. The policy puts both
  // under one 50% ceiling; they are reported apart because "shared with your
  // major" is a different sentence to say to a student than "transferred in".
  const majorOrigins   = originSet(major);
  const outsideOrigins = originSet(outside);
  const fromMajor   = paidFrom(majorOrigins);
  const fromOutside = paidFrom(outsideOrigins);
  const sharedKeys  = [...claimed].filter(fromMajor).sort();
  const outsideOnly = [...claimed].filter(k => fromOutside(k) && !fromMajor(k)).sort();
  const sharedSH  = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);
  const outsideSH = outsideOnly.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);

  /** Credit the minor reaches without the courses in `blocked`. */
  const minorWithout = (blocked) => {
    if (!blocked.size) return claimedSH;
    const pool = new Set([...placed].filter(k => !blocked.has(k)));
    const alone = allocateSections(sections, pool, new Set(), courseMap);
    return sections.reduce((n, _, i) => n + satisfiedOf(alone[i], units[i], courseMap), 0);
  };

  // Nothing charged → nothing to compute, and the two extra allocations below
  // would only rediscover `claimedSH`.
  if (!sharedKeys.length && !outsideOnly.length) {
    return { requiredSH, capSH, sharedSH: 0, outsideSH: 0, dependentSH: 0, claimedSH,
             uniqueSH: claimedSH, overSH: 0, over: false,
             sharedKeys: [], outsideKeys: [], releasedKeys: [] };
  }

  /**
   * Everything the minor may not pay for itself with — as PLACED KEYS, one
   * origin at a time. Withholding a substituted course means withholding the
   * real course AND the virtual key it stands behind: leaving either in the
   * pool lets the minor re-satisfy itself with the very credit being charged.
   */
  const blockedBy = (origins) => new Set([...placed].filter(paidFrom(origins)));

  const chargedOrigins = new Set([...majorOrigins, ...outsideOrigins]);

  let uniqueSH = minorWithout(blockedBy(chargedOrigins));
  let dependentSH = Math.max(0, claimedSH - uniqueSH);
  let releasedKeys = [];

  // Only the MAJOR's courses can be released. Transfer and advanced-standing
  // credit is not a labelling choice — a course taken elsewhere was taken
  // elsewhere, whatever the audit decides to do with it.
  if (dependentSH - capSH > EPS && typeof majorClaim === "function" && sharedKeys.length) {
    // Asked in ORIGIN space: the major registered for the real course, so
    // "can you do without this" has to name that course, and the simulation
    // has to remove its virtual key too or the major keeps it either way.
    releasedKeys = releasableFromMajor(
      [...originSet(sharedKeys)].sort(), placed, majorClaim, courseMap, familyOf);
    if (releasedKeys.length) {
      const released = new Set(releasedKeys);
      const stillCharged = new Set([...chargedOrigins].filter(
        o => outsideOrigins.has(o) || !released.has(o)));
      uniqueSH = minorWithout(blockedBy(stillCharged));
      dependentSH = Math.max(0, claimedSH - uniqueSH);
    }
  }

  const over = dependentSH - capSH > EPS;
  return {
    requiredSH, capSH, sharedSH, outsideSH, dependentSH, claimedSH, uniqueSH,
    overSH: over ? dependentSH - capSH : 0,
    over,
    sharedKeys,
    outsideKeys: outsideOnly,
    releasedKeys,
  };
}

/**
 * Course keys the student did NOT earn as Northeastern coursework for a program.
 *
 * Northeastern's 50% ceiling covers three sources in one sentence — "from their
 * major, transfer credit, or advanced standing credit" — and only the first was
 * ever measured here, so the figure was a lower bound on the policy's own
 * numerator. These are the other two, and both are per-course, which is what
 * makes them attributable to a minor requirement at all:
 *
 *   · a `T` grade is the app's transfer/AP/IB/waiver bucket. It earns hours and
 *     no quality points, and it is deliberately on the grade menu because
 *     without it "these hours transferred" was unsayable (see gradeSystem.js).
 *   · a placed-out course is placement — advanced standing by another name.
 *
 * Not modelled, and now the only gap left: transfer credit the student never
 * enters, because nothing forces them to. The figure is exact for what they
 * told us and a lower bound for what they did not, which is the honest limit of
 * an input the app cannot verify.
 *
 * @returns {Set<string>} canonical course keys
 */
export function outsideCreditKeys({ placements = {}, grades = {}, placedOut = [],
                                    courseMap = {} } = {}) {
  const keys = new Set();
  const add = (id) => {
    const course = courseMap[baseId(id)] ?? courseMap[id];
    if (course?.subject != null && course?.number != null) {
      keys.add(courseKey(course.subject, course.number));
    }
  };
  for (const [pid, grade] of Object.entries(grades ?? {})) {
    if (grade === TRANSFER_GRADE) add(pid);
  }
  for (const id of placedOut ?? []) add(id);
  return keys;
}

/**
 * "Which course actually pays for this key?"
 *
 * ── Why the cap could not see a substitution ─────────────────────
 *
 * `applySubstitutions` puts a VIRTUAL key in the placed set: `{from, to}` means
 * the student took `from`, and `to` is treated as present so requirement checks
 * see it. Every audit then allocates over that set indifferently — which is the
 * point, and which is also how one course comes to be claimed under two
 * different names. A student whose minor requires A, who never took A, and who
 * substituted B (a course their major requires) for it, is double counting B;
 * the minor claims A, the major claims B, and an intersection of KEYS is empty.
 * Measured on that exact plan before this existed: `dependentSH` 0 against a
 * real 4 SH of shared credit, and the row said "0 of 4 SH allowed" — silent, in
 * the direction that permits more overlap than the registrar does.
 *
 * The mirror case is the same fact from the other side (the MAJOR substitutes a
 * course the minor requires), and so is transfer credit: a `T`-graded course
 * substituted for a minor requirement is still transfer credit, and was
 * escaping the same ceiling.
 *
 * ── A real placement is never a stand-in ─────────────────────────
 *
 * The rule is deliberately one-sided: a key is virtual only when the student
 * did NOT place it themselves. If A is on the board for real, it pays for
 * itself no matter what else was substituted for it — mapping it to `from`
 * would charge a course the minor is paying for with its own credit, which is a
 * FALSE violation, the one direction this module refuses to fail in.
 *
 * That is why `realPlacedSet` is required for any mapping to happen at all: the
 * post-substitution set cannot distinguish a virtual key from a real one, so a
 * caller that does not say gets the old, permissive answer rather than a guess.
 * Chains do not arise — `applySubstitutions` reads real placements only, so a
 * virtual key can never itself be a `from` — but the resolver is written to
 * stop at one hop regardless, so a malformed list cannot loop.
 *
 * ── A key can have MORE THAN ONE candidate, and picking one is wrong ──
 *
 * Nothing stops a plan carrying two substitutions with the same target: the
 * editor dedupes `{from, to}` PAIRS, and a shared or hand-edited plan can carry
 * anything. Then one requirement key has two courses offering to pay for it and
 * the student has told us both.
 *
 * The first version of this resolved that with `min(from)` — deterministic, and
 * WRONG in the one direction this module refuses to fail in. Measured on a plan
 * offering BB2000 (which the major claims) and CC3000 (which nothing claims)
 * for the same key: the alphabetical pick took BB2000 in BOTH orderings and
 * declared the minor 8 SH over its cap, when a valid reading of the student's
 * own plan is 4 SH and comfortably inside it. A false violation, invented by a
 * tiebreak. That is the same mistake the "greedy-allocation artefact" tests in
 * this module exist to prevent — a course the student could have paid for
 * another way is not double counting.
 *
 * So candidates are returned as a SET and the charge is marginal, exactly like
 * `dependentSH` above: a key is charged only when EVERY course that could pay
 * for it is already charged. One candidate — every real plan — behaves as
 * before; two agree or the key goes free.
 *
 * ── One resolver, two surfaces ───────────────────────────────────
 *
 * It is exported because the 2x badge needs the same answer: the board draws
 * the badge on the REAL course, and without this it asked whether the minor
 * claimed `BB2000` — which it never does, it claims `AA1000` — so the card the
 * panel had just charged 4 SH for carried no mark at all. `familyOf` is the
 * inverse direction the badge needs: real course → every key that stands for
 * it. Deriving either rule twice is how the panel and the board come to
 * disagree in front of the one person who can see both. `familyOf` takes ANY
 * candidate rather than a sole one, so the board can over-mark a two-candidate
 * key but can never under-mark one the panel charged.
 *
 * @param {{from: string, to: string}[]} substitutions
 * @param {Set<string>} placed      post-substitution keys
 * @param {?Set<string>} realPlaced what the student actually placed
 * @returns {{originsOf: (key: string) => string[],
 *            familyOf: (key: string) => string[]}}
 */
export function substitutionOrigins(substitutions, placed, realPlaced) {
  const placedSet = placed instanceof Set ? placed : new Set(placed ?? []);
  const candidates = new Map();      // virtual key → real courses offering to pay

  if (Array.isArray(substitutions) && substitutions.length && realPlaced) {
    const real = realPlaced instanceof Set ? realPlaced : new Set(realPlaced ?? []);
    for (const sub of substitutions) {
      const from = sub?.from, to = sub?.to;
      if (!from || !to || from === to) continue;
      // The target has to be virtual (not placed for real) and the source has
      // to be something the student really holds. A virtual key can never pay
      // for another, so no chain can form and no cycle can loop.
      if (real.has(to) || !real.has(from) || !placedSet.has(to)) continue;
      if (!candidates.has(to)) candidates.set(to, new Set());
      candidates.get(to).add(from);
    }
  }

  const family = new Map();          // real course → the keys it stands behind
  for (const [key, sources] of candidates) {
    for (const src of sources) {
      if (!family.has(src)) family.set(src, [src]);
      family.get(src).push(key);
    }
  }

  return {
    originsOf: (k) => (candidates.has(k) ? [...candidates.get(k)].sort() : [k]),
    familyOf:  (k) => family.get(k) ?? [k],
  };
}

/**
 * The largest set of shared courses the major can do without ALL AT ONCE.
 *
 * Greedy over an independence system: dropping fewer courses can never satisfy
 * less than dropping more, so "the major survives without this set" is
 * downward-closed and adding one at a time never has to backtrack. It yields a
 * maximal set, not necessarily a maximum one — which errs toward charging more
 * shared credit, the safe direction.
 *
 * Biggest courses first, because the point is to release credit rather than
 * course count, and a 5 SH course the major can spare is worth more to the
 * student than a 1 SH lab.
 */
function releasableFromMajor(sharedKeys, placed, majorClaim, courseMap,
                             familyOf = (k) => [k]) {
  // The callback belongs to a caller — the panel's own allocator, a report's,
  // a test's — and this runs inside the graduation audit. A callback that
  // throws must cost the student a slightly stricter figure, not the panel.
  const ask = (set) => { try { return majorClaim(set); } catch { return null; } };

  const base = ask(placed);
  if (!base || !Array.isArray(base.sat)) return [];
  const order = [...sharedKeys].sort(
    (a, b) => (courseMap[b]?.sh ?? 0) - (courseMap[a]?.sh ?? 0) || a.localeCompare(b));

  const released = [];
  for (const key of order) {
    const without = new Set(placed);
    // A course leaves with every key that stands for it — the real course and
    // any virtual substitution target it satisfies. Removing one of the two
    // asks a question about a plan that cannot exist.
    for (const r of released) for (const k of familyOf(r)) without.delete(k);
    for (const k of familyOf(key)) without.delete(k);
    const next = ask(without);
    // A different number of sections means the two runs are not comparable —
    // decline rather than compare whatever lines up.
    if (!next || !Array.isArray(next.sat) || next.sat.length !== base.sat.length) continue;
    if (next.sat.every((sh, i) => sh >= base.sat[i] - EPS)) released.push(key);
  }
  return released.sort();
}
