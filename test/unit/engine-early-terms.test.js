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

test("early › a course with no legal term at or after is handed back, never forced", () => {
  const shape = shapeOf(3);
  const plan = planOf([[], ["A"]]);            // department says term 1
  const plans = [named("a", ["A"], [0])];       // only term 0 is legal — earlier, not later
  const { placed, unplaced } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC });
  assert.equal(placed.size, 0, "never moved EARLIER to manufacture a fit");
  assert.deepEqual(unplaced, [{ cell: "a", from: 1 }]);
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
  const shape = shapeOf(3);
  const plan = planOf([["A", "B"], ["C"]]);
  const build = () => [
    named("a", ["A"], wide()), named("b", ["B"], wide()), named("c", ["C"], wide()),
    choice("x", [["A"], ["C"]], wide()),
  ];
  const one = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: build(), precedence: NOPREC });
  const two = adoptEarlyTerms({
    publishedPlan: plan, shape, plans: build().reverse(), precedence: NOPREC });
  assert.deepEqual([...one.placed.entries()].sort(), [...two.placed.entries()].sort());
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

test("early › an over-cap term sheds its SMALLEST course, not a real one", () => {
  // The exact CS+Bio shape: four 5 SH cells and a 1 SH seminar against a 19 SH cap.
  // Evicting `big4` to rescue `tiny` is the same repair and a far worse plan.
  const shape = shapeOf(3);
  const plan = planOf([["A", "B", "C", "D", "T"]]);
  const plans = [
    sized("big1", ["A"], 5, wide()), sized("big2", ["B"], 5, wide()),
    sized("big3", ["C"], 5, wide()), sized("big4", ["D"], 4, wide()),
    sized("tiny", ["T"], 1, wide()),
  ];
  const { placed, moves } = adoptEarlyTerms({
    publishedPlan: plan, shape, plans, precedence: NOPREC, capOf: () => 19 });
  for (const id of ["big1", "big2", "big3", "big4"]) {
    assert.equal(placed.get(id), 0, `${id} should keep the term its department chose`);
  }
  assert.equal(placed.get("tiny"), 1, "the 1 SH course is what moves");
  assert.deepEqual(moves, [{ cell: "tiny", from: 0, to: 1, why: MOVED_CAPACITY }]);
});

test("early › no term with room anywhere hands the course back, never overfills", () => {
  const shape = shapeOf(2);
  const plan = planOf([["A", "B"]]);
  const plans = [sized("keep", ["A"], 4, wide(4)), sized("evict", ["B"], 4, wide(4))];
  // A cap of 4 fits exactly ONE of them per term. Both are published in term 0, so one has
  // to leave — the claim is not which, it is that the cap is never breached and nothing is
  // silently lost.
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
