// UNIT · src/engine/attributePlacement.js — "a course carrying this designation belongs here".
//
// A registrar publishes designations and some carry a positional convention nothing else in the
// plan encodes. This module applies them LAST: every hard constraint, ranked objective and the
// threshold repair have settled, and it asks one question per rule about the finished plan.
//
// The engine holds the rule GRAMMAR and no institution: not one NUPath code appears in it. The
// codes live in `src/adapters/northeastern/chartCalibration.js`. So these tests split in two —
// most exercise the grammar with invented codes, and one asserts the shipped Northeastern rules
// are all of a kind the grammar understands, because a rule that stops applying because someone
// renamed a key is invisible in every corpus metric.
//
// The case it was built for: `computer_science_and_physics` put `ENGW 3302 or 3307 or 3315`
// (NUPath `WD`) in Year 2 Spring, study term 5 of 9, with the first co-op starting that summer.
// `reclaimFromFiller` would refuse to PULL it there — it reads the same corpus positions as a
// floor — but the search placed it there and nothing removed it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAttributePlacement, cellCarries, ruleFloor, ANCHORS, PARTNERS,
} from "../../src/engine/attributePlacement.js";
import chartCalibration from "../../src/adapters/northeastern/chartCalibration.js";

const MARK = "ZZ";                       // an invented designation: the grammar is institution-free
const GENERAL = "~general";
const RULE = { attribute: MARK, notBefore: ANCHORS.FIRST_WORK, swapWith: PARTNERS.GENERAL_ELECTIVE };

const course = (id, attrs = [], sh = 4) => ({ id, sh, attributes: attrs });
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

const cell = (id, groups, { sh = 4, target = 1, domain = null } = {}) => ({
  cell: { id, kind: groups.length > 1 ? "choice" : "named", groups, sh, title: id, target },
  candidates: groups.flat(), domain,
});
/** A general elective — names nothing, which is what makes it the right partner. */
const ge = (id, { sh = 4, domain = null } = {}) => ({
  cell: { id, kind: "open", groups: null, sh, title: "General Elective", target: GENERAL },
  candidates: null, domain,
});

const TERMS = Array.from({ length: 10 }, (_, i) => ({ label: `T${i}`, weight: 1, targetSH: 16 }));
const ALL = TERMS.map((_, i) => i);

const run = (termOf, plans, courseMap, extra = {}) => {
  const withDomains = plans.map(p => ({ ...p, domain: p.domain ?? ALL }));
  return applyAttributePlacement(new Map(termOf), {
    plans: withDomains, terms: TERMS, boundary: 5, courseMap,
    rules: [RULE], generalElectiveTarget: GENERAL, electiveCeiling: 2,
    ...extra,
  });
};

// ── The grammar ────────────────────────────────────────────────────

test("attr placement › a designated cell before the anchor swaps with an elective after it", () => {
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const out = run([["w", 3], ["g", 7]], [cell("w", [["MARKED3302"]]), ge("g")], courseMap);
  assert.equal(out.moves, 1);
  assert.equal(out.termOf.get("w"), 7, "the designated course should have moved after the anchor");
  assert.equal(out.termOf.get("g"), 3, "and the elective takes its place");
  assert.deepEqual(out.applied, [{ attribute: MARK, course: "w", from: 3, to: 7, floor: 5 }]);
});

test("attr placement › a cell already after the anchor is left alone", () => {
  // `notBefore` is a bound, not a target. A cell at 6 with the anchor at 5 belongs there and must
  // not be shuffled further just because a later elective exists.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const out = run([["w", 6], ["g", 9]], [cell("w", [["MARKED3302"]]), ge("g")], courseMap);
  assert.equal(out.moves, 0);
});

test("attr placement › the EARLIEST elective after the anchor wins, not the latest", () => {
  // A swap moves two cells, so "as far as possible" — right for a capstone, whose convention is
  // the end of the plan — is wrong for a `notBefore` rule: it strands the designated course at
  // the end AND drags an elective all the way forward to pay for it.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const plans = [cell("w", [["MARKED3302"]]), ge("late"), ge("soon"), ge("before")];
  const out = run([["w", 2], ["late", 9], ["soon", 5], ["before", 1]], plans, courseMap);
  assert.equal(out.termOf.get("w"), 5, "took a later elective than it needed to");
  assert.equal(out.termOf.get("late"), 9);
  assert.equal(out.termOf.get("before"), 1, "an elective BEFORE the anchor is not a partner");
});

test("attr placement › EVERY option must carry the designation", () => {
  // A cell offering the designation OR something else does not deliver it, because the student may
  // take the other branch. Same `∀ option` reading the engine uses for credit and competencies.
  const mixed = mapOf(course("MARKED3302", [MARK]), course("PLAIN2000", []));
  const one = run([["w", 3], ["g", 7]],
    [cell("w", [["MARKED3302"], ["PLAIN2000"]]), ge("g")], mixed);
  assert.equal(one.moves, 0, "one undesignated branch means the cell is not designated");

  const both = mapOf(course("MARKED3302", [MARK]), course("MARKED3315", [MARK]));
  const all = run([["w", 3], ["g", 7]],
    [cell("w", [["MARKED3302"], ["MARKED3315"]]), ge("g")], both);
  assert.equal(all.moves, 1, "every branch designated means the student gets it either way");
});

test("attr placement › only the declared PARTNER type is acceptable", () => {
  // A real requirement dragged earlier is a sequencing cost this pass has no licence to pay — the
  // level band and the corpus floor exist to prevent exactly that elsewhere. An elective names
  // nothing, so moving it costs the student nothing and it cannot itself be "too early".
  const courseMap = mapOf(course("MARKED3302", [MARK]), course("REAL4305", []));
  const out = run([["w", 3], ["real", 7]],
    [cell("w", [["MARKED3302"]]), cell("real", [["REAL4305"]], { target: 2 })], courseMap);
  assert.equal(out.moves, 0, "a real requirement was pulled forward to seat the designated course");
});

test("attr placement › the swap must be load-NEUTRAL: same credit, same registrations", () => {
  // This is what licenses skipping every load-based bound. A 4 SH cell trading with a 2 SH
  // elective changes two terms' credit, the four-course floor and the full-time threshold — all
  // already settled by the passes above, none of them re-checked here.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const small = run([["w", 3], ["g", 7]],
    [cell("w", [["MARKED3302"]], { sh: 4 }), ge("g", { sh: 2 })], courseMap);
  assert.equal(small.moves, 0, "swapped 4 SH for 2 SH and changed both terms' load");

  // A corequisite group is two registrations against the elective's one, so the term's COURSE
  // count would change even at equal credit.
  const pair = mapOf(course("MARKED3302", [MARK]), course("MARKED3303", [MARK], 0));
  const grouped = run([["w", 3], ["g", 7]],
    [cell("w", [["MARKED3302", "MARKED3303"]], { sh: 4 }), ge("g", { sh: 4 })], pair);
  assert.equal(grouped.moves, 0, "two registrations traded for one changes the course count");
});

test("attr placement › an UNKNOWN rule is reported, never silently dropped", () => {
  // The failure this prevents is a preference that stops applying because a key was renamed —
  // invisible in every corpus metric, exactly like the frozen phase-2 pass that survived unnoticed.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const plans = [cell("w", [["MARKED3302"]]), ge("g")];
  for (const rules of [
    [{ attribute: MARK, notBefore: "someday", swapWith: PARTNERS.GENERAL_ELECTIVE }],
    [{ attribute: MARK, notBefore: ANCHORS.FIRST_WORK, swapWith: "anything" }],
    [{ notBefore: ANCHORS.FIRST_WORK, swapWith: PARTNERS.GENERAL_ELECTIVE }],
    [{}], [null],
  ]) {
    const out = run([["w", 3], ["g", 7]], plans, courseMap, { rules });
    assert.equal(out.moves, 0, `applied an unknown rule: ${JSON.stringify(rules)}`);
    assert.equal(out.unknown.length, 1, `did not report: ${JSON.stringify(rules)}`);
  }
});

test("attr placement › no rules, or no anchor in this plan, is a no-op", () => {
  // A plan with no employment term has no "after the co-op" to speak of, and an institution that
  // declares nothing gets no behaviour.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const plans = [cell("w", [["MARKED3302"]]), ge("g")];
  for (const extra of [
    { rules: [] },
    { boundary: null },
    { boundary: 0 },                 // employment first, so nothing is before it
    { boundary: TERMS.length },      // no employment term at all
  ]) {
    const out = run([["w", 3], ["g", 7]], plans, courseMap, extra);
    assert.equal(out.moves, 0, `moved with ${JSON.stringify(extra)}`);
    assert.equal(out.unknown.length, 0, "a valid rule must not be reported as unknown");
  }
});

test("attr placement › a term outside either DOMAIN is never used", () => {
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const noReach = run([["w", 3], ["g", 7]],
    [{ ...cell("w", [["MARKED3302"]]), domain: [0, 1, 2, 3] }, ge("g")], courseMap);
  assert.equal(noReach.moves, 0, "the designated course cannot legally reach term 7");
  const noSwap = run([["w", 3], ["g", 7]],
    [cell("w", [["MARKED3302"]]), { ...ge("g"), domain: [6, 7, 8, 9] }], courseMap);
  assert.equal(noSwap.moves, 0, "the elective cannot legally reach term 3");
});

test("attr placement › the elective may not out-cluster the ceiling it was given", () => {
  // The one criterion a load-neutral swap CAN break: an elective arriving early can leave a term
  // reading as nothing but placeholders. The caller passes what the incoming plan already
  // tolerated, so this pass can never be the thing that refuses a plan phase 1 legally built.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const plans = [cell("w", [["MARKED3302"]]), ge("a"), ge("b"), ge("g")];
  const at = [["w", 3], ["a", 3], ["b", 3], ["g", 7]];
  assert.equal(run(at, plans, courseMap, { electiveCeiling: 2 }).moves, 0,
    "a third general elective was added to a term already holding two");
  assert.equal(run(at, plans, courseMap, { electiveCeiling: 3 }).moves, 1,
    "a plan that already tolerates three must permit three");
});

test("attr placement › isLegal is CONSULTED, and a refusal stands", () => {
  // The spy is the assertion, not the outcome: `moves === 0` alone would pass if an earlier guard
  // refused the swap, which is how a `fullLegal` test elsewhere turned out to test nothing.
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  const plans = [cell("w", [["MARKED3302"]]), ge("g")];
  let asked = 0;
  const out = run([["w", 3], ["g", 7]], plans, courseMap,
    { isLegal: () => { asked += 1; return false; } });
  assert.ok(asked > 0, "the swap was decided without consulting isLegal");
  assert.equal(out.moves, 0);
});

test("attr placement › deterministic across two identical runs", () => {
  // Two cells share the designation and two electives are eligible; generation must be repeatable.
  const courseMap = mapOf(course("A3302", [MARK]), course("B3302", [MARK]));
  const plans = [cell("wa", [["A3302"]]), cell("wb", [["B3302"]]), ge("g1"), ge("g2")];
  const at = [["wa", 2], ["wb", 3], ["g1", 6], ["g2", 8]];
  const first = run(at, plans, courseMap);
  const again = run(at, plans, courseMap);
  assert.deepEqual([...first.termOf.entries()].sort(), [...again.termOf.entries()].sort());
  assert.deepEqual(first.applied, again.applied);
});

test("attr placement › malformed cells and attributes do not throw", () => {
  const courseMap = mapOf(course("MARKED3302", [MARK]));
  for (const plans of [
    [], [ge("g")], [cell("w", [["MARKED3302"]])],
    [{ cell: { id: "w", kind: "open", groups: null, target: 1 }, candidates: null }, ge("g")],
    [{ cell: { id: "w", kind: "named", groups: [[]], target: 1 }, candidates: [] }, ge("g")],
    [cell("w", [["GONE9999"]]), ge("g")],
  ]) {
    assert.doesNotThrow(() => run([["w", 3], ["g", 7]], plans, courseMap),
      JSON.stringify(plans.map(p => p.cell.id)));
  }
  // An `attributes` field that is a string, not an array — a scrape shape that would otherwise
  // make `includes` match single letters.
  const weird = mapOf({ ...course("MARKED3302"), attributes: MARK });
  assert.equal(run([["w", 3], ["g", 7]], [cell("w", [["MARKED3302"]]), ge("g")], weird).moves, 0,
    "a string attribute was read as carrying the designation");
});

test("attr placement › cellCarries and ruleFloor are separately answerable", () => {
  // The two halves of "what does this rule mean" are exported so they can be asserted without
  // building a plan — the reason this is a module rather than a closure inside a pass.
  const courseMap = mapOf(course("MARKED3302", [MARK]), course("PLAIN2000", []));
  assert.equal(cellCarries(cell("w", [["MARKED3302"]]), courseMap, MARK), true);
  assert.equal(cellCarries(cell("w", [["PLAIN2000"]]), courseMap, MARK), false);
  assert.equal(cellCarries(cell("w", [["MARKED3302"]]), courseMap, null), false);
  assert.equal(cellCarries(ge("g"), courseMap, MARK), false, "a cell naming nothing carries nothing");

  assert.equal(ruleFloor(RULE, { boundary: 5, terms: TERMS }), 5);
  assert.equal(ruleFloor(RULE, { boundary: 0, terms: TERMS }), null);
  assert.equal(ruleFloor(RULE, { boundary: null, terms: TERMS }), null);
  assert.equal(ruleFloor({ notBefore: "nonsense" }, { boundary: 5, terms: TERMS }), null);
});

// ── The shipped Northeastern rules ─────────────────────────────────

test("attr placement › every rule the adapter ships is one the engine understands", () => {
  // The guard that matters in CI. A typo in `notBefore` or `swapWith` would make the rule a no-op,
  // and a preference that silently stops applying is exactly the class of defect this repo keeps
  // paying for. Asserted against the exported vocabularies, so adding an anchor updates both.
  const rules = chartCalibration.attributePlacement ?? [];
  assert.ok(rules.length > 0, "Northeastern declares at least the WD rule");
  for (const r of rules) {
    assert.equal(typeof r.attribute, "string", `rule has no attribute: ${JSON.stringify(r)}`);
    assert.ok(r.attribute.length > 0);
    assert.ok(Object.values(ANCHORS).includes(r.notBefore),
      `unknown anchor ${JSON.stringify(r.notBefore)} — the rule would silently never fire`);
    assert.ok(Object.values(PARTNERS).includes(r.swapWith),
      `unknown partner ${JSON.stringify(r.swapWith)} — the rule would silently never fire`);
  }
  // And the specific one this was built for, so deleting it is a deliberate act.
  assert.ok(rules.some(r => r.attribute === "WD" && r.notBefore === ANCHORS.FIRST_WORK),
    "the WD (advanced writing) rule is no longer declared");
});
