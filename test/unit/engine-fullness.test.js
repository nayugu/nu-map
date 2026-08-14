// UNIT · what "a full term" means, and whether every relaxation rung can be reached.
//
// Both of these were wrong in ways no test could see, and both cost real plans:
//   - `termIsFull` measured its slack against the TOTAL load, so five credits of labs
//     made a three-course term report as full.
//   - `TIER_SHARES` summed to exactly 1.00, so the last rung on the ladder never ran —
//     it could be correct, be honoured downstream, and never execute once.
//
// Each test below names the case that broke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { termIsFull, DEFAULT_CALIBRATION as CAL } from "../../src/engine/calibration.js";
import { TIER_SHARES, DEFAULT_NODE_BUDGET } from "../../src/engine/search.js";

const UG = "undergraduate";
const CAP = 19;

// ── termIsFull ──────────────────────────────────────────────────────

test("full › four real courses is full, whatever the credits", () => {
  assert.equal(termIsFull(4, 16, CAP, CAL, UG, 16), true);
  assert.equal(termIsFull(5, 18, CAP, CAL, UG, 18), true);
});

test("full › THE BUG: labs must not manufacture fullness", () => {
  // International Business Spring 2027. FINA 2201 + two concentration cells = 12 SH of
  // real course, plus BUSN 1103 (1) and INTB 2205/2206 (2 each) = 17 SH total, three
  // real courses. Read against the total it looked full at 17 of 19; read against the
  // real courses there is room for a fourth as soon as the small ones move.
  assert.equal(termIsFull(3, 17, CAP, CAL, UG, 12), false,
    "a term padded to 17 SH with 5 SH of small courses is NOT full");
});

test("full › a genuinely heavy term with three courses IS full", () => {
  // Three 6 SH courses, 18 SH, no padding: the registrar would refuse a fourth. This is
  // the case the second clause was written for and it must keep passing.
  assert.equal(termIsFull(3, 18, CAP, CAL, UG, 18), true);
});

test("full › Architecture's studio is unaffected — it has no small courses to blame", () => {
  // A 16 SH studio is 16 SH of REAL course, so total and real agree and the verdict is
  // identical to before the change. This is the regression the fix had to avoid.
  assert.equal(termIsFull(1, 16, CAP, CAL, UG, 16),
               termIsFull(1, 16, CAP, CAL, UG),
               "the studio case must not depend on which quantity is measured");
});

test("full › omitting the real-course credit falls back to the old reading", () => {
  // Callers that have not been threaded must behave exactly as they did, or the change
  // becomes a silent behaviour swap in whichever call site was missed.
  assert.equal(termIsFull(3, 17, CAP, CAL, UG), termIsFull(3, 17, CAP, CAL, UG, 17));
});

test("full › a graduate term is always full — the bar is not theirs", () => {
  // 16.4% of published graduate full terms carry four courses; the convention does not
  // exist for them and must not be enforced by the back door.
  assert.equal(termIsFull(0, 0, 16, CAL, "graduate", 0), true);
});

test("full › an empty undergraduate term is never full", () => {
  // The extreme failure of criterion 1. It has room for four courses by any reading.
  assert.equal(termIsFull(0, 0, CAP, CAL, UG, 0), false);
});

// ── The relaxation ladder ───────────────────────────────────────────

test("ladder › the tier shares leave room for every rung to run", () => {
  // `attemptPlacement` breaks on `totalNodes >= nodeBudget` BEFORE each rung, so shares
  // that sum to 1.00 mean the last rung is unreachable — not slow, not starved,
  // unreachable. That is exactly how the four-course rung came to be dead on arrival.
  const total = TIER_SHARES.strict + TIER_SHARES.rungs.reduce((a, b) => a + b, 0);
  assert.ok(total < 1,
    `strict ${TIER_SHARES.strict} + rungs [${TIER_SHARES.rungs}] = ${total}; `
    + `at 1.00 the final rung never executes`);
});

test("ladder › every rung has a share of its own, not a leftover", () => {
  // `TIER_SHARES.rungs[ri] ?? 0.2` silently invents a share for a rung nobody budgeted.
  // Adding a rung must mean editing the shares, so this asserts the count is deliberate.
  assert.ok(TIER_SHARES.rungs.length >= 3,
    "the ladder has three rungs; a rung without its own share is a rung that may not run");
  for (const s of TIER_SHARES.rungs) assert.ok(s > 0, "a zero share is an absent rung");
});

test("ladder › a new rung is paid for with NEW nodes, never out of the others", () => {
  // The shares are fractions, so adding a rung by shrinking the existing ones silently
  // demotes every program that used to settle in an earlier tier. Measured when it happened:
  // 28 programs were rescued and 45 already-good plans got worse, and empty full terms rose
  // by 27 across plans that were ALREADY generating — while the 29 newly-generating plans
  // contributed one empty term between them.
  //
  // So the absolute allowance is what must not shrink, and that is what this pins. The
  // baseline is the ladder as it stood at 20,000 nodes with shares 0.25 / 0.40 / 0.35.
  const abs = (share) => share * DEFAULT_NODE_BUDGET;
  assert.ok(abs(TIER_SHARES.strict) >= 5000 * 0.98,
    `strict tier fell to ${abs(TIER_SHARES.strict)} nodes, below its historical 5,000`);
  assert.ok(abs(TIER_SHARES.rungs[0]) >= 8000 * 0.98,
    `rung 1 fell to ${abs(TIER_SHARES.rungs[0])} nodes, below its historical 8,000`);
  assert.ok(abs(TIER_SHARES.rungs[1]) >= 7000 * 0.98,
    `rung 2 fell to ${abs(TIER_SHARES.rungs[1])} nodes, below its historical 7,000`);
  assert.ok(abs(TIER_SHARES.rungs[2]) > 0, "the last rung must have real nodes to spend");
});
