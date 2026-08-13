// CHART's witness, attacked. These are the tests that would have caught the four
// real bugs the first working version shipped with, so each one names the bug.
import test from "node:test";
import assert from "node:assert/strict";
import { witnessPlan, bipartiteMatch, prereqReachable } from "../../src/engine/witness.js";

const term = (semTypeId, label = "") => ({ semTypeId, label, termLabel: label, weight: 1 });
const TERMS = [term("fall", "T0"), term("spring", "T1"), term("fall", "T2"), term("spring", "T3")];

const course = (id, { sh = 4, prereqs = null } = {}) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh, prereqs,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

const named = (id, courses, term_) => ({ id, kind: "named", groups: [courses], sh: 4, term: term_, title: id });
const open = (id, term_, title = id) => ({ id, kind: "open", groups: null, sh: 4, term: term_, title });

const run = (cells, cands, courseMap, extra = {}) => witnessPlan({
  cells, terms: TERMS, courseMap,
  candidatesOf: (c) => (typeof cands === "function" ? cands(c) : cands[c.id] ?? null),
  ...extra,
});

// ── bipartiteMatch ─────────────────────────────────────────────────

test("match › a perfect matching is found when one exists", () => {
  const r = bipartiteMatch([["a", "b"], ["b", "c"], ["c", "a"]]);
  assert.equal(r.size, 3);
  assert.equal(new Set(r.matchOf).size, 3);
});

test("match › Hall violation is detected and the starved cell named", () => {
  // three cells, two courses
  const r = bipartiteMatch([["a", "b"], ["a", "b"], ["a", "b"]]);
  assert.equal(r.size, 2);
  assert.equal(r.unmatched.length, 1);
});

test("match › an empty candidate list cannot be matched", () => {
  const r = bipartiteMatch([[], ["a"]]);
  assert.equal(r.size, 1);
  assert.deepEqual(r.unmatched, [0]);
});

test("match › augmenting reassigns an earlier claim rather than giving up", () => {
  // cell 0 can only take "a"; cell 1 could take "a" or "b". A greedy pass that
  // gave "a" to cell 1 first must be able to push it to "b".
  const r = bipartiteMatch([["a"], ["a", "b"]]);
  assert.equal(r.size, 2);
});

test("match › no duplicate assignments under pressure", () => {
  const adj = Array.from({ length: 12 }, (_, i) => ["x" + (i % 6), "y" + (i % 4)]);
  const r = bipartiteMatch(adj);
  const used = r.matchOf.filter(Boolean);
  assert.equal(new Set(used).size, used.length, "a course was matched twice");
});

// ── prereqReachable: the neutrality rules ──────────────────────────

test("reachable › a ref the catalog does not have is ABSENT, not satisfied", () => {
  // BUG THIS CATCHES: reading a renumbered ref as satisfied let `CS 3100 Or
  // CS 3500` bound at zero and put CS 3100 six terms before CS 2100.
  const cm = mapOf(course("A100"), course("B100"));
  const semIndex = { T0: 0, T1: 1, T2: 2, T3: 3 };
  const tree = [{ subject: "A", number: "100" }, "Or", { subject: "GONE", number: "999" }];
  const c = course("X100", { prereqs: tree });
  // A100 placed early → satisfied via the branch we can read.
  assert.equal(prereqReachable(c, { A100: "T0" }, semIndex, 2, cm), true);
  // A100 absent → the gone branch must NOT rescue it... unless nothing else is
  // claimed either, in which case the whole tree is a no-claim. Here A100 IS a
  // catalog course but is not placed, so it reads as absent too and the tree has
  // no operand at all.
  assert.equal(prereqReachable(c, {}, semIndex, 2, cm), true);
  // A100 placed LATE → a real, permanent violation.
  assert.equal(prereqReachable(c, { A100: "T3" }, semIndex, 2, cm), false);
});

test("reachable › AND is not rescued by an absent branch", () => {
  const cm = mapOf(course("A100"), course("B100"));
  const semIndex = { T0: 0, T1: 1, T2: 2, T3: 3 };
  const c = course("X100", {
    prereqs: [{ subject: "A", number: "100" }, "And", { subject: "B", number: "100" }],
  });
  assert.equal(prereqReachable(c, { A100: "T0", B100: "T0" }, semIndex, 2, cm), true);
  assert.equal(prereqReachable(c, { A100: "T0", B100: "T3" }, semIndex, 2, cm), false);
  // B100 unplaced: no claim about it, so A100 alone decides.
  assert.equal(prereqReachable(c, { A100: "T0" }, semIndex, 2, cm), true);
});

test("reachable › a concurrent ref may share the term; a plain one may not", () => {
  const cm = mapOf(course("A100"));
  const semIndex = { T0: 0, T1: 1 };
  const plain = course("X", { prereqs: [{ subject: "A", number: "100" }] });
  const conc = course("Y", { prereqs: [{ subject: "A", number: "100", concurrent: true }] });
  assert.equal(prereqReachable(plain, { A100: "T1" }, semIndex, 1, cm), false);
  assert.equal(prereqReachable(conc, { A100: "T1" }, semIndex, 1, cm), true);
});

test("reachable › an empty or junk tree is not an unmet prerequisite", () => {
  const cm = mapOf(course("A100"));
  for (const p of [null, [], ["And"], [{}], ["Or"]]) {
    assert.equal(prereqReachable(course("X", { prereqs: p }), {}, {}, 0, cm), true);
  }
});

// ── The named-prereq check ─────────────────────────────────────────

test("witness › a named course placed before its named prerequisite FAILS", () => {
  // BUG THIS CATCHES: named cells were filtered out of the matching (correctly,
  // they are facts) and then never prereq-checked at all, which produced a plan
  // with Calculus 3 in term 0 and Calculus 2 in term 8.
  const cm = mapOf(
    course("A100"),
    course("A200", { prereqs: [{ subject: "A", number: "100" }] }),
  );
  const bad = run([named("c1", ["A200"], 0), named("c2", ["A100"], 1)], {}, cm);
  assert.equal(bad.ok, false);
  assert.equal(bad.failure.kind, "named-prereq");
  assert.equal(bad.failure.course, "A200");

  const good = run([named("c1", ["A100"], 0), named("c2", ["A200"], 1)], {}, cm);
  assert.equal(good.ok, true);
});

test("witness › the named check is skipped for a course the catalog lost", () => {
  const cm = {};      // nothing resolves
  const r = run([named("c1", ["GONE999"], 0)], {}, cm);
  assert.equal(r.ok, true);
});

test("witness › a partial plan does not fail on a prerequisite not placed yet", () => {
  // Soundness of pruning mid-search: A100's cell is absent from this assignment,
  // so it must read as no-claim rather than as late.
  const cm = mapOf(
    course("A100"),
    course("A200", { prereqs: [{ subject: "A", number: "100" }] }),
  );
  const r = run([named("c2", ["A200"], 1)], {}, cm);
  assert.equal(r.ok, true, "pruned a branch a later assignment could have fixed");
});

// ── Distinctness ───────────────────────────────────────────────────

test("witness › two cells in one term cannot take the same only-course", () => {
  const cm = mapOf(course("A100"), course("A200"));
  const r = run([open("o1", 0), open("o2", 0)], { o1: ["A100"], o2: ["A100"] }, cm);
  assert.equal(r.ok, false);
  assert.equal(r.failure.kind, "over-subscribed");
});

test("witness › distinctness holds ACROSS terms, not just within one", () => {
  const cm = mapOf(course("A100"));
  const r = run([open("o1", 0), open("o2", 2)], { o1: ["A100"], o2: ["A100"] }, cm);
  assert.equal(r.ok, false);
});

test("witness › a repeatable course may answer two cells", () => {
  const cm = mapOf(course("A100"));
  const r = run([open("o1", 0), open("o2", 2)], { o1: ["A100"], o2: ["A100"] }, cm,
                { repeatable: (id) => id === "A100" });
  assert.equal(r.ok, true);
});

test("witness › a named course is spent and cannot also answer an open cell", () => {
  const cm = mapOf(course("A100"));
  const r = run([named("n", ["A100"], 0), open("o", 1)], { o: ["A100"] }, cm);
  assert.equal(r.ok, false);
});

// ── Availability ───────────────────────────────────────────────────

test("witness › unknown offering is PERMISSION, not refusal", () => {
  // 40.8% of the catalog has no history. Reading null as "not offered" would make
  // two fifths of it unschedulable.
  const cm = mapOf(course("A100"));
  const r = run([open("o", 0)], { o: ["A100"] }, cm, { offeringProbability: () => null });
  assert.equal(r.ok, true);
});

// The season bar is now ONE decision, made by the `offered` port and not re-derived
// here from a probability.
//
// It used to be `offeringProbability(...) !== 0` — a course was barred only from a
// season it had never once run in. The APP flags a course offered in half or fewer of
// the recorded instances of a season, so the two layers disagreed, and CHART emitted
// plans the app itself marked `offered?`: `CS 3800`, recorded in Summer B once in four
// years, was placed in a Summer B. This test asserted the weaker rule, so it passed
// throughout.
//
// The judgement moved into the port (`enginePorts.offered` → `effectiveOffered`, the
// app's own), which is the only way the two cannot drift. What the witness owes is that
// it asks, and abides by the answer.
test("witness › the season bar is exactly what the `offered` port says", () => {
  const cm = mapOf(course("A100"));
  const never = run([open("o", 0)], { o: ["A100"] }, cm,
    { offered: (id, s) => s !== "fall" });
  assert.equal(never.ok, false, "a term the port calls unoffered must not be used");

  const fine = run([open("o", 0)], { o: ["A100"] }, cm, { offered: () => true });
  assert.equal(fine.ok, true);
});

test("witness › the raw probability does not decide legality", () => {
  // A 1% chance and a 99% chance are the same LEGAL answer; the difference is the
  // robustness objective's business. Passing a probability alone must not bar a term,
  // or the old weaker rule would be back by a side door.
  const cm = mapOf(course("A100"));
  const rare = run([open("o", 0)], { o: ["A100"] }, cm,
    { offeringProbability: () => 0.01, offered: () => true });
  assert.equal(rare.ok, true, "a low probability is a risk, not an illegality");

  const zeroProbButOffered = run([open("o", 0)], { o: ["A100"] }, cm,
    { offeringProbability: () => 0, offered: () => true });
  assert.equal(zeroProbButOffered.ok, true,
    "the witness must consult `offered`, never re-derive it from the probability");
});

test("witness › the season bar is NEVER relaxed", () => {
  // There used to be an escape hatch: a cell whose every candidate was barred from
  // every term the plan uses had availability waived and was placed anyway. It
  // produced 3 season violations the departments' own plans did not have, in the one
  // dimension where our data is better than theirs.
  //
  // Availability is the constraint that never gives way. Where the shape leaves a
  // cell nowhere legal, the SHAPE yields — `shape.studyTerms` marks the terms a
  // published plan leaves empty as optional rather than excluded, and the search
  // tries them last. Overriding "the department leaves this summer blank" is a much
  // smaller liberty than overriding "this course has never run in the spring".
  const cm = mapOf(course("A100"));
  const cells = [{ ...open("o", 0), availabilityRelaxed: true }];
  const r = run(cells, { o: ["A100"] }, cm, { offered: () => false });
  assert.equal(r.ok, false, "a stale relaxation flag must not reopen the hatch");
  assert.equal(r.failure.kind, "no-candidate");
});

// ── The two meanings of null ───────────────────────────────────────

test("witness › a null candidate list means ANY course, and picks a real one", () => {
  const cm = mapOf(course("A100"), course("B100"));
  const r = run([open("o", 0)], { o: null }, cm);
  assert.equal(r.ok, true);
  assert.ok(cm[r.witness.get("o")], "witnessed a course the catalog does not have");
});

test("witness › a WIDE bounded cell is answered from its OWN candidates", () => {
  // BUG THIS CATCHES: `seasonOk` used null for both "admits anything" and "this
  // list got long", so a 247-candidate Khoury Electives cell was answered with the
  // first course in the catalog — ineligible, and then entered into the placement
  // set where other cells' prerequisites were checked against it.
  const cm = mapOf(...Array.from({ length: 60 }, (_, i) => course(`Z${1000 + i}`)),
                   course("ELIGIBLE1"), course("ELIGIBLE2"));
  const r = run([open("o", 0)], { o: ["ELIGIBLE1", "ELIGIBLE2"] }, cm);
  assert.equal(r.ok, true);
  assert.ok(["ELIGIBLE1", "ELIGIBLE2"].includes(r.witness.get("o")),
    `witnessed ${r.witness.get("o")}, which is not a candidate of the cell`);
});

test("witness › a wide cell does not spend a course a narrow cell needs", () => {
  // The contention heuristic. Without it, an early elective took the only course a
  // later specific cell could use and the plan read as infeasible.
  const cm = mapOf(course("SHARED"), course("SPARE1"), course("SPARE2"));
  const cells = [open("wide", 0), open("narrow", 2)];
  const cands = { wide: ["SHARED", "SPARE1", "SPARE2"], narrow: ["SHARED"] };
  const r = run(cells, cands, cm, { contention: (id) => (id === "SHARED" ? 2 : 1) });
  assert.equal(r.ok, true, "the wide cell stole the narrow cell's only course");
  assert.equal(r.witness.get("narrow"), "SHARED");
});

// ── Determinism ────────────────────────────────────────────────────

test("witness › the same input witnesses the same courses every time", () => {
  const cm = mapOf(...Array.from({ length: 30 }, (_, i) => course(`C${2000 + i}`)));
  const cells = [open("a", 0), open("b", 0), open("c", 1)];
  const cands = { a: null, b: null, c: null };
  const first = run(cells, cands, cm).witness;
  for (let i = 0; i < 5; i++) {
    const again = run(cells, cands, cm).witness;
    assert.deepEqual([...again].sort(), [...first].sort());
  }
});

// ── Degenerate inputs ──────────────────────────────────────────────

test("witness › an empty plan is vacuously feasible", () => {
  assert.equal(run([], {}, {}).ok, true);
});

test("witness › a cell with no candidates at all fails, and says which", () => {
  const r = run([open("o", 1, "Nothing Fits")], { o: [] }, mapOf(course("A100")));
  assert.equal(r.ok, false);
  assert.equal(r.failure.kind, "no-candidate");
  assert.equal(r.failure.title, "Nothing Fits");
});

test("witness › malformed cells do not throw", () => {
  const cm = mapOf(course("A100"));
  for (const cells of [
    [{ id: "x", kind: "named", groups: null, term: 0 }],
    [{ id: "x", kind: "named", groups: [[]], term: 0 }],
    [{ id: "x", kind: "choice", groups: [["A100"]], term: 0 }],
    [{ id: "x", kind: "open", term: 0 }],
  ]) {
    assert.doesNotThrow(() => run(cells, { x: ["A100"] }, cm), JSON.stringify(cells));
  }
});

// ── ∀ option, ∃ a filling ──────────────────────────────────────────
//
// The student picks ONE concentration. A matching drawn from the union of every option proves
// a filling nobody can perform, and that is what the corpus was doing in 21 of 77 plans: three
// cells in a term answered by courses from three different, pairwise-disjoint concentrations.
// Each test below is that defect or a way of over-correcting it.

const CONC_CM = mapOf(
  course("AAA1"), course("AAA2"), course("BBB1"), course("BBB2"), course("CCC1"),
);
// Two disjoint concentrations, exactly as the real pools are.
const POOLS = [
  { title: "Alpha", ids: ["AAA1", "AAA2"] },
  { title: "Beta", ids: ["BBB1", "BBB2"] },
];
const conc = (id, term_, pools = POOLS) =>
  ({ ...open(id, term_, "Concentration"), target: "~concentration", optionPools: pools });

test("witness › THE BUG: two cells filled from two DIFFERENT concentrations is not a filling", () => {
  // Union candidates offer AAA1 and BBB1 — a perfect matching, and useless: no student is in
  // both concentrations. Per option only ONE course is available, so two cells cannot stand.
  const cells = [conc("c0", 0), conc("c1", 0)];
  const cands = { c0: ["AAA1", "BBB1"], c1: ["AAA1", "BBB1"] };
  const r = run(cells, cands, CONC_CM);
  assert.equal(r.ok, false, "the union matched two cells no single concentration can answer");
  assert.equal(r.failure.kind, "concentration-unfillable");
  assert.ok(["Alpha", "Beta"].includes(r.failure.option), "the failing option is named");
  // The mechanism underneath is still reported, so the message can say WHY.
  assert.ok(["over-subscribed", "no-candidate"].includes(r.failure.via));
});

test("witness › and it PASSES when every option really can answer both cells", () => {
  const cells = [conc("c0", 0), conc("c1", 0)];
  const cands = { c0: ["AAA1", "AAA2", "BBB1", "BBB2"], c1: ["AAA1", "AAA2", "BBB1", "BBB2"] };
  assert.equal(run(cells, cands, CONC_CM).ok, true);
});

test("witness › distinctness is per option ACROSS terms, not just within one", () => {
  // One cell in term 0 and one in term 2. Alpha has two courses and survives; Beta is given
  // one, so its second cell has nothing left however far apart the terms are.
  const pools = [{ title: "Alpha", ids: ["AAA1", "AAA2"] }, { title: "Beta", ids: ["BBB1"] }];
  const cells = [conc("c0", 0, pools), conc("c1", 2, pools)];
  const cands = { c0: ["AAA1", "AAA2", "BBB1"], c1: ["AAA1", "AAA2", "BBB1"] };
  const r = run(cells, cands, CONC_CM);
  assert.equal(r.ok, false);
  assert.equal(r.failure.option, "Beta");
});

test("witness › SEASON is quantified too, which no prereq-depth bound could see", () => {
  // The measured `architectural_studies_and_business_administration` case: two concentration
  // cells in a summer half-term where the tightest option runs exactly one course that season.
  // Nothing about prerequisites is wrong here, so a capacity vector read off prereq depth
  // permits it — the constraint is availability, and only the witness checks all of them.
  const cells = [conc("c0", 0), conc("c1", 0)];
  const cands = { c0: ["AAA1", "AAA2", "BBB1", "BBB2"], c1: ["AAA1", "AAA2", "BBB1", "BBB2"] };
  const offered = (id, season) => season !== "fall" || id === "AAA1" || id.startsWith("BBB");
  const r = run(cells, cands, CONC_CM, { offered });     // TERMS[0] is fall
  assert.equal(r.ok, false);
  assert.equal(r.failure.option, "Alpha", "only AAA1 runs in the fall, so Alpha cannot fill two");
});

test("witness › a TRUNCATED candidate list is never intersected with an option pool", () => {
  // The propagator passes a truncated list, and intersecting it with one option's pool would
  // report a false infeasibility — pruning a feasible branch silently, which is the failure the
  // soundness note in witness.js exists to prevent. Here the truncation happens to have kept
  // only Alpha's courses; with `candidatesComplete: false` that must NOT condemn Beta.
  const cells = [conc("c0", 0), conc("c1", 0)];
  const cands = { c0: ["AAA1", "AAA2"], c1: ["AAA1", "AAA2"] };
  assert.equal(run(cells, cands, CONC_CM, { candidatesComplete: false }).ok, true);
  // …and with the complete list the same shape is condemned, so the flag is doing the work
  // rather than the check being absent.
  assert.equal(run(cells, cands, CONC_CM).ok, false);
});

test("witness › cells without option pools are untouched by the quantifier", () => {
  // A general elective beside a concentration cell must not be restricted to the concentration.
  const cells = [conc("c0", 0), open("g0", 0, "General Elective")];
  const cands = { c0: ["AAA1", "AAA2", "BBB1", "BBB2"], g0: ["CCC1"] };
  const r = run(cells, cands, CONC_CM);
  assert.equal(r.ok, true);
  assert.equal(r.witness.get("g0"), "CCC1");
});

test("witness › a resolved pick carries no pools, so nothing is over-constrained", () => {
  // With a concentration chosen the cell's candidates ARE that option's courses and there is
  // no disjunction left. `optionPools` is null then, and the witness must behave exactly as it
  // did before — two cells over two courses is a perfect matching.
  const cells = [{ ...open("c0", 0, "Concentration"), optionPools: null },
                 { ...open("c1", 0, "Concentration"), optionPools: null }];
  const cands = { c0: ["AAA1", "AAA2"], c1: ["AAA1", "AAA2"] };
  assert.equal(run(cells, cands, CONC_CM).ok, true);
});

test("witness › an option that admits ANY course restricts to its own pool, not the catalog", () => {
  const cells = [conc("c0", 0)];
  const r = run(cells, () => null, CONC_CM);   // null = admits anything
  assert.equal(r.ok, true);
  assert.ok(["AAA1", "AAA2", "BBB1", "BBB2"].includes(r.witness.get("c0")),
            "a concentration cell was answered from outside every concentration");
});
