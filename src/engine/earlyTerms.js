// ═══════════════════════════════════════════════════════════════════
// EARLY TERMS — the department plans the first two years, CHART plans the rest
//
// The whole rule, in one sentence:
//
//   Semesters 1-4 are the department's published plan, with a course moved only when a
//   prerequisite or its own availability makes that term impossible — and then only to
//   the nearest later term that works. Semesters 5 on are CHART's.
//
// Three steps, in order, and nothing else:
//
//   ADOPT    read the published plan's first four study terms and record, for each of our
//            cells, the term the department put it in. Recorded as INTENT, legal or not.
//   REPAIR   slide a course later until its term is legal. Legality is the cell's DOMAIN
//            plus precedence — neither is re-implemented here.
//   FIX      narrow each surviving cell to that one term, so the ordinary search enforces
//            it and `improve()` cannot quietly move it afterwards.
//
// ── Why adopt rather than hint ──────────────────────────────────────
//
// The department's arrangement used to be a branch ORDER: the search tried its term first
// and was free to pick another. Measured over the whole corpus that left first-term
// agreement at 66.2% of 1,650 courses with 158 courses landing two or more terms late —
// so on a third of the first year, a published, advised, department-authored placement
// lost to an ordering inferred from a course number. A hint cannot be the answer to
// "put the department's plan in", because a hint is exactly the thing the search is
// allowed to ignore.
//
// ── Why four ────────────────────────────────────────────────────────
//
// Because that is where a department stops agreeing with ITSELF. Comparing each program's
// own published variants against each other — the same degree, a different co-op cycle —
// the share placing a course in the same term runs:
//
//     term             1       2       3       4       5
//     variants agree   76.2%   73.2%   50.6%   36.3%    4.2%
//
// Inside the window a published term is a fact about the DEGREE. Past the cliff it is a
// consequence of one co-op cycle and says nothing about a student on another, so the
// level and unlock preferences — 12,848 measured placements — are the better guide and
// keep the job. The number is measured, not chosen; do not tune it without re-measuring.
//
// ── What this may never do ──────────────────────────────────────────
//
// It may never turn a plan into a refusal. `docs/chart-success-criteria.md` §2 is explicit
// that a change reducing the generated count has to pay for itself, and fixing a term is a
// CONSTRAINT — the one kind of change that can. So `generatePlan` retries with the whole
// mechanism off and reports `relaxed: ["department-early-terms"]`. One fallback, not a
// ladder.
//
// It is also why the Sample Plan of Study stays a WITNESS and not a source, exactly as
// CLAUDE.md requires. We never assert our requirements are a subset of the plan, and we
// never take its branch of a choice we were not entitled to decide. We read one thing from
// it — "an advisor put this course in this term" — and then verify the result against
// every rule we would have applied anyway.
// ═══════════════════════════════════════════════════════════════════

/**
 * How many study terms the department plans.
 *
 * Measured, not chosen — see the header's variant-agreement table. Four is where a
 * department's own variants stop agreeing with each other.
 */
export const EARLY_TERMS = 4;

/** A course moved because the catalog does not run it in the department's term. */
export const MOVED_AVAILABILITY = "not-offered-then";
/** A course moved because it sat at or before something it requires. */
export const MOVED_PREREQ = "after-its-prerequisite";
/**
 * A course moved because its term was already at the registration cap.
 *
 * The third reason a published term does not work, and the one this module originally
 * missed. Computer Science and Biology publishes a 20 SH first term against a 19 SH cap:
 * one credit over, and because the fix was all-or-nothing the whole first two years were
 * discarded and the student got nothing of their department's arrangement. A term being
 * one credit too heavy is exactly the kind of flaw this module exists to repair.
 */
export const MOVED_CAPACITY = "term-was-full";

/**
 * The most credit a FIRST semester may carry when its department published it that way.
 *
 * 21, and both the number and the fact that it applies to term 0 alone are measured rather
 * than chosen. Over the 349 published undergraduate plans, counting only committed rows:
 *
 *     term            0       1       2       3       4
 *     over 19 SH     14      0       0       0       0        <- 4.0%, then nothing
 *     heaviest       22 SH  19 SH   12 SH   18 SH   19 SH
 *
 * An overloaded published term is a FIRST-SEMESTER phenomenon and does not occur once
 * anywhere else, so the allowance is scoped to where the evidence is. Of the 14, thirteen
 * are 20 SH and one is 22.
 *
 * All thirteen are Khoury combined majors with the same skeleton — `CS 1800`+`1802`,
 * `CS 2000`+`2001`, `ENGW 1111`, the partner subject's intro pair, and `CS 1200`, a
 * one-credit seminar sitting on top. That is a block schedule an advisor signs off, not a
 * degree nobody can register for, and refusing to reproduce it cost every one of those
 * programs its department's entire first two years.
 *
 * 21 covers thirteen and deliberately leaves the fourteenth. Physics and Music with
 * Concentration in Music Technology publishes 22 SH across NINE courses in one semester;
 * a tool that reproduces that without comment is not being helpful, so it keeps falling
 * back and says so.
 *
 * Scaled by the term's weight, so a half-summer is not handed a full semester's overload.
 */
export const FIRST_TERM_OVERLOAD_MAX = 21;

/** Every entry in a term, including the nested children of an `either`. */
function flatten(entries, out = []) {
  for (const e of entries ?? []) {
    if (!e || typeof e !== "object") continue;
    out.push(e);
    flatten(e.children, out);
  }
  return out;
}

/**
 * Where each of the shape's STUDY terms sits, keyed by year and season.
 *
 * A cell's domain indexes `studyTerms`, which filters work terms out — so counting every
 * term object produces an index that agrees with the domain only up to the first co-op and
 * drifts by one per work term after it. Keyed by year and season rather than counted for
 * the same reason a published plan may leave a summer blank that the shape keeps, and
 * because a BORROWED plan is not this shape's own plan at all: its terms have to be located
 * in this program's calendar, not in the donor's.
 */
function studySlots(shape) {
  const out = new Map();
  let i = 0;
  for (const term of (shape?.terms ?? [])) {
    if (term.work) continue;
    out.set(`${term.yearIndex}|${term.semTypeId}`, i);
    i += 1;
  }
  return out;
}

/**
 * The published plan's early terms, as `{ at, offers }` — a study-term index and every
 * course id that term names.
 *
 * Every option of every row is offered, not just the rows naming one course. A department
 * row reading "CS 2500 or CS 2510" still tells us WHEN that requirement happens, and if our
 * degree requires CS 2500 outright then this is the term it belongs in.
 */
function earlyTermsOf(publishedPlan, shape, through) {
  const slots = studySlots(shape);
  const out = [];
  let yearIndex = -1;
  for (const year of publishedPlan?.years ?? []) {
    yearIndex += 1;
    for (const term of (year?.terms ?? [])) {
      if (!term || typeof term !== "object") continue;
      const entries = flatten(term.entries);
      // A term that is nothing but co-op is a WORK term, and `studyTerms` drops it — so it
      // must not consume an index here either. A co-op term that also carries a class is a
      // study term, which is why this counts course cells rather than testing for co-op.
      const coop = entries.filter(e => e.coop).length;
      const courses = entries.filter(e =>
        !e.coop && !e.vacation && !e.heading && !e.either).length;
      if (coop > 0 && courses === 0) continue;

      const at = slots.get(`${yearIndex}|${term.type ?? ""}`);
      // A term this student's shape does not have — a different co-op cycle, or a plan of a
      // different length. Nothing to inherit, and guessing a neighbouring term would be
      // inventing the department's opinion rather than reading it.
      if (at == null) continue;
      if (at >= through) continue;

      const offers = new Set();
      for (const e of entries) {
        if (e.coop || e.vacation || e.heading) continue;
        for (const group of (e.options ?? [])) for (const id of group) offers.add(id);
      }
      if (offers.size) out.push({ at, offers });
    }
  }
  // Ascending, so an earlier term claims a course a later one repeats — the earlier
  // placement is the one the prerequisite chain was built around.
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The one option group of a cell that this term can answer in full.
 *
 * `named` and `choice` cells both qualify, and a choice cell is the reason this returns a
 * GROUP rather than a boolean: fixing a "pick one of" row fixes WHEN the requirement is
 * met without deciding WHICH course meets it. That is sound because nothing downstream
 * relaxes — handed a term, the search still has to answer the cell with an option that is
 * legal there, or fail. Restricting this to `named` cells only covers 42.5% of the courses
 * a department publishes early, against 61.8% this way.
 *
 * An `open` cell — a general elective — is never matched. It is the search's slack, and
 * holding it still is what turns a heavy published term into a refusal.
 */
function answerableGroup(cell, offers) {
  if (cell?.kind !== "named" && cell?.kind !== "choice") return null;
  for (const group of (cell.groups ?? [])) {
    if (group.length > 0 && group.every(id => offers.has(id))) return group;
  }
  return null;
}

/**
 * Make an intended arrangement legal by moving courses LATER, never by dropping them.
 *
 * Dropping reads conservative and is not. A dropped cell goes back to the general search,
 * whose measured bias on exactly these courses is late — so a first-year course the
 * department placed in a term the catalog does not run would be "safely" relocated to the
 * fourth year. Sliding it to the next term that works keeps the thing the student actually
 * needs, which is an early course early.
 *
 * Two ways a published placement can harm a student, and both are repaired the same way:
 *
 *   AVAILABILITY  the course does not run then. The cell's DOMAIN already encodes this,
 *                 along with co-op preparation having to precede the first work term and
 *                 the critical-path bounds — so "is it in the domain" is the whole
 *                 legality test and none of it is re-implemented here.
 *   ORDER         the course sits at or before something it requires. Departments do
 *                 publish these.
 *
 * Iterated to a fixpoint because moving one course pushes its successors: three courses a
 * department stacked in one term, each requiring the last, come out in three consecutive
 * terms. Monotone — a term only ever moves later — so it converges and cannot cycle.
 */
function repair(intended, plans, precedence, capOf) {
  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const domainOf = new Map(plans.map(p => [p.cell.id, [...p.domain].sort((a, b) => a - b)]));
  const shOf = (id) => byId.get(id)?.cell?.sh ?? 0;
  const placed = new Map(intended);
  const unplaced = [];
  // Why each moved course moved, for the student to read. Overwritten rather than
  // accumulated across passes: the last pass is the one that decided the final term.
  const reasons = new Map();

  // ── Ordering: intended term, then HEAVIEST first, then id ──────────
  //
  // The tie-break is load-bearing rather than cosmetic. When a published term is over the
  // cap something has to leave it, and taking the courses in descending credit means the
  // 4 SH courses keep the term their department chose and the 1 SH seminar is what moves.
  // Ascending would evict `CS 2000` to rescue `CS 1200`, which is the same repair and a
  // much worse plan. Id breaks the remaining ties so two runs repair identically —
  // determinism is a hard requirement here and has been lost to incidental ordering before.
  const order = [...intended.keys()].sort((a, b) =>
    (intended.get(a) - intended.get(b))
    || (shOf(b) - shOf(a))
    || (a < b ? -1 : a > b ? 1 : 0));

  // The last pass's load, which is the arrangement actually returned. Declared out here so
  // the caller can read it: a term the department overloads has to have the SEARCH's ceiling
  // raised to match, and raising it to a blanket maximum instead of to what was really fixed
  // would licence the search to add a course of its own on top.
  let load = new Map();
  for (let pass = 0; pass < 8; pass += 1) {
    // Rebuilt every pass rather than patched, because a cell that moves frees the credit it
    // was holding. A stale load would keep charging a term for a course that left it.
    load = new Map();
    let moved = false;
    for (const id of order) {
      if (!placed.has(id)) continue;
      let floor = intended.get(id);
      let because = null;
      for (const before of (precedence?.before?.get(id) ?? [])) {
        const bt = placed.get(before);
        // Not placed here: the search will order it, and precedence is already folded into
        // both domains, so nothing is lost by leaving it alone.
        if (bt == null) continue;
        const together = precedence.concurrentOk?.has(`${before}|${id}`) ?? false;
        const need = together ? bt : bt + 1;
        if (need > floor) { floor = need; because = MOVED_PREREQ; }
      }
      const sh = shOf(id);
      const fits = (t) => {
        const cap = capOf ? capOf(t) : Infinity;
        return (load.get(t) ?? 0) + sh <= cap + 0.01;
      };
      const legal = (domainOf.get(id) ?? []).filter(t => t >= floor);
      // Room first. A term that is legal but already at its registration cap is a term the
      // student cannot actually add this course to, so it is no more usable than one the
      // course is not offered in.
      let at = legal.find(fits);
      if (at != null && at !== intended.get(id) && because == null) {
        // Distinguishes "the catalog does not run it then" from "the department's own term
        // was full", which are different sentences to a reader and different bugs to us.
        because = legal[0] === at ? MOVED_AVAILABILITY : MOVED_CAPACITY;
      }
      if (at == null) {
        // Nothing this side of the plan's end has both legality and room. Hand it back to
        // the search, which sees the whole arrangement and is the right thing to resolve a
        // capacity problem — this module only ever knows about the cells it fixed.
        unplaced.push({ cell: id, from: intended.get(id) });
        placed.delete(id);
        moved = true;
        continue;
      }
      load.set(at, (load.get(at) ?? 0) + sh);
      if (at !== placed.get(id)) { placed.set(id, at); moved = true; }
      // Attributed to precedence only where precedence actually raised the floor; otherwise
      // it is whichever of availability or capacity `because` recorded above.
      if (at !== intended.get(id)) reasons.set(id, because ?? MOVED_AVAILABILITY);
      else reasons.delete(id);
    }
    if (!moved) break;
  }
  return { placed, unplaced, reasons, load };
}

/**
 * Read a published plan's first `through` study terms onto this shape's cells.
 *
 * @param {object}   args
 * @param {object}   args.publishedPlan  one entry of plan.json `plans[]` — the co-op cycle
 *                                       the student chose — or a stand-in borrowed from a
 *                                       structurally similar program.
 * @param {object}   args.shape          the shape being solved.
 * @param {Array<{cell: object, domain: number[]}>} args.plans
 * @param {object}   args.precedence     from `buildPrecedence`.
 * @param {number}   [args.through]      how many study terms to take.
 * @returns {{placed: Map<string, number>, moves: object[], unplaced: object[]}}
 */
export function adoptEarlyTerms({
  publishedPlan, shape, plans, precedence, through = EARLY_TERMS, capOf = null,
  firstTermOverload = 0,
} = {}) {
  const empty = { placed: new Map(), moves: [], unplaced: [] };
  if (!publishedPlan || !plans?.length) return empty;

  const intended = new Map();
  for (const { at, offers } of earlyTermsOf(publishedPlan, shape, through)) {
    // A course answers ONE cell, so a matched group is spent. Two cells can list the same
    // course — a choice cell offering CS 2500 beside a named cell requiring it — and
    // matching both would fix two requirements to one course the student takes once,
    // filling the term with something that is not there twice.
    //
    // Named cells go first, so a course that exactly answers one requirement is not
    // consumed by a looser choice cell that had alternatives available.
    const available = new Set(offers);
    for (const kind of ["named", "choice"]) {
      for (const p of plans) {
        if (intended.has(p.cell.id) || p.cell?.kind !== kind) continue;
        const group = answerableGroup(p.cell, available);
        if (!group) continue;
        intended.set(p.cell.id, at);
        for (const id of group) available.delete(id);
      }
    }
  }
  if (!intended.size) return empty;

  // ── The first semester's allowance is the DEPARTMENT'S own load ────
  //
  // Bounded by what this department published for term 0, not by a flat ceiling. A flat 21
  // is a licence rather than an allowance: it lets repair pack a first semester to 21 SH for
  // a program whose department published 18, which is us inventing an overload and signing
  // the department's name to it. `business_administration_bsba_(oakland)` did exactly that
  // and the roundtrip invariant caught it.
  //
  // So: raise term 0 to what the department asked for, and no further — capped by
  // `firstTermOverload` so a 22 SH nine-course term is still refused.
  const byIdSH = new Map(plans.map(p => [p.cell.id, p.cell?.sh ?? 0]));
  let wanted0 = 0;
  for (const [id, ti] of intended) if (ti === 0) wanted0 += byIdSH.get(id) ?? 0;
  const base0 = capOf ? capOf(0) : Infinity;
  const cap0 = Math.max(base0, Math.min(wanted0, firstTermOverload));
  const effectiveCap = capOf ? ((t) => (t === 0 ? cap0 : capOf(t))) : null;

  const { placed, unplaced, reasons, load } =
    repair(intended, plans, precedence, effectiveCap);
  const moves = [];
  for (const [id, at] of placed) {
    const from = intended.get(id);
    if (at !== from) moves.push({ cell: id, from, to: at, why: reasons.get(id) ?? null });
  }
  moves.sort((a, b) => a.from - b.from || (a.cell < b.cell ? -1 : 1));
  return { placed, moves, unplaced, load };
}

/**
 * Fix each placed cell to its one term.
 *
 * Mutates `plans` in place, exactly as the critical-path narrowing above it already does.
 * A fixed cell is a UNIT DOMAIN rather than a recorded placement, and that distinction is
 * the whole safety argument: the ordinary search enforces it, every rule the search applies
 * still applies, and `improve()` cannot move the cell afterwards because the alternatives it
 * ranks come from the domain.
 *
 * `repair` only ever returns a term drawn from the cell's own domain, so the guard here is
 * belt-and-braces against a caller that skipped it.
 */
export function applyEarlyTerms(plans, placed, exclusionReason = null) {
  if (!placed?.size) return 0;
  let n = 0;
  for (const p of plans) {
    const at = placed.get(p.cell.id);
    if (at == null || !p.domain.includes(at)) continue;
    // Recorded BEFORE the narrowing, and only for terms actually lost, so the derivation
    // view can say why a card has one legal term left. Without this the tree draws a
    // single-term card with no explanation, which reads as a defect in the one view whose
    // entire purpose is showing the process.
    if (exclusionReason && p.excluded) {
      for (const t of p.domain) if (t !== at) p.excluded.push({ term: t, reason: exclusionReason });
    }
    p.domain = [at];
    n += 1;
  }
  return n;
}
