// ═══════════════════════════════════════════════════════════════════
// CHART · PRECEDENCE — order among the courses THIS plan commits to
//
// The global prereq DAG is nearly useless for ordering: 71% of the catalog has
// depth 0, because most prereqs are wide ORs and OR takes the minimum, so one
// branch the plan does not contain collapses the bound. CS 2800 measures as depth
// 0 in the catalog and genuinely requires CS 1800 in every plan that names both.
//
// The bound that bites is PLAN-RELATIVE. Inside one program, a ref resolves to a
// course the plan actually schedules or to nothing at all:
//
//   ref names a planned course  → that course's own plan-depth, plus one
//   ref names anything else     → absent, contributing nothing
//
// Same neutrality rule as everywhere else in CHART, applied to the third reason a
// ref can be unresolvable. The result is a real chain — MATH 1341 → MATH 1342 →
// MATH 2321 comes out as 0 → 1 → 2 — where the catalog-wide fold said 0, 0, 0.
//
// ── Why the search needs edges as well as depths ────────────────────
//
// Depths are lower bounds, and a lower bound does not stop the search putting
// CS 1800 in term 5 and CS 2800 in term 3. Without explicit edges the only thing
// that notices is the final witness, so the search discovers the ordering by
// backtracking: measured, every one of five test programs burned the whole 20,000
// node budget and refused. With edges it is forward-checked, and the same programs
// solve in tens of nodes.
//
// ── The edges are derived, not read off ─────────────────────────────
//
// "B lists A in its prereqs" is not the question. `CS 4100` lists
// `CS 3100 Or CS 3500`, and if the plan contains only CS 3100 then CS 3100 is
// genuinely required; if it contained both, neither would be. So an edge exists
// when REMOVING A breaks B — the boolean structure decides, and a course named in
// an OR alongside another the plan also has creates no edge at all.
//
// Strictness is tested the same way: A must precede B strictly unless B is still
// satisfied with A in the SAME term, which is what a `concurrent` ref allows.
// ═══════════════════════════════════════════════════════════════════

import { foldPrereqTree, refId } from "../core/prereqFold.js";

/** Deep enough that no real degree reaches it; a cycle cannot run away. */
const CAP = 24;

/**
 * @typedef {Object} PrecedenceIndex
 * @property {(courseId: string) => number} planDepthOf
 *   terms that must precede this course, counting only planned courses
 * @property {Map<string, Set<string>>} before   cell id → cell ids that must precede it
 * @property {Map<string, Set<string>>} after    the reverse
 * @property {Set<string>} concurrentOk  "A|B" pairs where the same term is allowed
 * @property {object[]} unscheduledPrereqs  reported, never enforced
 */

/**
 * Build plan-relative depths and cell precedence edges.
 *
 * @param {object[]} cells      from deriveCells
 * @param {Record<string,object>} courseMap
 * @returns {PrecedenceIndex}
 */
/**
 * Prerequisites the catalog does not record, observed in its own published plans.
 *
 * MATH 2321 (Calculus 3) has an EMPTY prereq field, so nothing in our data stops a
 * plan putting it first. 53 programs place it after MATH 1342 and none before.
 * `scripts/derive-plan-order.js` turns that agreement into edges, under filters
 * strict enough to keep the calculus sequence and drop the 5,000-odd pairs that are
 * merely conventional.
 *
 * Folded in as EXTRA REFS on the successor rather than as a separate mechanism, so
 * the union-of-options rule, concurrency and plan-depth all apply to them unchanged
 * — and so an inferred edge cannot behave differently from a recorded one.
 *
 * @param {{before: string, after: string}[]} observed
 * @returns {Map<string, Set<string>>} course id → courses that must precede it
 */
export function observedRefs(observed = []) {
  const out = new Map();
  for (const e of observed) {
    if (!e?.before || !e?.after || e.before === e.after) continue;
    if (!out.has(e.after)) out.set(e.after, new Set());
    out.get(e.after).add(e.before);
  }
  return out;
}

/**
 * @param {object[]} cells
 * @param {Record<string,object>} courseMap
 * @param {object} [opts]
 * @param {{before: string, after: string}[]} [opts.observed]
 *   edges derived from published plans. Evidence, not fact — see `observedRefs`.
 */
export function buildPrecedence(cells, courseMap = {}, { observed = [] } = {}) {
  const extra = observedRefs(observed);

  // A course's prerequisites as CHART reads them: what the catalog records, plus
  // what the published plans unanimously show. Composed as one token list so every
  // consumer below folds a single tree and cannot treat the two sources
  // differently.
  const prereqsOf = (id) => {
    const base = courseMap[id]?.prereqs;
    const add = extra.get(id);
    if (!add?.size) return base;
    const refs = [...add].sort()
      .filter(r => courseMap[r])
      .map(r => ({ subject: courseMap[r].subject, number: courseMap[r].number }));
    if (!refs.length) return base;
    // AND, because an observed edge is a claim that this course comes after that
    // one in every plan that has both — not one of several ways to be ready.
    const chain = refs.flatMap((r, i) => (i ? ["And", r] : [r]));
    return base?.length ? ["(", ...base, ")", "And", ...chain] : chain;
  };
  const view = (id) => {
    const c = courseMap[id];
    return c ? { ...c, prereqs: prereqsOf(id) } : c;
  };
  // Every course the plan commits to outright. Only these can create order:
  // a choice cell's answer is not decided, and an elective's is the student's.
  const plannedCourses = new Map();          // course id → cell id
  for (const c of cells) {
    if (c.kind !== "named" || !c.groups?.[0]) continue;
    for (const id of c.groups[0]) if (courseMap[id]) plannedCourses.set(id, c.id);
  }

  // ── Plan-relative depth ─────────────────────────────────────────
  const depths = new Map();
  const inProgress = new Set();
  const planDepthOf = (id) => {
    const memo = depths.get(id);
    if (memo !== undefined) return memo;
    if (inProgress.has(id)) return 0;        // cycle: our data's defect, not the world's
    const course = courseMap[id];
    if (!course) return 0;
    inProgress.add(id);
    const below = foldPrereqTree(prereqsOf(id), {
      or:  (a, b) => Math.min(a, b),
      and: (a, b) => Math.max(a, b),
      note: () => 0,
      course: (tok) => {
        const rid = refId(tok);
        // Not scheduled by this plan → the plan makes no claim about it, so it
        // contributes nothing. Same rule as an unresolvable ref.
        if (!plannedCourses.has(rid) || rid === id) return null;
        // A concurrent ref may sit in the SAME term, so it costs no depth of its
        // own — only whatever its own prerequisites cost.
        return planDepthOf(rid) + (tok.concurrent ? 0 : 1);
      },
    });
    inProgress.delete(id);
    const value = Math.min(CAP, below ?? 0);
    depths.set(id, value);
    return value;
  };
  // Eager and sorted, so a cyclic component resolves the same way every run —
  // determinism is a hard requirement and lazy memoisation is order-dependent.
  for (const id of [...plannedCourses.keys()].sort()) planDepthOf(id);

  // ── Cell edges ──────────────────────────────────────────────────
  //
  // A ≺ B when removing A's courses makes B unsatisfiable. Tested by making every
  // planned course available early and A's courses late: if B still passes, A was
  // not required, and if it fails A is the only thing that can have caused it.
  //
  // Both roles are open to any cell with enumerable options, under the rule this
  // repo already uses for reservation edges: the edge holds only if it holds under
  // EVERY option.
  //
  //   as SUCCESSOR   `CS 4300 or CS 4100` must follow CS 3100 because both branches
  //                  need it, whichever the student picks.
  //   as PREDECESSOR the union of its options is what a successor may NOT rely on
  //                  being early. Whichever option the student takes, only that
  //                  one's courses appear, so the worst case is none of them — and
  //                  a successor that cannot survive that must come after.
  //
  // Restricting predecessors to NAMED cells was what left 39 programs refusing.
  // `Statistics Foundation` needs MATH 1341, which this program offers as
  // `MATH 1341 or MATH 1251`; no edge was derived, the search placed the successor
  // first, and only the final witness noticed — 20,000 nodes too late.
  const enumerable = cells.filter(c => optionsOf(c, courseMap, plannedCourses) !== null);
  const before = new Map(enumerable.map(c => [c.id, new Set()]));
  const after  = new Map(cells.map(c => [c.id, new Set()]));
  const concurrentOk = new Set();

  // Two synthetic worlds. `semIndex` maps a marker to an ordinal so
  // `prereqReachable`'s arithmetic works unchanged.
  const EARLY = "early", LATE = "late", SAME = "same";
  const semIndex = { [EARLY]: 0, [SAME]: 5, [LATE]: 9 };

  /** Is a whole option (a group of co-required courses) satisfied in this world? */
  const optionOk = (group, placements, ti) => group.every(id => {
    const course = view(id);
    if (!course) return true;
    return reach(course, placements, semIndex, ti);
  });

  // Every cell's option courses, computed once — the predecessor role needs the
  // union and the successor role needs the groups.
  const optionsById = new Map(
    enumerable.map(c => [c.id, optionsOf(c, courseMap, plannedCourses)]));
  const unionById = new Map(
    [...optionsById].map(([id, opts]) => [id, new Set(opts.flat())]));

  for (const b of enumerable) {
    const options = optionsById.get(b.id);
    // Everything available early, minus the cell's own courses — a course cannot be
    // its own prerequisite, and leaving it in would make every cell depend on itself.
    const ownCourses = unionById.get(b.id);
    const allEarly = {};
    for (const id of plannedCourses.keys()) if (!ownCourses.has(id)) allEarly[id] = EARLY;

    // Baseline: if an option fails even with everything available early, no single
    // cell is responsible; that gap is reported separately, not turned into an edge.
    const liveOptions = options.filter(g => optionOk(g, allEarly, semIndex[SAME]));
    if (!liveOptions.length) continue;

    for (const a of enumerable) {
      if (a.id === b.id) continue;
      const aCourses = unionById.get(a.id);
      // Two cells drawing on the same courses cannot order each other: the test
      // below would derive A ≺ B and B ≺ A both, and the search would then find
      // neither placeable. This is the split-credit and shared-pool case.
      let overlaps = false;
      for (const id of aCourses) if (ownCourses.has(id)) { overlaps = true; break; }
      if (overlaps) continue;

      // Does any option share a ref with A? Cheap gate before the tree evals.
      const shares = liveOptions.some(g =>
        refsOf(g, prereqsOf).some(r => aCourses.has(r)));
      if (!shares) continue;

      const withALate = { ...allEarly };
      for (const id of aCourses) withALate[id] = LATE;
      // The edge holds only if EVERY live option needs A. One option that survives
      // without A means the student can avoid the dependency entirely, and asserting
      // the edge would forbid a legal plan.
      if (liveOptions.some(g => optionOk(g, withALate, semIndex[SAME]))) continue;

      before.get(b.id).add(a.id);
      after.get(a.id).add(b.id);

      // Would the SAME term do? Only a `concurrent` ref allows it, and again it has
      // to hold for every option.
      const withASame = { ...allEarly };
      for (const id of aCourses) withASame[id] = SAME;
      if (liveOptions.every(g => optionOk(g, withASame, semIndex[SAME]))) {
        concurrentOk.add(`${a.id}|${b.id}`);
      }
    }
  }

  const named = cells.filter(c => c.kind === "named" && c.groups?.[0]?.length);

  // ── What the plan does not schedule ─────────────────────────────
  //
  // Reported, never enforced. A prerequisite the program never names may be met by
  // an elective, transfer credit or AP, and refusing over it would be a violation
  // we have no evidence for. But it is worth SAYING: a student reading a generated
  // plan should know which of its courses have unscheduled prerequisites.
  // Asked with a DIFFERENT algebra from the one that enforces order, and the
  // difference is the whole point. `reach` treats an absent ref as "no claim", which
  // is right for deciding legality and useless for finding a gap — it can never
  // return false, so a first attempt at this reported nothing at all.
  //
  // Here an absent ref that the CATALOG HAS is a genuine hole (the plan could have
  // scheduled it and did not); one the catalog lacks stays neutral, because that is
  // our data's defect and not the program's.
  const satisfiableByPlan = (course) => foldPrereqTree(course?.prereqs, {
    or:  (a, b) => a || b,
    and: (a, b) => a && b,
    note: () => null,
    course: (tok) => {
      const rid = refId(tok);
      if (plannedCourses.has(rid)) return true;
      if (!courseMap[rid]) return null;          // renumbered away — not an operand
      return false;                              // the plan could have, and did not
    },
  }) ?? true;

  const unscheduledPrereqs = [];
  for (const c of named) {
    for (const id of c.groups[0]) {
      const missing = refsOf([id], prereqsOf)
        .filter(r => !plannedCourses.has(r) && courseMap[r]);
      if (!missing.length) continue;
      // Only when NOTHING the plan schedules can satisfy the tree — an OR with one
      // planned branch is fine and must not be reported as a gap.
      if (satisfiableByPlan(view(id))) continue;
      unscheduledPrereqs.push({ cell: c.id, course: id, needs: missing.sort() });
    }
  }

  return { planDepthOf, before, after, concurrentOk, unscheduledPrereqs, plannedCourses };
}

/**
 * How many candidates a cell may have and still get precedence edges.
 *
 * Deriving an edge costs one tree evaluation per option per named cell, and the
 * edge requires EVERY option to need the predecessor — which a 247-course elective
 * pool never does. So a large pool is skipped rather than measured: the answer
 * would be "no edge" and the cost is quadratic. Above the cap the domain's depth
 * floor is the only bound, which is the conservative direction.
 */
export const MAX_OPTIONS_FOR_EDGES = 40;

/**
 * A cell's options as groups, or null when it has too many to reason about.
 *
 * A named or choice cell states its groups. A bounded open cell's candidates are
 * each a group of one — a `MATH 3001–4999` pool with 41 members is enumerable and
 * genuinely might have a shared prerequisite. An unbounded cell has none.
 */
function optionsOf(cell, courseMap, plannedCourses) {
  if (cell.groups?.length) {
    const live = cell.groups.filter(g => g.every(id => courseMap[id]));
    return live.length ? live : null;
  }
  if (!cell.spec) return null;
  // Only candidates the plan could actually be blocked by matter here, so the
  // enumeration is over the spec's own courses.
  const out = [];
  for (const id of cell.spec.keys) if (courseMap[id]) out.push([id]);
  if (cell.spec.ranges.length) {
    // A range's members are not listed, so this cannot be enumerated cheaply and
    // reliably; treat it as too wide rather than half-counting it.
    return null;
  }
  return out.length && out.length <= MAX_OPTIONS_FOR_EDGES ? out : null;
}

/** Every course id a group's courses list as a prerequisite. */
function refsOf(group, prereqsOf) {
  const out = [];
  for (const id of group ?? []) {
    foldPrereqTree(prereqsOf(id), {
      or: () => 1, and: () => 1, note: () => 1,
      course: (tok) => { out.push(refId(tok)); return 1; },
    });
  }
  return out;
}

/**
 * The same neutrality rule as `witness.prereqReachable`, kept local so this module
 * does not depend on the witness and the two cannot import each other.
 *
 * A ref absent from `placements` contributes nothing — it is either renumbered
 * away or not scheduled by this plan, and in both cases the plan makes no claim.
 */
function reach(course, placements, semIndex, ti) {
  const ok = foldPrereqTree(course?.prereqs, {
    or:  (a, b) => a || b,
    and: (a, b) => a && b,
    // Neutral, never satisfied — see the long note on `witness.prereqReachable`.
    // Reading "or permission of the advisor" as satisfied deleted the MATH 1341 →
    // MATH 1342 edge in every program that names both.
    note: () => null,
    course: (tok) => {
      const fi = semIndex[placements[refId(tok)]];
      if (fi === undefined) return null;
      return tok.concurrent ? fi <= ti : fi < ti;
    },
  });
  return ok ?? true;
}

/**
 * The earliest and latest term each cell can occupy once precedence is folded in.
 *
 * A longest-path pass over the edge graph, in both directions. This is the critical
 * path, and it settles a question the search should never have to discover by
 * exhaustion: a chain of five cells cannot fit four legal terms, and no amount of
 * backtracking will make it.
 *
 * Bioengineering failed after 20,000 nodes with NOTHING to report, because every
 * branch was cut by capacity or precedence and neither records a witness failure.
 * The bound below answers the same question in one pass and names the chain.
 *
 * @param {import("./domains.js").CellPlan[]} plans
 * @param {PrecedenceIndex} precedence
 * @returns {{earliest: Map, latest: Map, impossible: object[]}}
 */
export function criticalPath(plans, precedence) {
  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const lo = new Map();      // earliest term, honouring predecessors
  const hi = new Map();      // latest term, honouring successors

  const step = (id, edges, pick, base, dir) => {
    if (pick.has(id)) return pick.get(id);
    const plan = byId.get(id);
    if (!plan?.domain.length) return null;
    // Mark in-progress with the unconstrained bound so a cycle terminates rather
    // than recursing. A precedence cycle means the data contradicts itself; it is
    // reported below rather than hung on.
    pick.set(id, base(plan));
    let v = base(plan);
    for (const other of edges.get(id) ?? []) {
      const o = step(other, edges, pick, base, dir);
      if (o == null) continue;
      const same = dir > 0
        ? precedence.concurrentOk.has(`${other}|${id}`)
        : precedence.concurrentOk.has(`${id}|${other}`);
      const shifted = o + (same ? 0 : 1) * dir;
      v = dir > 0 ? Math.max(v, shifted) : Math.min(v, shifted);
    }
    pick.set(id, v);
    return v;
  };

  for (const p of [...plans].sort((a, b) => String(a.cell.id).localeCompare(String(b.cell.id)))) {
    step(p.cell.id, precedence.before, lo, (pl) => pl.domain[0], +1);
  }
  for (const p of [...plans].sort((a, b) => String(a.cell.id).localeCompare(String(b.cell.id)))) {
    step(p.cell.id, precedence.after, hi, (pl) => pl.domain[pl.domain.length - 1], -1);
  }

  const impossible = [];
  for (const p of plans) {
    const a = lo.get(p.cell.id), b = hi.get(p.cell.id);
    if (a == null || b == null) continue;
    // No term in the domain survives the two bounds.
    const room = p.domain.filter(t => t >= a && t <= b);
    if (room.length) continue;
    impossible.push({
      cell: p.cell.id, title: p.cell.title,
      earliest: a, latest: b, domain: p.domain,
      chain: [...(precedence.before.get(p.cell.id) ?? [])]
        .map(id => byId.get(id)?.cell.groups?.[0]?.join("+") ?? id),
      reason: a > b ? "prereq-chain-longer-than-plan" : "no-legal-term-after-prerequisites",
    });
  }
  return { earliest: lo, latest: hi, impossible };
}

/**
 * How long a chain must follow each cell — its height in the precedence DAG.
 *
 * This is the weight that makes sequencing work, and it is worth being precise about
 * why it beats the obvious alternative.
 *
 * Published plans run low-level to high-level, and copying that would be a mistake:
 * the ladder is not a principle, it is a SYMPTOM. Two different things produce it —
 * real prerequisite depth, which we model, and convention, which nothing enforces.
 * Following the ladder for its own sake reproduces exactly the defect this engine
 * exists to fix, because it is also what makes departments spend the general
 * electives first and arrive at co-op recruiting with no depth.
 *
 * Chain height says the useful thing instead: **a course that unlocks a long run of
 * others has to go early, and a course nothing depends on can go anywhere.** That
 * single rule
 *
 *   · reproduces low-to-high ordering wherever a real chain exists, for the real
 *     reason rather than by imitation;
 *   · races as far up the major's chains as the calendar legally allows before the
 *     first co-op, which is what "be competitive at recruiting" actually means;
 *   · and leaves terminal courses, capstones and general electives last, which is
 *     the complaint that started this.
 *
 * Counting DEPENDENTS instead of measuring height would get this wrong: a cell with
 * three terminal dependents looks more urgent than one with a single dependent that
 * has five more behind it, and the second is the one that must not slip.
 *
 * @returns {Map<string, number>} cell id → longest chain of cells after it
 */
export function chainHeight(plans, precedence) {
  const ids = plans.map(p => p.cell.id);
  const memo = new Map();
  const open = new Set();
  const height = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (open.has(id)) return 0;              // a cycle is our data's defect
    open.add(id);
    let best = 0;
    for (const next of precedence.after.get(id) ?? []) {
      best = Math.max(best, 1 + height(next));
    }
    open.delete(id);
    memo.set(id, best);
    return best;
  };
  // Sorted, so a cyclic component resolves identically every run.
  for (const id of [...ids].sort()) height(id);
  return memo;
}

/**
 * Does an assignment respect every edge?
 *
 * Used both as a search filter and as a verification gate, so the two cannot
 * disagree about what "in order" means.
 */
export function precedenceViolations(precedence, termOf) {
  const out = [];
  for (const [bId, befores] of precedence.before) {
    const bt = termOf.get(bId);
    if (bt == null) continue;
    for (const aId of befores) {
      const at = termOf.get(aId);
      if (at == null) continue;
      const same = precedence.concurrentOk.has(`${aId}|${bId}`);
      if (same ? at <= bt : at < bt) continue;
      out.push({ before: aId, after: bId, atTerm: at, beforeTerm: bt, concurrentOk: same });
    }
  }
  return out;
}
