// ═══════════════════════════════════════════════════════════════════
// CHART · WITNESS — proving a legal completion exists
//
// A plan of reservations can be infeasible with zero named-course violations:
// put three CS-elective cells in year 2 when every CS elective needs 3000-level
// prerequisites, and nothing anywhere flags it. Requirement coverage says the
// cells are right, the prereq checker sees no courses to check, and the plan is
// still impossible.
//
// So feasibility is defined properly:
//
//   A plan is WITNESSED FEASIBLE iff a matching exists between its cells and
//   DISTINCT courses such that each course is (a) eligible for that cell's
//   requirement, (b) prereq-reachable by that cell's term, (c) not provably
//   unoffered in that term's season, (d) used once.
//
// ── Why this is not one bipartite matching ─────────────────────────
//
// Condition (b) is circular: whether a candidate is prereq-reachable by term T
// depends on what the OTHER cells resolve to, so it is not a property of
// (course, term) that can be baked into an edge. Matching alone cannot express
// precedence.
//
// The workable form is TERM-ORDERED SEQUENTIAL matching: process terms in order,
// and when matching term T treat the courses already matched in terms < T as
// placed. Each term is then an exact matching over an edge set that is fully
// determined. Globally it is a greedy sequence of exact steps rather than a
// global optimum — which is honest, and enough, because a witness only has to
// EXIST, not be best.
//
// ── The witness is never a commitment ──────────────────────────────
//
// It is computed to prove a legal completion exists and then discarded. The
// student is shown the reservation, not the course we matched. Same stance the
// repo already takes on the catalog's plan pane — "a witness, not a source" —
// and the honest resolution of the never-decide rule: we decide nothing, but we
// prove a decision exists.
//
// ── Kuhn's, not the matrix max-flow ────────────────────────────────
//
// `requirementBinding.maxFlow` is Edmonds-Karp on an adjacency MATRIX, sized for
// the tens of nodes a cell↔requirement graph has. Here the right-hand side is
// courses: a `~general` cell admits ~8,000, so a matrix would be 64 M entries
// per BFS. Kuhn's augmenting-path matching on adjacency LISTS is O(V·E) over
// ≤ ~50 cells and costs nothing.
//
// Wide cells are not enumerated at all. If a cell has at least as many
// candidates as there are cells in the term, it can always be matched after
// every other cell — at most C−1 courses are taken, so one is always free. That
// is Hall's condition read directly, and it keeps the graph to the cells that
// are genuinely tight.
//
// ── Only HALF of this is sound to run on a partial plan ─────────────
//
// The search wants to prune early, which means witnessing an assignment that is
// not finished yet. Two of the four conditions survive that and two do not:
//
//   eligibility, season, distinctness   SOUND on a subset. Fewer cells compete
//                                       for the same courses and fewer courses
//                                       are spent, so a subset that fails would
//                                       have failed as part of the whole.
//   prereq-reachability                 NOT SOUND. A cell in term 6 needing
//                                       CS 3000 fails if the cell that supplies
//                                       CS 3000 has not been placed yet — and it
//                                       might still land in term 5.
//
// Pruning on the second would reject feasible plans, and silently: the engine
// would refuse a program that is perfectly generatable and no test asserting
// "output is legal" would ever notice, because there would be no output. So
// `checkPrereqs` is false during the search and true for the final witness, and
// the two callers are the only places that decide it.
// ═══════════════════════════════════════════════════════════════════

import { foldPrereqTree, refId } from "../core/prereqFold.js";

/**
 * Maximum matching, left side = cells, right side = courses.
 *
 * @param {string[][]} adj  adj[i] = course ids cell i can take
 * @returns {{size: number, matchOf: (string|null)[], unmatched: number[]}}
 */
export function bipartiteMatch(adj) {
  const n = adj.length;
  const matchOf = new Array(n).fill(null);   // cell → course
  const takenBy = new Map();                 // course → cell
  let size = 0;

  const augment = (i, seen) => {
    for (const course of adj[i]) {
      if (seen.has(course)) continue;
      seen.add(course);
      const holder = takenBy.get(course);
      if (holder === undefined || augment(holder, seen)) {
        takenBy.set(course, i);
        matchOf[i] = course;
        return true;
      }
    }
    return false;
  };

  // Ascending degree: the tight cells claim first, so a wide cell is not sent
  // down a long augmenting path for a course a narrow cell had no alternative to.
  const order = [...adj.keys()].sort((a, b) => adj[a].length - adj[b].length || a - b);
  for (const i of order) if (augment(i, new Set())) size++;

  return { size, matchOf, unmatched: [...adj.keys()].filter(i => matchOf[i] === null) };
}

/**
 * Is a course's prereq tree satisfied by a given set of earlier placements?
 *
 * Not `evalPrereqTree` directly, because of one leaf it must read differently.
 * `"missing"` means a ref is absent from the plan, and for 13.2% of atoms that is
 * because the catalog renumbered the course away — a defect in our data, not an
 * impossible course. Refusing to schedule those would make whole programs
 * ungeneratable over our own gap.
 *
 * So an unresolvable ref is **absent from the boolean**, exactly as
 * `prereqDepth.js` treats it, and for the same reason: `null` is neutral in both
 * combinators, so it neither satisfies an OR on its own nor breaks an AND. The
 * two modules must agree here — a depth bound that excuses what the witness then
 * rejects would make the search thrash and refuse feasible plans.
 *
 *   OR  [CS 2100 placed, CS 2500 gone]  → true from the branch we can read
 *   OR  [CS 2100 absent,  CS 2500 gone]  → false; nothing satisfies it
 *   [CS 3500 gone] alone                 → null → true; we know nothing
 *
 * The middle line is what the first generated plan got wrong: reading the gone
 * branch as satisfied put CS 3100 six terms before CS 2100.
 *
 * ── A prerequisite the plan does not schedule is also ABSENT ────────
 *
 * The same rule, applied to the other reason a ref can be unresolvable: the plan
 * simply does not contain it. BIOE 2350 requires a chemistry course this program
 * never names, and the student may satisfy it with an elective, transfer credit or
 * AP. Reading that as a violation refused five programs out of five on the first
 * attempt, and it would have been a violation we have no evidence for — the exact
 * thing `evalPrereqTree` declines to claim for a condition leaf.
 *
 * So CHART enforces ORDER among the courses a plan commits to, and reports — never
 * refuses over — prerequisites the plan leaves unscheduled. Those two things are
 * different: the first is a sequencing error CHART causes and can fix, the second
 * is a fact about the program's own requirements that CHART cannot change.
 *
 * This also makes the check sound on a PARTIAL plan for free: a cell not yet
 * placed contributes nothing to `placements`, so it reads as absent rather than as
 * late, and no branch is cut for a violation a later assignment could fix.
 */
export function prereqReachable(course, placements, semIndex, ti, courseMap) {
  const ok = foldPrereqTree(course?.prereqs, {
    or:  (a, b) => a || b,
    and: (a, b) => a && b,
    // A condition leaf is NEUTRAL, not satisfied. `null` is the phantom-operand
    // value, so it neither breaks an AND nor answers an OR.
    //
    // Reading it as `true` was a real bug and a subtle one. `MATH 1342`'s
    // prerequisites live in its prose, not its `prereqs` field, and parse to
    // `MATH 1341 Or {note: "permission of head mathematics advisor"}`. Satisfying
    // the OR from the permission branch made Calculus 2 free of prerequisites, and
    // CHART duly scheduled it before Calculus 1 in 18 programs.
    //
    // "Cannot be verified" and "is satisfied" are different claims, and only the
    // first is true. `evalPrereqTree` has always drawn this line — `conditionStatus`
    // returns neutral unless the plan actually asserts the condition — and the
    // engine has to draw it the same way or the two disagree about the same plan.
    note: () => null,
    course: (tok) => {
      const id = refId(tok);
      if (!courseMap[id]) return null;           // renumbered away — not an operand
      const fi = semIndex[placements[id]];
      if (fi === undefined) return null;         // not in the plan — no claim to make
      return tok.concurrent ? fi <= ti : fi < ti;
    },
  });
  // No operand at all: an empty tree, or one whose every ref is absent.
  return ok ?? true;
}

/**
 * Term-ordered sequential witness.
 *
 * @param {object} args
 * @param {object[]} args.cells            every cell, with `.term` assigned
 * @param {(cell, semTypeId: string) => string[]|null} args.candidatesOf
 *   course ids that may answer a cell, or null when the cell cannot be blocked by
 *   distinctness — either it admits any course, or it has more candidates than
 *   there are cells. The search passes a season-prefiltered, truncated list; the
 *   final witness passes the whole one. See domains.js `wideAtFor` for why
 *   truncation is sound for one and not the other.
 * @param {object[]} args.terms            study terms in order
 * @param {Record<string,object>} args.courseMap
 * @param {(courseId: string, semTypeId: string) => number|null} args.offeringProbability
 * @param {(courseId: string) => boolean} [args.repeatable]
 * @param {boolean} [args.checkPrereqs]
 *   whether a CANDIDATE must be prereq-reachable. Named cells are always checked;
 *   see the soundness note below for why the two differ.
 * @param {(courseId: string) => number} [args.contention]
 *   how many other cells could be answered by this course. Wide cells pick the
 *   least-contended candidate, so an early elective does not spend a course a
 *   later, narrower cell has no alternative to.
 * @returns {{ok: boolean, failure: object|null, witness: Map<string,string>}}
 */
export function witnessPlan({
  cells, candidatesOf, terms, courseMap,
  offeringProbability = () => null, offered = () => true, repeatable = () => false,
  checkPrereqs = true, contention = () => 0,
}) {
  // Course id → the term index it is committed to, in the form evalPrereqTree
  // reads: placements[id] = semId, semIndex[semId] = ordinal.
  const placements = {};
  const semIndex = {};
  terms.forEach((t, i) => { semIndex[termId(t, i)] = i; });

  const witness = new Map();      // cell id → course id
  const used = new Set();         // courses spent, so distinctness holds globally

  // Named cells are FACTS, not matches: their courses are decided, so they enter
  // the placement set before any matching and are never candidates for anything.
  for (const c of cells) {
    if (c.kind !== "named" || !c.groups?.[0]) continue;
    for (const id of c.groups[0]) {
      placements[id] = termId(terms[c.term], c.term);
      if (!repeatable(id)) used.add(id);
    }
  }

  // ── A named course's OWN prerequisites still have to hold ────────
  //
  // Being a fact settles WHICH course it is, not whether it may be taken then.
  // Leaving this out is what let the first working version put MATH 2321 in the
  // first term and MATH 1342, its prerequisite, in the thirteenth — a plan that
  // passed every other gate and was visibly wrong to anyone reading it. The
  // stated minimum bar for a generated plan is that every prereq chain is
  // correct, and nothing else in the pipeline checks this one.
  //
  // Unconditional, mid-search included: an unplaced cell's course is absent from
  // `placements` and so reads as no-claim rather than as late, which is what makes
  // it sound on a partial assignment. See `prereqReachable`.
  for (const c of cells) {
    if (c.kind !== "named" || !c.groups?.[0]) continue;
    for (const id of c.groups[0]) {
      const course = courseMap[id];
      if (!course) continue;                 // renumbered away; nothing to check
      if (prereqReachable(course, placements, semIndex, c.term, courseMap)) continue;
      return {
        ok: false,
        failure: { kind: "named-prereq", cell: c.id, title: c.title, course: id,
                   term: c.term, termLabel: labelOf(terms[c.term]) },
        witness,
      };
    }
  }

  for (let ti = 0; ti < terms.length; ti++) {
    const term = terms[ti];
    const here = cells.filter(c => c.term === ti && c.kind !== "named");
    if (!here.length) continue;

    // Cells wide enough to be matched by Hall's argument are set aside; the rest
    // get real edges. `here.length` is the exact threshold — with at most that
    // many cells in the term, a cell with that many candidates always has one
    // free after everyone else has chosen.
    const wide = [];
    const tight = [];
    const adj = [];

    for (const cell of here) {
      const cands = candidatesOf(cell, term.semTypeId);
      if (cands === null) { wide.push(cell); continue; }   // cannot be blocked
      const legal = [];
      for (const id of cands) {
        if (used.has(id) && !repeatable(id)) continue;
        const course = courseMap[id];
        if (!course) continue;
        // Only an explicit zero blocks; null is unknown and unknown is allowed.
        // Never relaxed: a course scheduled in a season it has not run in is the
        // defect this engine exists to fix, so availability is the one preference
        // that never gives way. Where the shape leaves a cell nowhere to go, the
        // SHAPE yields instead — see `shape.studyTerms`.
        // The app's rule, not `!== 0`. See domains.js `allowedSeasons`.
        if (!offered(id, term.semTypeId)) continue;
        if (checkPrereqs && !prereqReachable(course, placements, semIndex, ti, courseMap)) continue;
        legal.push(id);
        // Stop enumerating once the cell is provably matchable regardless of
        // what anyone else takes. Saves walking 8,000 courses for a wide cell
        // and does not change the answer.
        if (legal.length > here.length) break;
      }
      if (!legal.length) {
        return {
          ok: false,
          failure: { kind: "no-candidate", cell: cell.id, title: cell.title,
                     term: ti, termLabel: labelOf(term) },
          witness,
        };
      }
      if (legal.length > here.length) { wide.push(cell); continue; }
      tight.push(cell);
      adj.push(legal);
    }

    const { matchOf, unmatched } = bipartiteMatch(adj);
    if (unmatched.length) {
      const cell = tight[unmatched[0]];
      return {
        ok: false,
        failure: {
          kind: "over-subscribed", cell: cell.id, title: cell.title,
          term: ti, termLabel: labelOf(term),
          // What the student can act on: this many cells competing for this many
          // distinct courses. "Infeasible" is not an answer anyone can use.
          cells: tight.length, courses: new Set(adj.flat()).size,
        },
        witness,
      };
    }

    tight.forEach((cell, i) => {
      const id = matchOf[i];
      witness.set(cell.id, id);
      placements[id] = termId(term, ti);
      if (!repeatable(id)) used.add(id);
    });

    // Wide cells commit last, to any candidate still free. They cannot fail
    // *within* the term: by construction more candidates were available than cells
    // in it.
    //
    // Across terms they can, and did. A `Khoury Approved Electives` cell in year 1
    // took CS 4100 because it sorted first, and the `CS 4300 or CS 4100` cell in
    // year 3 then had nothing left — a false infeasibility, produced entirely by
    // the order the greedy pick happened to consider courses in.
    //
    // So a wide cell takes the LEAST CONTENDED candidate: the one fewest other
    // cells could have used. A `~general` cell ends up with a course no requirement
    // wants, which is exactly what a free elective should be.
    for (const cell of wide) {
      const cands = candidatesOf(cell, term.semTypeId);
      const fits = (id) => (!used.has(id) || repeatable(id)) && courseMap[id]
        && offered(id, term.semTypeId)
        && (!checkPrereqs || prereqReachable(courseMap[id], placements, semIndex, ti, courseMap));
      const pick = cands === null
        ? firstFree(courseMap, fits)
        : leastContended(cands, fits, contention);
      if (!pick) {
        // Reachable only for a cell that admits any course in a catalog with
        // nothing left to give — vanishing in practice, reported honestly here
        // rather than crashing on an undefined id.
        return {
          ok: false,
          failure: { kind: "no-candidate", cell: cell.id, title: cell.title,
                     term: ti, termLabel: labelOf(term) },
          witness,
        };
      }
      witness.set(cell.id, pick);
      placements[pick] = termId(term, ti);
      if (!repeatable(pick)) used.add(pick);
    }
  }

  return { ok: true, failure: null, witness };
}

/**
 * Every catalog id in a fixed order, computed ONCE per catalog.
 *
 * ── The single most expensive line in the engine, until it was measured ──
 *
 * `firstFree` sorted `Object.keys(courseMap)` on every call, and it is called once per
 * UNBOUNDED cell per NODE. A degree with five general-elective cells therefore performed five
 * 7,966-element string sorts at every node of the search.
 *
 * Profiled: `StringCompare` 13.1% and `ArrayTimSort` 8.7% of ticks, and
 * `business_administration_bsba` spent 5,041 ms to explore 477 nodes — 10.6 ms per node,
 * against 11 microseconds for a cheap program. Twenty seconds of budget bought 1,798–3,222
 * nodes on those shapes, which is why 4x the time rescued none of them: the budget was never
 * the binding constraint, the cost of a node was.
 *
 * A `WeakMap` rather than a module-level variable because the catalog is an argument, not a
 * singleton — the MCP server, the tests and the CI sweep each hold their own, and a shared
 * cache keyed on nothing would hand one caller another's ordering. Weak so a discarded catalog
 * is collectable.
 *
 * The order is IDENTICAL to what the sort produced, so every witness, every plan and every
 * fingerprint is unchanged. This is purely the same work done once instead of a million times.
 */
const idOrderCache = new WeakMap();
function catalogIdOrder(courseMap) {
  let ids = idOrderCache.get(courseMap);
  if (!ids) {
    // Sorted, so the witness is deterministic: two runs must agree or the diff
    // review the data workflows rely on becomes noise.
    ids = Object.keys(courseMap).sort();
    idOrderCache.set(courseMap, ids);
  }
  return ids;
}

/** Any catalog course legal here — for a cell that admits the whole catalog. */
function firstFree(courseMap, fits) {
  for (const id of catalogIdOrder(courseMap)) if (fits(id)) return id;
  return null;
}

/**
 * The legal candidate fewest other cells could have used.
 *
 * Ties break on the id, so the choice is deterministic. Stops at contention 0,
 * since nothing can beat a course no other cell wants.
 */
function leastContended(cands, fits, contention) {
  let best = null, bestN = Infinity;
  for (const id of cands) {
    if (!fits(id)) continue;
    const n = contention(id);
    if (n < bestN || (n === bestN && best !== null && id < best)) { best = id; bestN = n; }
    if (bestN === 0) break;
  }
  return best;
}

/** A synthetic term id, since a shape's terms carry no plan semester ids. */
const termId = (term, i) => `t${i}`;
const labelOf = (term) => `${term?.label ?? ""} ${term?.termLabel ?? ""}`.trim();

/**
 * How many cells each course could answer.
 *
 * Bounded cells only. An unbounded cell admits the whole catalog, so counting it
 * would add 1 to every course and leave the ordering unchanged while costing a
 * pass over 8,000 ids per cell.
 */
export function buildContention(plans) {
  const counts = new Map();
  for (const p of plans) {
    for (const id of p.candidates ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (id) => counts.get(id) ?? 0;
}
