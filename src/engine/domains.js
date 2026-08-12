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
import { groupDepth, courseLevel } from "./prereqDepth.js";

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
/**
 * How many cells of ONE REQUIREMENT one term may hold.
 *
 * ── This started as a rule about general electives and should not have been ──
 *
 * It was `GENERAL_PER_TERM`, counting only cells whose target is `~general`, because
 * that is the complaint that arrived first: four free electives stacked in year 4.
 * Generalising it was not tidying. Keyed to one requirement it left the same defect
 * standing everywhere else, and the measurement is unambiguous:
 *
 *   cells of one requirement in a term   published   CHART
 *     3                                       0.6%    7.8%
 *     4                                       0.1%    6.5%
 *
 * 82 of 99 paired programs stacked harder than the department's own plan — three
 * `Mathematics Elective` cells in one term, three `Khoury Elective` in another. The
 * departments essentially never exceed two of anything, and `~general` is not special
 * to them; it is one requirement among many that they spread.
 *
 * Two, not one. One would be tidier and is not what the corpus says: 16.3% of real
 * terms carry two of a requirement, and forcing one per term would need more terms
 * than some plans have.
 *
 * ── Why the first measurement said there was no problem ─────────────
 *
 * Counting COURSES of one subject per term said CHART (mean 1.09) was already better
 * than the departments (1.17). That metric is blind: 38–44% of published terms hold no
 * named course at all, so it cannot see a term made of three identical placeholders.
 * A metric that cannot observe the defect will report its absence.
 */
export const SAME_REQ_PER_TERM = 2;

/**
 * And the HARD bound, which is a different number.
 *
 * `SAME_REQ_PER_TERM` is the target the search orders by; this is the point past which
 * a term is worse than anything the corpus contains — published plans reach 4 at the
 * extreme for both general electives (p90 4, max 6) and same-requirement stacks
 * (max 4, one term in 988).
 *
 * Two numbers because one was not enough: a HARD cap of 2 refused a third of the
 * programs it had been planning, since a degree with nine free electives and eight
 * study terms genuinely cannot hold two per term. A preference spreads them without
 * making a taste into an infeasibility — the same lesson as the standing floor.
 */
export const SAME_REQ_PER_TERM_MAX = 4;

/**
 * How much of an elective pool must be open before a term is a good place for it.
 *
 * The p10 of what departments do (mean 0.92, median 1.00, p10 0.69) rather than the
 * median, and the difference is the whole point. At the median — wait until the pool is
 * entirely open — a Khoury Elective cannot be placed until after the last prerequisite
 * in the pool is done, which is the behaviour that puts every major elective in the
 * final year. At the p10 a pool can go early as soon as MOST of it is genuinely
 * available, which is what "major electives early" requires in order to mean anything.
 *
 * A share bar and not a level floor. For a POOL, course level is an artifact of how its
 * candidates happen to be numbered — a `Khoury Elective` of 4000-level courses got a
 * level target of 0.91, the last term, from numbering alone. The share is a fact about
 * whether the student can actually take it.
 *
 * A PREFERENCE, ranked and never filtered: a pool whose share never reaches this in any
 * term still gets placed. The standing floor and the hard elective cap both cost
 * coverage when a taste was expressed as a constraint.
 */
export const POOL_REACH_MIN = 0.69;

/**
 * How many courses of at least 3 SH a full fall or spring term should carry.
 *
 * The corpus's own number rather than one chosen for tidiness. MEASURED over 3,941
 * published full fall/spring terms: 54.8% hold exactly four, 97.7% hold four cells or
 * more, and 95.8% hold four or more of at least 3 SH. Credits per full term are p10 16,
 * median 17, p90 18 — consistent with four courses of four.
 *
 * It is how a degree is BUILT, not a tendency: the credit total is designed so that four
 * courses a term across the full terms arrives at the degree. CHART broke it in 13.0% of
 * full terms against their 2.3%, always the same way — a course parked in a half-summer
 * while a fall ran three deep.
 *
 * Enforced as a threshold with a repair rather than as a hard constraint, because the
 * 4.2% of published exceptions are real: architecture and art, where a single studio
 * course IS 16 credits and there is no fourth course to add. Refusing a degree over a
 * rule its own department does not follow is the failure this codebase keeps paying for.
 */
export const FULL_TERM_MIN_COURSES = 4;

/**
 * The four-course bar is an UNDERGRADUATE convention. Graduate plans have none.
 *
 * MEASURED separately, and the two corpora are not comparable:
 *
 *                        undergrad          graduate
 *   median courses >=3 SH        4                 2
 *   share with >= 4          95.8%             16.4%
 *   terms carrying ZERO    26 / 3941        129 / 329
 *   median credits              17                 8
 *
 * 3,941 undergraduate full terms cluster hard on exactly four; 329 graduate ones do not
 * cluster at all — 39% carry zero or one course, which is what a thesis or dissertation term
 * looks like, and a master's 16 SH cap makes four 4 SH courses the ENTIRE envelope rather
 * than a comfortable load.
 *
 * So applying it to a master's was simply wrong, and it showed: the hard-rule gate reported
 * 20% of full terms "thin" until graduate programs were separated out, and every worst case
 * it named was one — `biotechnology_ms`, `urban_studies_graduate_certificate`. The engine was
 * enforcing an undergraduate habit on degrees that do not have it, which both forces a
 * maximal load and makes CHART report a defect where the departments agree with it.
 *
 * Zero, not two. Two would cover 54.4% of graduate terms, which is not a convention; it is a
 * coin flip with extra steps. Where the corpus has no rule, CHART should not invent one.
 */
export const fullTermMinCourses = (studentType) =>
  (studentType === "graduate" ? 0 : FULL_TERM_MIN_COURSES);

/**
 * The credit floor at which a cell counts as one of the four.
 *
 * A one-credit lab and a course are not two courses, and the corpus bar is explicitly
 * four of >= 3 SH — which is 95.8%, against 97.7% for four cells of any size. The
 * difference between those two numbers is exactly the terms padded with small labs.
 */
export const REAL_COURSE_SH = 3;

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
/**
 * The level at and above which a course is graduate-only.
 *
 * 6000 and up, not 5000. 5000-level courses are genuinely open to undergraduates at
 * Northeastern — combined BS/MS programs are built on it — so cutting there would remove
 * courses the degree legitimately expects. 6000 and above is doctoral: seminars,
 * candidacy, dissertation credit, and no undergraduate can register for any of it.
 */
export const GRADUATE_ONLY_LEVEL = 6;

/**
 * Drop courses this student cannot register for.
 *
 * MEASURED: 178 cells across 92 of 529 undergraduate programs (17.4%) had candidate sets
 * admitting 6000-level-and-above courses — median 39% of the pool, and one cell where it
 * was 100%. `Khoury Approved Electives` in Computer Science and Mathematics came out as
 * 247 candidates of which 155 were graduate, including 53 at 7000 level.
 *
 * Two things were wrong because of it, and only one of them is cosmetic. The reachable
 * SHARE was computed over courses the student cannot take, so a pool read as 82% open in
 * term 1 when its undergraduate half was not. And the WITNESS — the proof that a legal
 * completion exists — could satisfy an undergraduate's elective with a doctoral seminar.
 *
 * ── Degrade to less information, never to a broken plan ──────────────
 *
 * If filtering would empty a cell, the unfiltered set is kept. A cell whose candidates
 * are ALL graduate courses is a fact about our parse of the requirement, not about the
 * student, and refusing to plan the program is a worse answer than planning it with a
 * candidate set we can see is wrong.
 */
export function registrable(candidates, studentType) {
  if (candidates === null || studentType === "graduate") return candidates;
  const ok = candidates.filter(id => (courseLevel(id) ?? 0) < GRADUATE_ONLY_LEVEL);
  return ok.length ? ok : candidates;
}

export function buildDomains(cells, terms, {
  courseMap = {}, depthOf = () => 0, offeringProbability = () => null,
  // Defaults to "offered", matching `offeringProbability`'s null: absent data is not
  // evidence of absence, and a default of `false` would make every cell unschedulable
  // for a caller that has no offering port at all.
  offered = () => true,
  planDepthOf = null, wideAt = wideAtFor((cells ?? []).length),
  coopPrep = null, coopBoundary = Infinity, studentType = "undergraduate",
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
        // ── The app's rule, not a weaker one of our own ────────────
        //
        // This asked `offeringProbability(...) !== 0`, which bars a course only from a
        // season it has NEVER run in. The app flags a course offered in half or fewer of
        // the recorded instances of a season, and the app is what the student sees.
        //
        // `CS 3800` is recorded in Summer B once in four years. Probability 0.25, so the
        // old test said yes, CHART put it in a Summer B, and the card came up `offered?`.
        // A plan the app flags has a hard error in it whatever the engine thinks, and
        // there is no version of "no availability errors" that survives the two layers
        // asking different questions.
        //
        // `offered` is the port that carries the app's own `effectiveOffered`, including
        // its two extra rules: a student's override outranks history, and fewer than two
        // recorded instances is no evidence and reads as offered — which is what keeps the
        // 40.8% of the catalog with no history schedulable.
        if (offered(id, t.semTypeId)) s.add(t.semTypeId);
      }
      seasonCache.set(id, s);
    }
    return s;
  };

  for (const cell of cells) {
    const candidates = registrable(candidatesFor(cell, courseMap), studentType);
    const minDepth = minDepthOf(cell, { depthOf, courseMap, planDepthOf });
    const depthBoth = (id) => Math.max(depthOf(id), planDepthOf ? planDepthOf(id) : 0);

    // ── Co-op preparation goes BEFORE the co-op it prepares for ─────
    //
    // Northeastern requires a professional-development course before a student may go
    // on co-op, and nothing in the catalog records it — the co-op is not a course, so
    // it cannot have a prerequisite. The published plans state it unanimously: `ENCP
    // 2000` appears before the first work term in 141 of 141 plans that contain both,
    // `CS 1210` in 84 of 84, typically two terms before.
    //
    // CHART put CS 1210 after the co-op it prepares for. A hard bound, not a
    // preference: this is a rule the university enforces at registration, and a plan
    // that breaks it is one the student cannot follow.
    const isPrep = coopPrep && (cell.groups ?? []).some(g => g.some(id => coopPrep.has(id)));
    const lastAllowed = isPrep ? Math.min(terms.length - 1, coopBoundary - 1) : terms.length - 1;

    // ── How much of a pool is actually OPEN in each term ────────────
    //
    // `domain` answers "is this cell legal here", and for a pool that means ONE
    // candidate is reachable — a share above zero. Measured, that is not how a
    // department places a pool: over 742 major-subject pools in 195 published plans,
    // the share of the pool already prereq-reachable where they put it is
    //
    //     mean 0.92    median 1.00    p10 0.69
    //
    // They wait until essentially the whole pool is open. A cell placed at share 0.05
    // passes the witness — one candidate is enough to prove legality — and hands the
    // student a `Mathematics Elective` they can answer exactly one way, which is not an
    // elective. This is the measurable form of "look at what the pool's courses need
    // first": the share rises precisely when the pool's common prerequisites are done,
    // and it needs no opinion about WHICH course the student picks.
    //
    // Per term, computed here because the search sorts terms thousands of times and
    // must not re-scan 250 candidates to do it.
    const reachAt = new Array(terms.length).fill(1);
    if (candidates !== null && candidates.length) {
      for (let ti = 0; ti < terms.length; ti++) {
        let ok = 0;
        for (const id of candidates) {
          if (depthBoth(id) <= ti && allowedSeasons(id).has(terms[ti].semTypeId)) ok++;
        }
        reachAt[ti] = ok / candidates.length;
      }
    }

    const domain = [];
    for (let ti = 0; ti <= lastAllowed; ti++) {
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
        reason: isPrep && lastAllowed < minDepth ? "coop-prep-cannot-precede-the-coop"
              : minDepth >= terms.length ? "prereq-chain-longer-than-plan"
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

    plans.push({ cell, domain, candidates, seasonOk, minDepth, reachAt });
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
