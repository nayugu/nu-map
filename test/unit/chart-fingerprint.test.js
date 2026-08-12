// The fingerprint instrument, attacked rather than confirmed.
//
// Its whole value is that it fires on a change a student would see and stays silent on one
// they would not. A detector that cannot fire is worse than none, because it will be quoted
// as evidence that nothing moved. So these tests are mostly about making it fire.
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPlan, fingerprintPlan, compareFingerprints }
  from "../../scripts/lib/chart-fingerprint.js";

/** A minimal generated-plan shape: one year, terms of entries. */
const plan = (terms) => ({ years: [{ label: "Year 1", terms }] });
const term = (type, entries) => ({ term: type, type, entries });
const cell = (text, sh = 4, extra = {}) => ({ text, sh, ...extra });

test("identical plans hash identically", () => {
  const a = plan([term("Fall", [cell("CS 2000"), cell("General Elective")])]);
  const b = plan([term("Fall", [cell("CS 2000"), cell("General Elective")])]);
  assert.equal(fingerprintPlan(a), fingerprintPlan(b));
});

// ── The things that MUST move the hash ─────────────────────────────

test("a cell in a different term moves the hash", () => {
  const a = plan([term("Fall", [cell("CS 2000")]), term("Spring", [cell("CS 2100")])]);
  const b = plan([term("Fall", [cell("CS 2100")]), term("Spring", [cell("CS 2000")])]);
  assert.notEqual(fingerprintPlan(a), fingerprintPlan(b));
});

test("reordering cells WITHIN a term moves the hash", () => {
  // Order inside a term is what the grid renders, so a reordering is a visible change.
  const a = plan([term("Fall", [cell("CS 2000"), cell("MATH 1341")])]);
  const b = plan([term("Fall", [cell("MATH 1341"), cell("CS 2000")])]);
  assert.notEqual(fingerprintPlan(a), fingerprintPlan(b));
});

test("a moved co-op moves the hash even when every course stays put", () => {
  // The specific regression this guards: a shape change that leaves the courses alone.
  const a = plan([term("Fall", [cell("CS 2000")]),
                  term("Spring", [{ coop: true, text: "Co-op" }])]);
  const b = plan([term("Fall", [{ coop: true, text: "Co-op" }]),
                  term("Spring", [cell("CS 2000")])]);
  assert.notEqual(fingerprintPlan(a), fingerprintPlan(b));
});

test("changing a cell's credits moves the hash", () => {
  const a = plan([term("Fall", [cell("Elective", 4)])]);
  const b = plan([term("Fall", [cell("Elective", 3)])]);
  assert.notEqual(fingerprintPlan(a), fingerprintPlan(b));
});

test("a different candidate set for the same title moves the hash", () => {
  // A cell whose options narrowed is a different reservation, even with the same label.
  const a = plan([term("Fall", [cell("Elective", 4, { options: [["CS4300"], ["CS4100"]] })])]);
  const b = plan([term("Fall", [cell("Elective", 4, { options: [["CS4300"]] })])]);
  assert.notEqual(fingerprintPlan(a), fingerprintPlan(b));
});

test("nesting depth is part of the identity", () => {
  const flat = plan([term("Fall", [cell("A"), cell("B")])]);
  const nested = plan([term("Fall", [{ ...cell("A"), children: [cell("B")] }])]);
  assert.notEqual(fingerprintPlan(flat), fingerprintPlan(nested));
});

// ── The things that must NOT move the hash ─────────────────────────

test("option GROUP order does not move the hash", () => {
  // `CS 4300 or CS 4100` and `CS 4100 or CS 4300` are the same choice. Firing here would
  // make the instrument cry over a sort order nobody sees.
  const a = plan([term("Fall", [cell("E", 4, { options: [["CS4300"], ["CS4100"]] })])]);
  const b = plan([term("Fall", [cell("E", 4, { options: [["CS4100"], ["CS4300"]] })])]);
  assert.equal(fingerprintPlan(a), fingerprintPlan(b));
});

test("order WITHIN a coreq group does not move the hash", () => {
  // A group is a set of simultaneous registrations, so {A,B} and {B,A} are one thing.
  const a = plan([term("Fall", [cell("E", 4, { options: [["BIOL2301", "BIOL2302"]] })])]);
  const b = plan([term("Fall", [cell("E", 4, { options: [["BIOL2302", "BIOL2301"]] })])]);
  assert.equal(fingerprintPlan(a), fingerprintPlan(b));
});

// ── It must not throw on the shapes the emitter really produces ────

test("missing and empty fields do not throw", () => {
  for (const p of [undefined, null, {}, { years: [] }, { years: [{ terms: [] }] },
                   plan([term("Fall", undefined)]), plan([term("Fall", [{}])])]) {
    assert.equal(typeof fingerprintPlan(p), "string");
  }
});

test("a hash is stable across calls and short enough to read", () => {
  const p = plan([term("Fall", [cell("CS 2000")])]);
  assert.equal(fingerprintPlan(p), fingerprintPlan(p));
  assert.equal(fingerprintPlan(p).length, 16);
});

test("the canonical form is readable text naming the cells", () => {
  // The differ prints this to explain a moved hash, so it has to contain the cell.
  const text = canonicalPlan(plan([term("Fall", [cell("CS 2000")])]));
  assert.match(text, /CS 2000/);
  assert.match(text, /Fall/);
});

// ── The comparer's four categories ─────────────────────────────────

test("compareFingerprints separates moved from gained and lost", () => {
  const { same, moved, gained, lost } = compareFingerprints(
    { steady: "aaa", shifted: "bbb", dropped: "ccc" },
    { steady: "aaa", shifted: "zzz", added: "ddd" },
  );
  assert.deepEqual(same, ["steady"]);
  assert.deepEqual(moved, ["shifted"]);
  assert.deepEqual(gained, ["added"]);
  assert.deepEqual(lost, ["dropped"]);
});

test("compareFingerprints is stable in output order", () => {
  // The differ's output is read by a person and diffed by eye across runs.
  const a = compareFingerprints({ b: "1", a: "2" }, { b: "9", a: "8" });
  assert.deepEqual(a.moved, ["a", "b"]);
});

test("two empty snapshots compare clean rather than throwing", () => {
  const r = compareFingerprints({}, {});
  assert.deepEqual([r.same, r.moved, r.gained, r.lost], [[], [], [], []]);
});
