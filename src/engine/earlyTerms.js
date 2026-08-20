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
 * The MINIMUM headroom a first semester gets over the registration cap — a floor, never a
 * ceiling. Two credit hours, and relative to the cap rather than an absolute figure.
 *
 * ── The department sets the number, not us ─────────────────────────
 *
 * A first semester may carry whatever its department published there. If a program prints a
 * 22 SH first term, that is a block schedule its own faculty signed off and told students to
 * register for; a planner that refuses to reproduce it is not protecting anyone, it is
 * disagreeing with the registrar's own advice while showing the student a worse plan.
 *
 * So the allowance is `max(cap + this, what the plan asks for)`. The published load always
 * fits, and this constant only matters where there is no published number to defer to — or
 * where our own decomposition of their term costs a credit or two more than their printed
 * row, which happens when a corequisite partner is merged into a cell.
 *
 * ── Why the floor is 2 ─────────────────────────────────────────────
 *
 * Measured over the published corpus, counting committed rows:
 *
 *     UNDERGRADUATE (cap 19, 349 first terms)      GRADUATE (cap 16, 36 first terms)
 *       over cap    14  (4.0%)                       over cap     1  (2.8%)
 *       max excess   3 SH                            max excess   2 SH  — PharmD at 18
 *
 * Thirteen of the fourteen undergraduate cases are 20 SH — Khoury combined majors with the
 * same skeleton, `CS 1800`+`1802`, `CS 2000`+`2001`, `ENGW 1111`, the partner subject's
 * intro pair, and `CS 1200`, a one-credit seminar on top. +2 covers every one of those and
 * the single graduate case without consulting the plan at all.
 *
 * RELATIVE because the cap is not one number: undergraduates are capped at 19 and graduate
 * students at 16. An absolute 21 — the first version of this — silently handed graduate
 * students a five-credit overload, and `verify-chart` caught it on an 18 SH first term
 * inside a 16 SH envelope.
 *
 * ── And by TERM, which is why this is scoped to the first ──────────
 *
 *     term            0       1       2       3       4
 *     over cap       14      0       0       0       0
 *
 * An overloaded published term is a first-semester phenomenon that does not occur once
 * anywhere else, so the allowance is scoped to where the evidence is. Every later term is
 * held to the cap exactly.
 *
 * ── What still bounds an absurd term ───────────────────────────────
 *
 * Credits are not the only limit. `termSlotCap` bounds how many COURSES a term may hold,
 * measured from the worst any published plan does, and availability and prerequisites are
 * unchanged. A first semester is therefore free in credits and still not free in general.
 *
 * Scaled by the term's weight at the call site, so a half-summer is not handed a full
 * semester's headroom.
 */
export const FIRST_TERM_OVERLOAD_SH = 2;

/**
 * How far past a department's PRINTED load for a term we may still adopt into it.
 *
 * Not an overload allowance — that is `FIRST_TERM_OVERLOAD_SH` and it is about the
 * registrar. This is about the unit mismatch between their rows and our cells: a corequisite
 * the catalog prints as one row can decompose into two cells here, so an exact equality test
 * would reject a term that is a faithful copy of theirs.
 *
 * Two credits, the same size as the overload allowance and for the same measured reason —
 * it is one merged partner, not a policy. Deliberately small: this is the number that stops
 * "the department published a light term" from being read as "the term is free space".
 */
export const ADOPT_SH_SLACK = 2;

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
      // ── What the department PRINTED for this term ─────────────────────
      //
      // Summed off the rows themselves, so a "Take two:" header carrying 8 SH over three
      // 0 SH children contributes 8 and not 12. That is the whole point: the flat `offers`
      // set below cannot express "two of these three", and this number can.
      let sh = 0;
      // Courses named by a row that offers NO alternative. The department stated these
      // outright; everything else in `offers` came from a row that stated a choice. Once a
      // term's budget binds, that difference is what decides which cells keep their slot —
      // see the adoption loop.
      const solo = new Set();
      for (const e of entries) {
        if (e.coop || e.vacation || e.heading) continue;
        sh += e.sh ?? 0;
        for (const group of (e.options ?? [])) for (const id of group) offers.add(id);
        if (e.options?.length === 1 && e.options[0].length === 1) solo.add(e.options[0][0]);
      }
      if (offers.size) out.push({ at, offers, sh, solo });
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
/**
 * The one course a POOL cell can be answered by in this published term.
 *
 * Restricted to `solo` — courses the department named with no alternative. A pool cell is
 * generic by nature, so letting it absorb one branch of a published choice would decide for
 * the student something their department left open, and would pick by whichever option was
 * written first. An outright statement carries no such ambiguity.
 *
 * Sorted, because `available` is a Set in insertion order and which course a pool claims must
 * be a property of the input rather than of iteration order — the same determinism argument
 * `byIdOrder` exists for one level up.
 */
function poolGroup(cell, offers, poolAnswerable, solo) {
  if (cell?.kind !== "open" || !poolAnswerable) return null;
  // An UNBOUNDED cell is the search's slack and stays untouched; `poolAnswerable` is what
  // knows the difference, and it answers false for a cell with no candidate set.
  for (const id of [...offers].sort()) {
    if (!solo?.has(id)) continue;
    if (poolAnswerable(cell, id)) return [id];
  }
  return null;
}

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
function repair({ intended, plans, precedence, capOf, through = EARLY_TERMS }) {
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
      // ── Repair may not leave the WINDOW ───────────────────────────
      //
      // Bounded above as well as below, and the upper bound is the whole point of the rule.
      // Sliding is unbounded on its own — a course adopted in semester 2 that cannot legally
      // sit there would slide to semester 6 and be FIXED there, which is us pinning a cell in
      // the half of the plan we said belongs to CHART. Measured before this bound existed:
      // 40 courses across the corpus, 37 in semester 5 and 3 in semester 6.
      //
      // Past the window we have strictly less information than the search does — we know
      // only about the cells we adopted, it knows the whole arrangement — so the honest move
      // is to hand the course back rather than to guess with less.
      const legal = (domainOf.get(id) ?? []).filter(t => t >= floor && t < through);
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
        // No term inside the window has both legality and room. Hand it back to the search,
        // which sees the whole arrangement and is the right thing to resolve both a capacity
        // problem and a course that belongs past the window — this module only ever knows
        // about the cells it fixed.
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

  // ── The precedence guarantee, enforced rather than hoped for ────────
  //
  // The loop above is capped at 8 passes because a cycle would never converge, and a capped
  // fixpoint can return before it has settled: a cell placed early in a pass against a
  // predecessor that then moves LATER in the same pass is stale, and if the cap lands there
  // the pair ships violating the order. Found by fuzzing at 60,000 instances —
  // `cell-6@3 must precede cell-4@2`.
  //
  // Not harmless. Both cells are unit domains by the time the search sees them, so a
  // violating pair is unsatisfiable and costs the student the whole plan through the
  // fallback. So the result is CHECKED, and any successor still out of order is handed back
  // to the search — the same conservative move as a course with nowhere legal to go.
  //
  // The successor is dropped, never the predecessor: the predecessor is sitting in the term
  // its department chose, and the whole point of this module is to keep that.
  //
  // Bounded by the cell count because each sweep removes exactly one, so it terminates even
  // on precedence that is genuinely cyclic.
  const outOfOrder = (id) => {
    const at = placed.get(id);
    for (const before of (precedence?.before?.get(id) ?? [])) {
      const bt = placed.get(before);
      if (bt == null) continue;
      const together = precedence.concurrentOk?.has(`${before}|${id}`) ?? false;
      if (together ? at < bt : at <= bt) return true;
    }
    return false;
  };
  for (let sweep = 0; sweep <= order.length; sweep += 1) {
    const bad = order.find(id => placed.has(id) && outOfOrder(id));
    if (bad == null) break;
    unplaced.push({ cell: bad, from: intended.get(bad) });
    placed.delete(bad);
    reasons.delete(bad);
  }

  // Rebuilt from what SURVIVED, because the caller raises the search's first-term ceiling to
  // this figure. A load still charging the term for a course the sweep just removed would
  // licence the search to add one of its own in the gap.
  load = new Map();
  for (const [id, at] of placed) load.set(at, (load.get(at) ?? 0) + shOf(id));

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
  // The MINIMUM headroom term 0 gets over `capOf(0)` — a floor, not a ceiling. The published
  // load always fits regardless; see where `cap0` is computed.
  firstTermHeadroom = 0,
  // ── Can this POOL cell be answered by this course? ─────────────────
  //
  // Supplied by the caller because it needs the catalog to answer, and this function is
  // deliberately pure. Omitted, nothing changes: pool cells are simply not adopted, which is
  // the behaviour that predates it.
  //
  // The distinction it draws is between a BOUNDED open cell — a subject elective, a breadth
  // pool, a concentration union, all carrying a real candidate set — and an UNBOUNDED one,
  // the general-elective bucket that admits anything. The comment on `answerableGroup` says
  // an open cell is "the search's slack", and that is true of the unbounded kind only. A
  // pool cell is a requirement with a candidate list, and when the department's own plan puts
  // one of those candidates in a term, that is where the requirement happens.
  //
  // Measured: of the courses a department names outright in its first four terms, 33.9%
  // reached no plan at all, and the bulk were pool members — CHEM 1151, PHYS 1151/1152/1153
  // and PHTH 1260 each in 55 or more programs, sitting in science-elective pools that
  // adoption refused to touch.
  poolAnswerable = null,
} = {}) {
  // `load` included so every return of this function has one shape. A caller that reads
  // `early.load` on the empty result should get an empty map, not `undefined` guarded by an
  // optional chain at each call site.
  const empty = () => ({
    placed: new Map(), moves: [], unplaced: [], load: new Map(),
    firstTermCap: capOf ? capOf(0) : Infinity,
    publishedLoad: new Map(),
  });
  if (!publishedPlan || !plans?.length) return empty();

  // ── Scanned in a STABLE order, not the order they arrived ──────────
  //
  // Two cells can be answerable by the same course — a duplicated requirement, or a named
  // cell beside a choice cell that lists it — and only one may claim it. Which one used to
  // depend on the position of `plans`, so a change to how `buildDomains` orders cells would
  // silently re-plan the first two years of every affected degree. Measured: reversing the
  // array handed the course to a different cell.
  //
  // Sorting by id makes the answer a property of the INPUT rather than of an array's shape.
  // Determinism is a hard requirement in this engine and has twice been lost to exactly this.
  const byIdOrder = [...plans].sort((a, b) => {
    const x = String(a.cell?.id ?? ""), y = String(b.cell?.id ?? "");
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const intended = new Map();
  // ── A course is spent ACROSS the window, not just within a term ─────
  //
  // Spending it per term was not enough. A department that lists one course in two of its
  // early terms — its own duplicate row, which the corpus does contain — let two different
  // cells each be fixed on it, so the plan asked for one registration to satisfy two
  // requirements. Found by fuzzing: `C4 answers both cell-3 and cell-8`.
  //
  // Whichever cell claims it first keeps it, and the terms are read in ascending order, so
  // the claim lands in the EARLIER of the two published terms — the same "earliest wins"
  // rule a repeated course already followed for a single cell.
  //
  // Slightly conservative for a genuinely repeatable course that two cells could both take:
  // the second cell is simply not adopted and goes to the search, which knows about
  // repeatability and can place it. Under-claiming costs a hint; over-claiming costs the
  // student a term holding something that is not there twice.
  const spent = new Set();
  // What the department printed for each early term, by study-term index. Returned to the
  // caller, which turns it into the term's ceiling — see `publishedLoad` on the result.
  const printed = new Map();
  for (const { at, offers, sh, solo } of earlyTermsOf(publishedPlan, shape, through)) {
    printed.set(at, (printed.get(at) ?? 0) + sh);
    // Named cells go first, so a course that exactly answers one requirement is not
    // consumed by a looser choice cell that had alternatives available.
    const available = new Set([...offers].filter(id => !spent.has(id)));
    // ── Adopt no MORE credit than the department printed here ──────────
    //
    // `offers` is flat: a row reading "take two of these three" and a row reading "one of
    // these three" both arrive as three courses with no count attached, so a degree that
    // separately requires several of them had every one of them pinned into this term.
    // Business Administration's first term is published at 17 SH and was adopted at 20 —
    // all three of a "Take two", plus both halves of a pick-one.
    //
    // The budget is the printed load plus `ADOPT_SH_SLACK`, because our cells are not the
    // department's rows: a corequisite the catalog prints inside one row can decompose into
    // two cells here and cost a credit or two more without anything being wrong.
    //
    // A cell that does not fit is simply not adopted. It is not dropped — it goes to the
    // ordinary search with a full domain, which is strictly more freedom than being pinned
    // to the wrong term. Under-adopting costs a hint; over-adopting costs the student a
    // term they cannot register for.
    const budget = sh > 0 ? sh + ADOPT_SH_SLACK : Infinity;
    let taken = 0;
    // ── An outright statement outranks one branch of a choice ──────────
    //
    // Two passes over each kind: cells answerable by a course the department named with NO
    // alternative, then the rest. It only matters once the budget binds, and then it decides
    // the term's whole composition — which was previously settled by cell-id order, i.e. by
    // nothing. Business Administration prints `BUSN 1101` outright and offers a "take two of
    // three"; adopting in id order spent the budget on all three of the choice and dropped
    // the course the department stated flatly, for the same 17 SH total.
    //
    // `solo` is per TERM, so a course stated outright in term 1 and offered as an
    // alternative in term 2 is treated correctly in each.
    const rank = (p) => ((p.cell.groups ?? []).some(g => g.every(id => solo?.has(id))) ? 0 : 1);
    // Pool cells go LAST, after every named and choice cell has had its pick, so a specific
    // requirement never loses its course to a generic pool that merely happens to contain it.
    for (const kind of ["named", "choice", "open"]) {
     for (const tier of [0, 1]) {
      for (const p of byIdOrder) {
        if (intended.has(p.cell.id) || p.cell?.kind !== kind) continue;
        if (rank(p) !== tier) continue;
        const group = kind === "open"
          ? poolGroup(p.cell, available, poolAnswerable, solo)
          : answerableGroup(p.cell, available);
        if (!group) continue;
        // Measured in the cell's own credits, the same unit the budget is in. A 0 SH cell
        // never exhausts the budget and is always adopted, which is right: it is a
        // requirement the department placed here and it costs the term nothing.
        const cost = p.cell?.sh ?? 0;
        if (taken + cost > budget + 0.01) continue;
        taken += cost;
        intended.set(p.cell.id, at);
        for (const id of group) { available.delete(id); spent.add(id); }
      }
     }
    }
  }
  if (!intended.size) return empty();

  // ── The first semester's allowance is the DEPARTMENT'S own load ────
  //
  // `max(cap + headroom, what this plan asks for)`. Two rules in one line:
  //
  //   The published load ALWAYS fits. A department printing a 22 SH first term has told its
  //   students to register for it, and refusing to reproduce that is disagreeing with the
  //   faculty while showing the student a worse plan. `wanted0` is their term measured in
  //   our cells, so it is their number and not one we chose.
  //
  //   And never LESS than a small headroom, which is what covers a term our decomposition
  //   costs a credit or two more than their printed row — a merged corequisite partner, say.
  //
  // Note this can only ever RAISE term 0 to hold what was already published there. It is not
  // a licence to pack the term: repair never moves a course earlier, so nothing arrives in
  // term 0 that the department did not put there. What it does NOT do is stop the SEARCH
  // filling a light term afterwards — that is `publishedLoad` below, and the two are
  // different jobs: this one is a floor under repair, that one is a ceiling over the search.
  const byIdSH = new Map(plans.map(p => [p.cell.id, p.cell?.sh ?? 0]));
  let wanted0 = 0;
  for (const [id, ti] of intended) if (ti === 0) wanted0 += byIdSH.get(id) ?? 0;
  const base0 = capOf ? capOf(0) : Infinity;
  const cap0 = Number.isFinite(base0)
    ? Math.max(base0 + firstTermHeadroom, wanted0)
    : base0;
  const effectiveCap = capOf ? ((t) => (t === 0 ? cap0 : capOf(t))) : null;

  const { placed, unplaced, reasons, load } =
    repair({ intended, plans, precedence, capOf: effectiveCap, through });
  const moves = [];
  for (const [id, at] of placed) {
    const from = intended.get(id);
    if (at !== from) moves.push({ cell: id, from, to: at, why: reasons.get(id) ?? null });
  }
  moves.sort((a, b) => a.from - b.from || (a.cell < b.cell ? -1 : 1));
  // ── The ceiling each early term should carry ───────────────────────
  //
  // Adoption alone cannot hold a term to its published size. It only decides which cells are
  // PINNED there; the search runs afterwards against `termCapacity`, and a department that
  // published a light first year leaves room the search will spend on general electives.
  // Measured: 160 of 202 over-weight early terms had no over-adopted choice in them at all —
  // they were simply filled to the registration cap. `game_design_bfa` prints 15 SH and
  // shipped 19, which is the undergraduate cap exactly.
  //
  // So the printed load is handed back as a ceiling per term, floored by what repair actually
  // placed there. The floor matters: repair may legitimately push a course INTO a later early
  // term to fix a prerequisite, and a ceiling below the load we just fixed would make the
  // search refuse an arrangement we chose ourselves.
  //
  // Advisory, not enforced here. The caller decides whether to apply it, and `generatePlan`
  // already retries with `followDepartment: false` when the department's own shape cannot be
  // satisfied — so the worst case of a ceiling that is too tight is today's behaviour, not a
  // lost plan.
  const publishedLoad = new Map();
  for (const [at, sh] of printed) {
    if (!(sh > 0)) continue;
    publishedLoad.set(at, Math.max(sh + ADOPT_SH_SLACK, load.get(at) ?? 0));
  }
  // `firstTermCap` is the allowance actually used for term 0. Returned rather than left for
  // a caller to re-derive: it is the number the search's ceiling and every cap assertion have
  // to agree with, and two derivations of one figure is one of them being wrong later.
  return { placed, moves, unplaced, load, firstTermCap: cap0, publishedLoad };
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
