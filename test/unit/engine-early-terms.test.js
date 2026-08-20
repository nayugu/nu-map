// ═══════════════════════════════════════════════════════════════════
// Attacking `earlyTerms.js`.
//
// The rule it implements is one sentence, which makes it easy to state and easy to get
// subtly wrong in four places at once: the term INDEX space, the one-course-one-cell
// accounting, the repair's termination, and the promise that it never invents legality.
//
// So these are hostile by construction — malformed plans, cyclic precedence, a course two
// cells both want, a shape the plan does not fit, a repair with nowhere to go. A test that
// merely shows the happy path works would not have caught any defect this file has had.
// ═══════════════════════════════════════════════════════════════════
import test from "node:test";
import assert from "node:assert/strict";
import {
  adoptEarlyTerms, applyEarlyTerms, EARLY_TERMS,
  MOVED_AVAILABILITY, MOVED_PREREQ, MOVED_CAPACITY,
} from "../../src/engine/earlyTerms.js";

/** A shape of `n` fall/spring years, with work terms wherever `work` names them. */
const shapeOf = (years, work = []) => {
  const terms = [];
  for (let y = 0; y < years; y += 1) {
    for (const t of ["fall", "spring"]) {
      terms.push({ yearIndex: y, semTypeId: t, work: work.includes(`${y}|${t}`) });
    }
  }
  return { terms };
};

/** A published plan from `[["CS1","CS2"], ["CS3"]]` — one array per term, fall/spring. */
const planOf = (termCourses, opts = {}) => {
  const years = [];
  termCourses.forEach((ids, i) => {
    const yi = Math.floor(i / 2);
    years[yi] ??= { terms: [] };
    years[yi].terms.push({
      type: i % 2 === 0 ? "fall" : "spring",
      entries: ids === "coop"
        ? [{ coop: true }]
        : ids.map(g => ({ options: [Array.isArray(g) ? g : [g]] })),
    });
  });
  return { years, ...opts };
};

const named = (id, courses, domain) =>
  ({ cell: { id, kind: "named", groups: [courses] }, domain });
const choice = (id, groups, domain) =>
  ({ cell: { id, kind: "choice", groups }, domain });
const open = (id, domain) => ({ cell: { id, kind: "open", groups: null }, domain });

const NOPREC = { before: new Map(), concurrentOk: new Set() };
const wide = (n = 8) => Array.from({ length: n }, (_, i) => i);

// ── The index space ────────────────────────────────────────────────

test("early › a work term consumes no study-term index", () => {
  // Year 2 fall is co-op. A course in Year 2 SPRING is study term 2, not 3 — the domain
  // indexes `studyTerms`, which drops work terms. Getting this wrong aims every hint after
  // the first co-op one term off, and pulled late courses BACKWARD when it did.
  const shape = shapeOf(3, ["1|fall"]);
  const plan = planOf([["A"], ["B"], "coop", ["C"]]);
  const plans = [named("a", ["A"], wide()), named("b", ["B"], wide()), named("c", ["C"], wide())];
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.get("a"), 0);
  assert.equal(placed.get("b"), 1);
  assert.equal(placed.get("c"), 2, "Year 2 spring is study term 2, the co-op having no index");
});

test("early › a term the shape does not have is skipped, not guessed", () => {
  // A borrowed plan naming a summer this student never attends. Inventing a neighbouring
  // term would be manufacturing the department's opinion rather than reading it.
  const shape = shapeOf(2);
  const plan = { years: [{ terms: [{ type: "sumA", entries: [{ options: [["A"]] }] }] }] };
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [named("a", ["A"], wide())], precedence: NOPREC });
  assert.equal(placed.size, 0);
});

test("early › nothing past the window is adopted, however much the plan names", () => {
  const shape = shapeOf(4);
  const plan = planOf([["A"], ["B"], ["C"], ["D"], ["E"], ["F"]]);
  const plans = ["A", "B", "C", "D", "E", "F"].map((c, i) => named(`c${i}`, [c], wide()));
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, EARLY_TERMS);
  assert.ok(!placed.has("c4") && !placed.has("c5"), "terms 5 and 6 belong to CHART");
  assert.ok([...placed.values()].every(t => t < EARLY_TERMS));
});

// ── One course answers one cell ────────────────────────────────────

test("early › a course the department names once cannot fill two cells", () => {
  // A named cell requiring CS 2500 beside a choice cell that offers it. Matching both fixes
  // two requirements to one registration and over-fills the term with something not there
  // twice.
  const shape = shapeOf(2);
  const plan = planOf([["CS2500"]]);
  const plans = [
    choice("loose", [["CS2500"], ["CS2510"]], wide()),
    named("exact", ["CS2500"], wide()),
  ];
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 1);
  assert.equal(placed.get("exact"), 0, "the named cell claims it; the looser one had alternatives");
  assert.ok(!placed.has("loose"));
});

test("early › a course is spent ACROSS the window, not once per term", () => {
  // Found by fuzzing. The spend was per term, so a department listing one course in two of
  // its early terms let two different cells each be fixed on it — one registration asked to
  // satisfy two requirements, and a term holding something that is not there twice.
  const shape = shapeOf(3);
  const plan = planOf([["X"], ["X"]]);          // the department's own duplicate row
  const plans = [named("aaa", ["X"], wide()), named("bbb", ["X"], wide())];
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 1, "one course, one cell");
  assert.equal(placed.get("aaa"), 0, "and it lands in the EARLIER of the two published terms");
});

test("early › a corequisite group is adopted whole or not at all", () => {
  const shape = shapeOf(2);
  const plans = [named("pair", ["CS1800", "CS1802"], wide())];
  const both = adoptEarlyTerms({
    publishedPlan: planOf([[["CS1800", "CS1802"]]]), shape, plans, precedence: NOPREC });
  assert.equal(both.placed.get("pair"), 0, "the term offers both halves");

  const half = adoptEarlyTerms({
    publishedPlan: planOf([["CS1800"]]), shape, plans, precedence: NOPREC });
  assert.equal(half.placed.size, 0, "half a coreq group is not an answer to the cell");
});

test("early › a general elective is never fixed — it is the search's slack", () => {
  const shape = shapeOf(2);
  const plan = planOf([["A"]]);
  const plans = [open("elective", wide()), named("a", ["A"], wide())];
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.ok(!placed.has("elective"));
  assert.equal(placed.get("a"), 0);
});

test("early › a choice cell is fixed in TIME without being decided", () => {
  const shape = shapeOf(2);
  const plan = planOf([["CS2510"]]);
  const c = choice("pick", [["CS2500"], ["CS2510"]], wide());
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [c], precedence: NOPREC });
  assert.equal(placed.get("pick"), 0);
  assert.deepEqual(c.cell.groups, [["CS2500"], ["CS2510"]], "the cell's options are untouched");
});

// ── Repair ─────────────────────────────────────────────────────────

test("early › an unavailable term slides LATER, and says why", () => {
  const shape = shapeOf(3);
  const plan = planOf([["A"]]);
  // The department says term 0; the catalog only runs it in terms 2 and 3.
  const plans = [named("a", ["A"], [2, 3])];
  const { placed, moves } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.get("a"), 2, "the NEAREST legal term, not the last one");
  assert.deepEqual(moves, [{ cell: "a", from: 0, to: 2, why: MOVED_AVAILABILITY }]);
});

test("early › a course at or before its prerequisite is moved after it", () => {
  const shape = shapeOf(3);
  // The department stacked both in term 0 — departments do publish these.
  const plan = planOf([[["A"], ["B"]].flat()]);
  const plans = [named("a", ["A"], wide()), named("b", ["B"], wide())];
  const precedence = { before: new Map([["b", new Set(["a"])]]), concurrentOk: new Set() };
  const { placed, moves } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  assert.equal(placed.get("a"), 0);
  assert.equal(placed.get("b"), 1, "the SUCCESSOR moves, never the prerequisite");
  assert.equal(moves.find(m => m.cell === "b")?.why, MOVED_PREREQ);
});

test("early › a corequisite pair may share the term precedence allows them to", () => {
  const shape = shapeOf(3);
  const plan = planOf([[["A"], ["B"]].flat()]);
  const plans = [named("a", ["A"], wide()), named("b", ["B"], wide())];
  const precedence = {
    before: new Map([["b", new Set(["a"])]]), concurrentOk: new Set(["a|b"]),
  };
  const { placed, moves } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  assert.equal(placed.get("b"), 0, "concurrent is allowed, so nothing needs to move");
  assert.equal(moves.length, 0);
});

test("early › a chain stacked in one term comes out in consecutive terms", () => {
  // Fixing one course pushes its successors, which is why the repair runs to a fixpoint.
  const shape = shapeOf(4);
  const plan = planOf([["A", "B", "C"]]);
  const plans = ["A", "B", "C"].map((c, i) => named(c.toLowerCase(), [c], wide()));
  const precedence = {
    before: new Map([["b", new Set(["a"])], ["c", new Set(["b"])]]),
    concurrentOk: new Set(),
  };
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  assert.deepEqual([placed.get("a"), placed.get("b"), placed.get("c")], [0, 1, 2]);
});

test("early › repair may not slide a course OUT of the window", () => {
  // The rule's other half, and the one that leaked. Sliding is unbounded on its own, so a
  // course adopted in term 1 whose only legal terms are 5 and 6 was slid there and FIXED —
  // pinning a cell in the half of the plan that belongs to CHART. Measured before this
  // bound: 40 courses across the corpus, 37 in semester 5 and 3 in semester 6.
  const shape = shapeOf(4);
  const plan = planOf([[], ["A"]]);
  const plans = [named("a", ["A"], [5, 6])];
  const { placed, unplaced } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 0, "term 5 is CHART's, so nothing may be fixed there");
  assert.deepEqual(unplaced, [{ cell: "a", from: 1 }]);
});

test("early › EVERY fixed cell lands inside the window, whatever repair did", () => {
  // The property stated directly, over a shape where availability, precedence and capacity
  // all push at once. `EARLY_TERMS` is the boundary of this module's authority.
  const shape = shapeOf(5);
  const plan = planOf([["A", "B"], ["C"], ["D"], ["E"]]);
  const plans = [
    sized("a", ["A"], 9, [0, 1, 2, 3, 4, 5]), sized("b", ["B"], 9, [2, 3, 4, 5]),
    sized("c", ["C"], 9, [3, 4, 5]), sized("d", ["D"], 9, [4, 5]),
    sized("e", ["E"], 9, [5, 6]),
  ];
  const precedence = {
    before: new Map([["b", new Set(["a"])], ["c", new Set(["b"])], ["d", new Set(["c"])]]),
    concurrentOk: new Set(),
  };
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence, capOf: () => 12,
  });
  for (const [id, at] of placed) {
    assert.ok(at < EARLY_TERMS, `${id} was fixed at term ${at}, outside the window`);
  }
});

test("early › a course with no legal term at or after is handed back, never forced", () => {
  const shape = shapeOf(3);
  const plan = planOf([[], ["A"]]);            // department says term 1
  const plans = [named("a", ["A"], [0])];       // only term 0 is legal — earlier, not later
  const { placed, unplaced } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 0, "never moved EARLIER to manufacture a fit");
  assert.deepEqual(unplaced, [{ cell: "a", from: 1 }]);
});

test("early › no two FIXED cells are ever left out of order", () => {
  // Found by fuzzing at 60,000 instances. The repair fixpoint is capped at 8 passes because
  // a cycle would never converge, and a capped fixpoint can return before it settles — a
  // cell placed against a predecessor that then moves later in the same pass is stale. Both
  // are unit domains by the time the search sees them, so a violating pair is unsatisfiable
  // and costs the student the whole plan through the fallback.
  //
  // A chain of 12, each requiring the last, all published in term 0: far longer than the
  // pass cap can settle, so whatever survives must be checked rather than trusted.
  const shape = shapeOf(8);
  const ids = Array.from({ length: 12 }, (_, i) => `c${String(i).padStart(2, "0")}`);
  const plan = planOf([ids.map((_, i) => `K${i}`)]);
  const plans = ids.map((id, i) => named(id, [`K${i}`], wide(12)));
  const before = new Map();
  for (let i = 1; i < ids.length; i += 1) before.set(ids[i], new Set([ids[i - 1]]));
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: { before, concurrentOk: new Set() } });
  for (const [id, at] of placed) {
    for (const b of (before.get(id) ?? [])) {
      const bt = placed.get(b);
      if (bt != null) assert.ok(at > bt, `${b}@${bt} must precede ${id}@${at}`);
    }
  }
});

test("early › repair terminates on cyclic precedence rather than spinning", () => {
  // A cycle should be impossible upstream, and this must not be the thing that hangs the
  // browser if it ever is not.
  const shape = shapeOf(4);
  const plan = planOf([["A", "B"]]);
  const plans = [named("a", ["A"], wide()), named("b", ["B"], wide())];
  const precedence = {
    before: new Map([["a", new Set(["b"])], ["b", new Set(["a"])]]),
    concurrentOk: new Set(),
  };
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  // The claim is termination and legality, not a particular answer.
  for (const [id, at] of placed) {
    assert.ok(plans.find(p => p.cell.id === id).domain.includes(at), `${id} landed off-domain`);
  }
});

test("early › a repaired term is ALWAYS drawn from the cell's own domain", () => {
  // The load-bearing safety property: this may reorder a plan, never legalise one.
  const shape = shapeOf(4);
  const plan = planOf([["A"], ["B"], ["C"], ["D"]]);
  const domains = [[3, 5], [1], [6, 7], [2, 4]];
  const plans = ["A", "B", "C", "D"].map((c, i) => named(`c${i}`, [c], domains[i]));
  const precedence = { before: new Map([["c2", new Set(["c0"])]]), concurrentOk: new Set() };
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  for (const [id, at] of placed) {
    const p = plans.find(x => x.cell.id === id);
    assert.ok(p.domain.includes(at), `${id} was fixed to ${at}, which is not in its domain`);
  }
});

test("early › repair is monotone — no course is ever moved EARLIER than published", () => {
  const shape = shapeOf(4);
  const plan = planOf([["A"], ["B"], ["C"], ["D"]]);
  const plans = ["A", "B", "C", "D"].map((c, i) => named(`c${i}`, [c], wide()));
  const precedence = { before: new Map([["c1", new Set(["c3"])]]), concurrentOk: new Set() };
  const intended = { c0: 0, c1: 1, c2: 2, c3: 3 };
  const { placed } = adoptEarlyTerms({ publishedPlan: plan, shape, plans, precedence });
  for (const [id, at] of placed) assert.ok(at >= intended[id], `${id} moved earlier`);
});

// ── Determinism, and the shape of the answer ───────────────────────

test("early › the same input gives the same answer whatever order cells arrive in", () => {
  // ── With CONTENTION, which is the only case that can differ ────────
  //
  // An earlier version of this test used cells that each matched a distinct course, so
  // reversing the array could not change the answer and it passed over a real defect: the
  // scan ran in `plans` order, so when two cells could both be answered by one course the
  // winner was decided by array position. A change to how `buildDomains` orders cells would
  // then have silently re-planned the first two years of every affected degree.
  //
  // `zzz` is listed FIRST and must still lose to `aaa`, so this fails if the scan ever goes
  // back to reading positions.
  const shape = shapeOf(3);
  const plan = planOf([["X", "B"], ["C"]]);
  const build = () => [
    named("zzz", ["X"], wide()), named("aaa", ["X"], wide()),
    named("b", ["B"], wide()), named("c", ["C"], wide()),
    choice("x-choice", [["X"], ["C"]], wide()),
  ];
  const one = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: build(), precedence: NOPREC });
  const two = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: build().reverse(), precedence: NOPREC });
  assert.deepEqual([...one.placed.entries()].sort(), [...two.placed.entries()].sort());
  assert.equal(one.placed.get("aaa"), 0, "the lowest id claims the contested course");
  assert.ok(!one.placed.has("zzz"), "and the other gets nothing, whatever its position");
});

test("early › junk in, nothing out — never a throw", () => {
  const shape = shapeOf(2);
  const plans = [named("a", ["A"], wide())];
  for (const bad of [null, undefined, {}, { years: null }, { years: [null] },
                     { years: [{ terms: null }] }, { years: [{ terms: [null] }] },
                     { years: [{ terms: [{ entries: null }] }] },
                     { years: [{ terms: [{ type: "fall", entries: [{ options: null }] }] }] }]) {
    const r = adoptEarlyTerms({ publishedPlan: bad, shape, plans, precedence: NOPREC });
    assert.equal(r.placed.size, 0);
    assert.deepEqual(r.moves, []);
  }
  assert.equal(adoptEarlyTerms({}).placed.size, 0);
  assert.equal(adoptEarlyTerms().placed.size, 0);
});

test("early › applying never widens a domain, and never sets one off-domain", () => {
  const plans = [named("a", ["A"], [2, 3]), named("b", ["B"], [0, 1]), open("e", [0, 1, 2])];
  const before = plans.map(p => [...p.domain]);
  const n = applyEarlyTerms(plans, new Map([["a", 3], ["b", 9]]));
  assert.equal(n, 1, "only the placement inside its own domain is applied");
  assert.deepEqual(plans[0].domain, [3]);
  assert.deepEqual(plans[1].domain, before[1], "an off-domain placement is refused, not forced");
  assert.deepEqual(plans[2].domain, before[2], "an untouched cell keeps its whole domain");
  assert.equal(applyEarlyTerms(plans, new Map()), 0);
  assert.equal(applyEarlyTerms(plans, null), 0);
});

test("early › a plan naming nothing we require adopts nothing", () => {
  const shape = shapeOf(2);
  const { placed } = adoptEarlyTerms({
    publishedPlan: planOf([["ZZ9999"]]), shape,
    plans: [named("a", ["A"], wide())], precedence: NOPREC });
  assert.equal(placed.size, 0);
});

// ── Capacity ───────────────────────────────────────────────────────
//
// The third reason a published term does not work, and the one this module shipped without.
// Computer Science and Biology publishes a 20 SH first term against a 19 SH registration
// cap; because the fallback is all-or-nothing, one credit of overshoot discarded the whole
// two years of the department's arrangement and the student got none of it.

/** A named cell carrying credit, for the capacity tests. */
const sized = (id, courses, sh, domain) =>
  ({ cell: { id, kind: "named", groups: [courses], sh }, domain });

test("early › an over-cap LATER term sheds its smallest course, not a real one", () => {
  // Published in term 1, because term 0 is exempt — it carries whatever its department
  // printed. Every later term is held to the cap exactly, and when one is over, taking the
  // courses heaviest-first is what makes the 1 SH seminar leave rather than a 5 SH course.
  // Evicting `big1` to rescue `tiny` is the same repair and a far worse plan.
  const shape = shapeOf(3);
  const plan = planOf([[], ["A", "B", "C", "D", "T"]]);
  const plans = [
    sized("big1", ["A"], 5, wide()), sized("big2", ["B"], 5, wide()),
    sized("big3", ["C"], 5, wide()), sized("big4", ["D"], 4, wide()),
    sized("tiny", ["T"], 1, wide()),
  ];
  const { placed, moves } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC, capOf: () => 19 });
  for (const id of ["big1", "big2", "big3", "big4"]) {
    assert.equal(placed.get(id), 1, `${id} should keep the term its department chose`);
  }
  assert.equal(placed.get("tiny"), 2, "the 1 SH course is what moves");
  assert.deepEqual(moves, [{ cell: "tiny", from: 1, to: 2, why: MOVED_CAPACITY }]);
});

test("early › no term with room anywhere hands the course back, never overfills", () => {
  const shape = shapeOf(2);
  // Published in term 1, so the first-semester exemption does not apply and the cap bites.
  const plan = planOf([[], ["A", "B"]]);
  const plans = [sized("keep", ["A"], 4, wide(4)), sized("evict", ["B"], 4, wide(4))];
  // A cap of 4 fits exactly ONE of them per term, so one has to leave — the claim is not
  // which, it is that the cap is never breached and nothing is silently lost.
  const { placed, unplaced } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC, capOf: () => 4 });
  const load = new Map();
  for (const [id, at] of placed) {
    const sh = plans.find(p => p.cell.id === id).cell.sh;
    load.set(at, (load.get(at) ?? 0) + sh);
  }
  for (const [ti, v] of load) assert.ok(v <= 4, `term ${ti} was fixed at ${v} SH over a cap of 4`);
  assert.equal(placed.size + unplaced.length, 2, "every cell is either fixed or handed back");
});

test("early › capacity never moves a course EARLIER to make room", () => {
  const shape = shapeOf(4);
  const plan = planOf([["A"], ["B", "C"]]);
  const plans = [
    sized("a", ["A"], 4, wide()), sized("b", ["B"], 10, wide()), sized("c", ["C"], 10, wide()),
  ];
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC, capOf: () => 12 });
  assert.equal(placed.get("a"), 0);
  for (const id of ["b", "c"]) {
    const at = placed.get(id);
    if (at != null) assert.ok(at >= 1, `${id} was pulled earlier than its department's term`);
  }
});

test("early › the first semester may carry the overload its department published", () => {
  // The Khoury combined-major shape: 19 SH of real courses plus a 1 SH seminar. Thirteen
  // programs publish exactly this, and capping it at 19 cost every one of them their
  // department's whole first two years.
  const shape = shapeOf(3);
  const plan = planOf([["A", "B", "C", "D", "T"]]);
  const plans = [
    sized("b1", ["A"], 5, wide()), sized("b2", ["B"], 5, wide()),
    sized("b3", ["C"], 5, wide()), sized("b4", ["D"], 4, wide()),
    sized("seminar", ["T"], 1, wide()),
  ];
  const { placed, moves } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  assert.equal(placed.size, 5);
  for (const [, at] of placed) assert.equal(at, 0, "the whole published term is kept");
  assert.deepEqual(moves, [], "nothing needs repairing when the overload is allowed");
});

test("early › a light first term is not PACKED up to its allowance", () => {
  // The allowance raises the ceiling; it must never pull courses in. Term 0 is published at
  // 15 SH and term 1 is heavy and wants somewhere to spill — nothing from term 1 may land in
  // term 0's headroom, because repair only ever moves a course LATER. Getting this wrong
  // would invent a first-semester overload and sign the department's name to it.
  const shape = shapeOf(3);
  const plan = planOf([["A", "B", "C"], ["D", "E", "F", "G"]]);
  const plans = [
    sized("a", ["A"], 5, wide()), sized("b", ["B"], 5, wide()), sized("c", ["C"], 5, wide()),
    sized("d", ["D"], 5, wide()), sized("e", ["E"], 5, wide()),
    sized("f", ["F"], 5, wide()), sized("g", ["G"], 5, wide()),
  ];
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  const inT0 = [...placed.entries()].filter(([, at]) => at === 0)
    .reduce((n, [id]) => n + plans.find(p => p.cell.id === id).cell.sh, 0);
  assert.equal(inT0, 15, `term 0 was fixed at ${inT0} SH; its department published 15`);
});

test("early › the first semester carries whatever its department published, however heavy", () => {
  // The rule is `max(cap + headroom, what the plan asks for)` — a floor, not a ceiling.
  // A department printing a 27 SH first term has told its students to register for it, and
  // refusing to reproduce that is disagreeing with the faculty while showing a worse plan.
  // The student is warned about the load elsewhere; the generator does not overrule it.
  const shape = shapeOf(3);
  const plan = planOf([["A", "B", "C", "D", "E"]]);
  const plans = [
    sized("b1", ["A"], 5, wide()), sized("b2", ["B"], 5, wide()),
    sized("b3", ["C"], 5, wide()), sized("b4", ["D"], 5, wide()),
    sized("b5", ["E"], 7, wide()),
  ];
  const { placed, moves, firstTermCap } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  assert.equal(placed.size, 5, "every published course keeps its first semester");
  for (const [, at] of placed) assert.equal(at, 0);
  assert.deepEqual(moves, [], "nothing is shed from a first semester");
  assert.equal(firstTermCap, 27, "the allowance is the published load, not the cap plus two");
});

test("early › the headroom is a FLOOR — a light first term still gets cap + 2", () => {
  // The other half of `max(...)`. Our decomposition can cost a credit or two more than the
  // printed row when a corequisite partner is merged into a cell, and that must still fit.
  const shape = shapeOf(3);
  const plan = planOf([["A"]]);
  const plans = [sized("a", ["A"], 4, wide())];
  const { firstTermCap } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  assert.equal(firstTermCap, 21, "a 4 SH published term still leaves cap + headroom");
});

test("early › only the FIRST semester is exempt; later terms are held to the cap", () => {
  const shape = shapeOf(3);
  const plan = planOf([[], ["A", "B", "C", "D", "E"]]);   // 27 SH published in term 1
  const plans = [
    sized("b1", ["A"], 5, wide()), sized("b2", ["B"], 5, wide()),
    sized("b3", ["C"], 5, wide()), sized("b4", ["D"], 5, wide()),
    sized("b5", ["E"], 7, wide()),
  ];
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  const inT1 = [...placed.entries()].filter(([, at]) => at === 1)
    .reduce((n, [id]) => n + plans.find(p => p.cell.id === id).cell.sh, 0);
  assert.ok(inT1 <= 19, `term 1 was fixed at ${inT1} SH over a cap of 19`);
});

test("early › a later term gets no overload allowance, however it was published", () => {
  // Measured: no published term past the first has ever exceeded the cap. The allowance is
  // scoped to where the evidence is, and this is the guard on that scope.
  const shape = shapeOf(3);
  const plan = planOf([[], ["A", "B", "C", "D", "T"]]);
  const plans = [
    sized("b1", ["A"], 5, wide()), sized("b2", ["B"], 5, wide()),
    sized("b3", ["C"], 5, wide()), sized("b4", ["D"], 4, wide()),
    sized("seminar", ["T"], 1, wide()),
  ];
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC,
    capOf: () => 19, firstTermHeadroom: 2,
  });
  const inT1 = [...placed.entries()].filter(([, at]) => at === 1)
    .reduce((n, [id]) => n + plans.find(p => p.cell.id === id).cell.sh, 0);
  assert.ok(inT1 <= 19, `term 1 was fixed at ${inT1} SH, over the ordinary cap`);
});

test("early › with no capacity function nothing is capped — the old behaviour", () => {
  const shape = shapeOf(2);
  const plan = planOf([["A", "B", "C"]]);
  const plans = ["A", "B", "C"].map((c, i) => sized(`c${i}`, [c], 99, wide()));
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 3);
  for (const [, at] of placed) assert.equal(at, 0);
});

test("early › a course repeated across terms keeps its EARLIER placement", () => {
  const shape = shapeOf(3);
  const plan = planOf([["A"], ["A"]]);
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [named("a", ["A"], wide())], precedence: NOPREC });
  assert.equal(placed.get("a"), 0, "the earlier copy is what the prereq chain was built around");
});

// ── The published SIZE of a term, not just its contents ────────────
//
// `offers` is flat: "take two of these three" and "one of these three" both arrive as three
// courses with no count attached. The printed SH is the only thing that carries the count.

/** A published plan whose rows have CREDITS: `[[["A",4],["B",4]]]` is one 8 SH fall. */
const sizedPlan = (termRows) => {
  const years = [];
  termRows.forEach((rows, i) => {
    const yi = Math.floor(i / 2);
    years[yi] ??= { terms: [] };
    years[yi].terms.push({
      type: i % 2 === 0 ? "fall" : "spring",
      entries: rows.map(([id, sh]) => ({ sh, options: [[id]] })),
    });
  });
  return { years };
};
const budgeted = (id, courses, domain, sh) =>
  ({ cell: { id, kind: "named", groups: [courses], sh }, domain });

test("early › adoption spends no more credit than the department PRINTED", () => {
  // The department printed 8 SH here. Our degree separately requires all three courses the
  // row offers, at 4 SH each — the Business Administration shape, where a "Take two:" worth
  // 8 SH was adopted as three cells worth 12. Budget is printed + ADOPT_SH_SLACK = 10, so
  // two cells fit and the third does not.
  const shape = shapeOf(2);
  const plan = sizedPlan([[["A", 4], ["B", 4]]]);   // one fall term, 8 SH printed
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, precedence: NOPREC,
    plans: [budgeted("a", ["A"], wide(), 4), budgeted("b", ["B"], wide(), 4), budgeted("c", ["A"], wide(), 4)],
  });
  const inTerm0 = [...placed.values()].filter(t => t === 0).length;
  assert.equal(inTerm0, 2, "a third 4 SH cell was pinned into an 8 SH published term");
});

test("early › a cell that misses the budget is NOT dropped, it is left to the search", () => {
  // Under-adopting costs a hint; over-adopting costs the student a term they cannot
  // register for. The unbudgeted cell must simply be absent from `placed`, never recorded
  // as unplaced or moved — it has a full domain and the ordinary search will site it.
  const shape = shapeOf(2);
  const plan = sizedPlan([[["A", 4]]]);
  const out = adoptEarlyTerms({
    publishedPlan: plan, shape, precedence: NOPREC,
    plans: [budgeted("a", ["A"], wide(), 4), budgeted("b", ["A"], wide(), 4)],
  });
  assert.equal(out.unplaced.length, 0, "a budget miss was reported as an unplaceable cell");
  assert.ok(!out.moves.some(m => m.cell === "b"), "a budget miss was reported as a correction");
});

test("early › a 0 SH cell always fits, whatever the budget", () => {
  // It is a requirement the department put here and it costs the term nothing. Excluding it
  // would drop a real placement for no credit saved.
  const shape = shapeOf(2);
  const plan = sizedPlan([[["A", 1], ["Z", 0]]]);
  const { placed } = adoptEarlyTerms({
    publishedPlan: plan, shape, precedence: NOPREC,
    plans: [budgeted("a", ["A"], wide(), 1), budgeted("z", ["Z"], wide(), 0)],
  });
  assert.equal(placed.get("z"), 0, "a 0 SH cell was refused for want of budget");
});

test("early › publishedLoad is UNCLAMPED — the caller must not let it raise a cap", () => {
  // The 13-plan regression, pinned. `publishedLoad` is printed + slack, and that sum can sit
  // ABOVE the term's own registration cap — a department's 8 SH summer half plus 2 is 10
  // against a 9.5 half-term cap. Applied unclamped it does not lower a ceiling, it RAISES
  // one, and `computer_science_and_biology_bs` shipped a 10 SH summer half because of it.
  //
  // This function deliberately does not know the cap for terms it is not repairing, so the
  // clamp belongs at the call site in `index.js`. What is asserted here is the contract that
  // makes the clamp necessary, so nobody removes it believing this value is already safe.
  const shape = shapeOf(2);
  const plan = sizedPlan([[["A", 9]]]);
  const { publishedLoad } = adoptEarlyTerms({
    publishedPlan: plan, shape, precedence: NOPREC,
    plans: [budgeted("a", ["A"], wide(), 9)],
  });
  assert.ok(publishedLoad.get(0) > 9,
    "publishedLoad should exceed the printed load by the decomposition slack");
});

test("early › publishedLoad is floored by what repair actually placed", () => {
  // Repair may legitimately push a course INTO a later early term to fix a prerequisite. A
  // ceiling below the load we just arranged ourselves would make the search refuse it.
  const shape = shapeOf(2);
  const plan = sizedPlan([[["A", 4]], [["B", 4]]]);
  const { publishedLoad, load } = adoptEarlyTerms({
    publishedPlan: plan, shape, precedence: NOPREC,
    plans: [budgeted("a", ["A"], wide(), 4), budgeted("b", ["B"], wide(), 4)],
  });
  for (const [ti, placedSH] of load) {
    assert.ok((publishedLoad.get(ti) ?? Infinity) >= placedSH,
      `term ${ti}: ceiling ${publishedLoad.get(ti)} is below the ${placedSH} SH repair placed`);
  }
});

// ── Deciding the department's option, and the legality that bounds it ──
//
// A choice cell used to be fixed in TIME and left undecided. That is safe and it is not what
// a student sees: the catalog names PHYS 1161 in Year 1 Fall and we drew "Introductory
// Physics", a placeholder listing four alternatives, for a term the department had resolved.
//
// Deciding it needs a guard the cell's own DOMAIN cannot give. A domain says "some option is
// legal here", because it was computed over every option; pinning one option needs "THIS
// option is legal here". Without that distinction, five plans shipped a course the student
// could not register for.

test("early › the department's branch is adopted when it is legal there", () => {
  const shape = shapeOf(2);
  const plan = planOf([["A"]]);                       // the department names A, not B
  const c = choice("pick", [["A"], ["B"]], wide());
  const { decided } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [c], precedence: NOPREC,
    branchLegalAt: () => true,
  });
  assert.deepEqual(decided.get("pick"), ["A"], "the department's own option was not adopted");
});

test("early › a branch ILLEGAL where it landed is dropped, not pinned", () => {
  // The regression, pinned. `BIOL 1143` in a Year 1 Fall it is not offered in, and
  // `ENGL 1450` where its prerequisites cannot be met. The cell must keep every option so the
  // ordinary search can pick one that works — losing the department's preference and keeping a
  // registrable plan, never the other way round.
  const shape = shapeOf(2);
  const plan = planOf([["A"]]);
  const c = choice("pick", [["A"], ["B"]], wide());
  const out = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [c], precedence: NOPREC,
    branchLegalAt: () => false,
  });
  assert.equal(out.decided.size, 0, "an unregistrable branch was pinned to the plan");
  assert.equal(out.placed.get("pick"), 0, "the cell should still be FIXED in its term");
  assert.deepEqual(c.cell.groups, [["A"], ["B"]], "the cell lost options it must keep");
});

test("early › no legality test supplied means nothing is decided", () => {
  // The default has to be the behaviour that predates this. A caller that cannot answer
  // "is this branch legal there" must not get decisions it cannot vouch for.
  const shape = shapeOf(2);
  const plan = planOf([["A"]]);
  const out = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [choice("pick", [["A"], ["B"]], wide())],
    precedence: NOPREC,
  });
  assert.equal(out.decided.size, 0);
});

test("early › legality is checked where the cell LANDED, not where it was published", () => {
  // Repair may slide a cell later, and a branch legal in the published term is not necessarily
  // legal in the one the cell ends up in. Checking the intended term would approve a decision
  // for a placement that no longer exists. Here A is only available from term 2, so repair
  // moves it there, and the legality question must be asked about term 2.
  const shape = shapeOf(3);
  const plan = planOf([["A"]]);                       // department says term 0
  const asked = [];
  const out = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [choice("pick", [["A"], ["B"]], [2, 3])],
    precedence: NOPREC,
    branchLegalAt: (group, ti) => { asked.push(ti); return true; },
  });
  assert.equal(out.placed.get("pick"), 2, "repair should have moved it to its first legal term");
  assert.deepEqual(asked, [2], "legality was asked about the published term, not the real one");
});

test("early › a genuinely ambiguous row is left to the student", () => {
  // The department named a course from BOTH branches. That is a choice they did not make, and
  // picking one would decide it by option order.
  const shape = shapeOf(2);
  const plan = planOf([["A", "B"]]);                  // both branches named in one term
  const out = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: [choice("pick", [["A"], ["B"]], wide())],
    precedence: NOPREC, branchLegalAt: () => true,
  });
  assert.equal(out.decided.size, 0, "an ambiguous row was decided for the student");
});
