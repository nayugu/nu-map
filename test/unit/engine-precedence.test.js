// CHART's precedence derivation, attacked.
//
// This is the module that turned a 20,000-node exhaustive search into a few dozen
// nodes, and the one whose rules are easiest to get subtly wrong: an edge asserted
// where none exists forbids a legal plan, and an edge missed lets a plan schedule
// a course before its prerequisite.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPrecedence, criticalPath, precedenceViolations } from "../../src/engine/precedence.js";

const ref = (subject, number, extra = {}) => ({ subject, number, ...extra });
const course = (id, prereqs = null, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh, prereqs,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

const named = (id, courses, target = 0) =>
  ({ id, kind: "named", groups: [courses], sh: 4, target, title: id });
const choice = (id, groups, target = 0) =>
  ({ id, kind: "choice", groups, sh: 4, target, title: id });
const open = (id, keys, target = 0) => ({
  id, kind: "open", groups: null, sh: 4, target, title: id,
  spec: { keys: new Set(keys), ranges: [] },
});
const wideOpen = (id, target = 0) =>
  ({ id, kind: "open", groups: null, sh: 4, target, title: id, spec: null });

const edgesOf = (p, id) => [...(p.before.get(id) ?? [])].sort();

// ── The basic edge ─────────────────────────────────────────────────

test("precedence › B after A when B's only prerequisite is A", () => {
  const cm = mapOf(course("A100"), course("A200", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.deepEqual(edgesOf(p, "b"), ["a"]);
  assert.deepEqual(edgesOf(p, "a"), []);
  assert.deepEqual([...p.after.get("a")], ["b"]);
});

test("precedence › NO edge when the plan offers another way to satisfy it", () => {
  // `A200` requires `A100 Or B100` and the plan names both. Neither is required,
  // so asserting either edge would forbid a legal plan.
  const cm = mapOf(course("A100"), course("B100"),
                   course("A200", [ref("A", "100"), "Or", ref("B", "100")]));
  const p = buildPrecedence(
    [named("a", ["A100"]), named("b", ["B100"]), named("c", ["A200"])], cm);
  assert.deepEqual(edgesOf(p, "c"), []);
});

test("precedence › an edge DOES hold when only one OR branch is in the plan", () => {
  const cm = mapOf(course("A100"),
                   course("A200", [ref("A", "100"), "Or", ref("GONE", "999")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.deepEqual(edgesOf(p, "b"), ["a"], "the branch we can read is the one that decides");
});

test("precedence › AND requires BOTH predecessors", () => {
  const cm = mapOf(course("A100"), course("B100"),
                   course("C300", [ref("A", "100"), "And", ref("B", "100")]));
  const p = buildPrecedence(
    [named("a", ["A100"]), named("b", ["B100"]), named("c", ["C300"])], cm);
  assert.deepEqual(edgesOf(p, "c"), ["a", "b"]);
});

test("precedence › a course is never its own predecessor", () => {
  const cm = mapOf(course("A100", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"])], cm);
  assert.deepEqual(edgesOf(p, "a"), []);
});

test("precedence › a co-requisite group's members do not gate each other", () => {
  const cm = mapOf(course("A100"), course("A101", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100", "A101"])], cm);
  assert.deepEqual(edgesOf(p, "a"), []);
});

// ── Concurrency ────────────────────────────────────────────────────

test("precedence › a concurrent prerequisite may share the term", () => {
  const cm = mapOf(course("A100"),
                   course("A200", [ref("A", "100", { concurrent: true })]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.deepEqual(edgesOf(p, "b"), ["a"]);
  assert.ok(p.concurrentOk.has("a|b"), "a concurrent ref must allow the same term");
  // ...and the violation check honours it.
  assert.equal(precedenceViolations(p, new Map([["a", 2], ["b", 2]])).length, 0);
  assert.equal(precedenceViolations(p, new Map([["a", 3], ["b", 2]])).length, 1);
});

test("precedence › a plain prerequisite may NOT share the term", () => {
  const cm = mapOf(course("A100"), course("A200", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.equal(p.concurrentOk.has("a|b"), false);
  assert.equal(precedenceViolations(p, new Map([["a", 2], ["b", 2]])).length, 1);
  assert.equal(precedenceViolations(p, new Map([["a", 1], ["b", 2]])).length, 0);
});

// ── Choice cells as successors: "holds under every option" ─────────

test("precedence › a CHOICE cell gets an edge only if EVERY option needs it", () => {
  // BUG THIS CATCHES: precedence covered named cells only, so `CS 4300 or CS 4100`
  // was placed before CS 3100 and only the final witness noticed — 20,000 nodes late.
  const cm = mapOf(
    course("A100"),
    course("X400", [ref("A", "100")]),
    course("Y400", [ref("A", "100")]),
    course("Z400"),                              // needs nothing
  );
  const both = buildPrecedence(
    [named("a", ["A100"]), choice("c", [["X400"], ["Y400"]])], cm);
  assert.deepEqual(edgesOf(both, "c"), ["a"], "both options need A100");

  const escapable = buildPrecedence(
    [named("a", ["A100"]), choice("c", [["X400"], ["Z400"]])], cm);
  assert.deepEqual(edgesOf(escapable, "c"), [],
    "Z400 needs nothing, so the student can avoid the dependency");
});

test("precedence › a small OPEN pool is a successor; a wide one is not", () => {
  const cm = mapOf(course("A100"), course("P500", [ref("A", "100")]),
                   course("Q500", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), open("o", ["P500", "Q500"])], cm);
  assert.deepEqual(edgesOf(p, "o"), ["a"]);

  const wide = buildPrecedence([named("a", ["A100"]), wideOpen("w")], cm);
  assert.deepEqual([...(wide.before.get("w") ?? [])], [],
    "a cell that admits any course can never require anything");
});

test("precedence › only a NAMED cell can be a predecessor", () => {
  // A choice cell's answer is undecided, so nothing can be relied on to come from it.
  const cm = mapOf(course("A100"), course("B100"),
                   course("C300", [ref("A", "100"), "And", ref("B", "100")]));
  const p = buildPrecedence(
    [choice("ch", [["A100"], ["B100"]]), named("c", ["C300"])], cm);
  assert.deepEqual(edgesOf(p, "c"), []);
});

// ── Plan-relative depth ────────────────────────────────────────────

test("planDepth › counts only the courses the plan schedules", () => {
  // A200 requires A100; catalog-wide A200 might be depth 0 through an OR the plan
  // does not contain. Within the plan it is depth 1.
  const cm = mapOf(course("A100"), course("A200", [ref("A", "100")]),
                   course("A300", [ref("A", "200")]));
  const p = buildPrecedence(
    [named("a", ["A100"]), named("b", ["A200"]), named("c", ["A300"])], cm);
  assert.equal(p.planDepthOf("A100"), 0);
  assert.equal(p.planDepthOf("A200"), 1);
  assert.equal(p.planDepthOf("A300"), 2);
});

test("planDepth › a prerequisite outside the plan costs nothing", () => {
  const cm = mapOf(course("OUT100"), course("A200", [ref("OUT", "100")]));
  const p = buildPrecedence([named("b", ["A200"])], cm);
  assert.equal(p.planDepthOf("A200"), 0);
});

test("planDepth › a concurrent ref costs no depth of its own", () => {
  const cm = mapOf(course("A100"),
                   course("A200", [ref("A", "100", { concurrent: true })]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.equal(p.planDepthOf("A200"), 0, "it may sit in the same term");
});

test("planDepth › a prereq CYCLE terminates and does not run away", () => {
  const cm = mapOf(course("A100", [ref("A", "200")]), course("A200", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.ok(Number.isFinite(p.planDepthOf("A100")));
  assert.ok(p.planDepthOf("A100") < 24);
});

test("planDepth › a long chain is bounded by the cap", () => {
  const cs = [];
  for (let i = 0; i < 60; i++) {
    cs.push(course(`L${1000 + i}`, i ? [ref("L", String(1000 + i - 1))] : null));
  }
  const cm = mapOf(...cs);
  const p = buildPrecedence(cs.map((c, i) => named(`c${i}`, [c.id])), cm);
  assert.ok(p.planDepthOf("L1059") <= 24);
});

test("planDepth › is deterministic across runs, including inside a cycle", () => {
  const cm = mapOf(course("A100", [ref("A", "200")]), course("A200", [ref("A", "100")]),
                   course("A300", [ref("A", "100")]));
  const cells = [named("a", ["A100"]), named("b", ["A200"]), named("c", ["A300"])];
  const first = ["A100", "A200", "A300"].map(id => buildPrecedence(cells, cm).planDepthOf(id));
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(["A100", "A200", "A300"].map(id => buildPrecedence(cells, cm).planDepthOf(id)), first);
  }
});

// ── Unscheduled prerequisites: reported, never enforced ────────────

test("precedence › a prerequisite the plan never schedules is REPORTED", () => {
  const cm = mapOf(course("OUT100"), course("A200", [ref("OUT", "100")]));
  const p = buildPrecedence([named("b", ["A200"])], cm);
  assert.deepEqual(p.unscheduledPrereqs, [{ cell: "b", course: "A200", needs: ["OUT100"] }]);
});

test("precedence › an OR with one planned branch is NOT reported as a gap", () => {
  const cm = mapOf(course("A100"), course("OUT100"),
                   course("A200", [ref("A", "100"), "Or", ref("OUT", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.deepEqual(p.unscheduledPrereqs, []);
});

// ── The critical path ──────────────────────────────────────────────

const planOf = (cell, domain, minDepth = 0) => ({ cell, domain, candidates: [], minDepth });

test("critical › a chain pushes each successor one term later", () => {
  const cm = mapOf(course("A100"), course("A200", [ref("A", "100")]),
                   course("A300", [ref("A", "200")]));
  const cells = [named("a", ["A100"]), named("b", ["A200"]), named("c", ["A300"])];
  const p = buildPrecedence(cells, cm);
  const plans = cells.map(c => planOf(c, [0, 1, 2, 3]));
  const { earliest, latest, impossible } = criticalPath(plans, p);
  assert.equal(earliest.get("a"), 0);
  assert.equal(earliest.get("b"), 1);
  assert.equal(earliest.get("c"), 2);
  assert.equal(latest.get("a"), 1, "a must leave room for b and c");
  assert.deepEqual(impossible, []);
});

test("critical › a chain longer than the plan is caught in ONE pass", () => {
  // BUG THIS CATCHES: bioengineering burned the whole 20,000-node budget and
  // reported NOTHING, because every branch was cut by capacity or precedence and
  // neither records a witness failure.
  const cs = [course("A100"), course("A200", [ref("A", "100")]),
              course("A300", [ref("A", "200")]), course("A400", [ref("A", "300")])];
  const cm = mapOf(...cs);
  const cells = cs.map((c, i) => named(`c${i}`, [c.id]));
  const p = buildPrecedence(cells, cm);
  const plans = cells.map(c => planOf(c, [0, 1]));    // only two terms for four cells
  const { impossible } = criticalPath(plans, p);
  assert.ok(impossible.length, "a four-cell chain cannot fit two terms");
  assert.equal(impossible[0].reason, "prereq-chain-longer-than-plan");
});

test("critical › a precedence cycle terminates rather than recursing forever", () => {
  const cm = mapOf(course("A100", [ref("A", "200")]), course("A200", [ref("A", "100")]));
  const cells = [named("a", ["A100"]), named("b", ["A200"])];
  const p = buildPrecedence(cells, cm);
  const plans = cells.map(c => planOf(c, [0, 1, 2]));
  assert.doesNotThrow(() => criticalPath(plans, p));
});

test("critical › an empty domain is reported, not silently bounded", () => {
  const cm = mapOf(course("A100"));
  const cells = [named("a", ["A100"])];
  const p = buildPrecedence(cells, cm);
  const { earliest } = criticalPath([planOf(cells[0], [])], p);
  assert.equal(earliest.get("a") ?? null, null);
});

test("critical › a concurrent edge does not consume a term", () => {
  const cm = mapOf(course("A100"),
                   course("A200", [ref("A", "100", { concurrent: true })]));
  const cells = [named("a", ["A100"]), named("b", ["A200"])];
  const p = buildPrecedence(cells, cm);
  const { earliest } = criticalPath(cells.map(c => planOf(c, [0, 1, 2])), p);
  assert.equal(earliest.get("b"), 0);
});

// ── Violations ─────────────────────────────────────────────────────

test("violations › an unplaced cell cannot be in violation", () => {
  const cm = mapOf(course("A100"), course("A200", [ref("A", "100")]));
  const p = buildPrecedence([named("a", ["A100"]), named("b", ["A200"])], cm);
  assert.equal(precedenceViolations(p, new Map([["b", 0]])).length, 0);
  assert.equal(precedenceViolations(p, new Map()).length, 0);
});

// ── Degenerate input ───────────────────────────────────────────────

test("precedence › malformed cells and courses do not throw", () => {
  const cm = mapOf(course("A100"));
  const shapes = [
    [], [named("a", [])], [named("a", ["GONE"])],
    [{ id: "x", kind: "named", groups: null, sh: 4, target: 0, title: "x" }],
    [{ id: "x", kind: "choice", groups: [], sh: 4, target: 0, title: "x" }],
    [{ id: "x", kind: "open", groups: null, spec: { keys: new Set(), ranges: [] }, sh: 4, target: 0, title: "x" }],
    [{ id: "x", kind: "open", groups: null, sh: 4, target: 0, title: "x" }],
  ];
  for (const cells of shapes) {
    assert.doesNotThrow(() => {
      const p = buildPrecedence(cells, cm);
      criticalPath(cells.map(c => planOf(c, [0, 1])), p);
    }, JSON.stringify(cells.map(c => c.id)));
  }
});
