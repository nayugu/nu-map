// ═══════════════════════════════════════════════════════════════════
// The GENERATOR may reproduce a department's overloaded first semester.
// The PLANNER must never stop warning about one.
//
// These are two different questions about the same number and they are deliberately
// answered by different code:
//
//   generator   `earlyTerms.js` lets term 0 hold what the department published, bounded by
//               `FIRST_TERM_OVERLOAD_SH` over the registration cap. A block schedule an
//               advisor signs off is not a term nobody may register for, and refusing to
//               reproduce it means disagreeing with the faculty while showing a worse plan.
//
//   planner     `creditLoad.js` judges a load against the cap and nothing else. If a student
//               types 20 SH into ANY semester — the first one included — the ⚠ appears.
//               The overload is a petition they have to file, so it must stay visible.
//
// The failure this guards is one line in a surface: someone raises the planner's cap for the
// first term "to match the generator", and the warning silently disappears from the one term
// most likely to carry an overload. Nothing else in the suite would catch that — the plan is
// still legal, the generator is still right, and only the student loses the notice.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, isOverCap, LOAD_OVER, LOAD_OK } from "../../src/core/creditLoad.js";
import { FIRST_TERM_OVERLOAD_SH } from "../../src/engine/earlyTerms.js";
import creditSystem from "../../src/adapters/northeastern/creditSystem.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

const UG   = creditSystem.getSemesterMax("undergraduate");
const GRAD = creditSystem.getSemesterMax("graduate");

test("caps › the graduate cap is the LOWER one, and both are what the planner judges against", () => {
  // Pinned because the pair is easy to state backwards, and every number below depends on
  // which is which. Graduate students carry fewer credits, not more.
  assert.equal(UG, 19);
  assert.equal(GRAD, 16);
  assert.ok(GRAD < UG, "the graduate cap must stay below the undergraduate one");
});

test("planner › the verdict cannot depend on WHICH semester it is — there is no term to pass", () => {
  // The structural guarantee. `loadState(sh, {cap, min})` takes no term index, so a
  // first-semester exemption is not something a caller can express by accident. Junk extra
  // keys change nothing, which is what makes that true rather than merely conventional.
  const plain  = loadState(20, { cap: UG });
  const withT0 = loadState(20, { cap: UG, term: 0, termIndex: 0, first: true, isFirstTerm: true });
  assert.equal(plain, LOAD_OVER);
  assert.equal(withT0, LOAD_OVER, "a caller smuggled a term in and the verdict moved");
});

test("planner › the exact load the GENERATOR is allowed to build still reads OVER", () => {
  // The crisp statement of the rule. `cap + FIRST_TERM_OVERLOAD_SH` is the most the generator
  // may ever put in a first semester — 21 SH undergraduate, 18 graduate. Every one of those
  // loads is an overload the student must petition for, so the planner says so.
  for (const [type, cap] of [["undergraduate", UG], ["graduate", GRAD]]) {
    const built = cap + FIRST_TERM_OVERLOAD_SH;
    assert.equal(loadState(built, { cap }), LOAD_OVER,
      `${type}: the generator may build ${built} SH and the planner must still flag it`);
    assert.equal(isOverCap(built, cap), true, `${type}: isOverCap disagreed with loadState`);
  }
});

test("planner › 20 SH is an overload for an undergraduate in every semester of a five-year plan", () => {
  // Stated over a whole plan rather than once, because "any semester" is the actual promise.
  // Ten terms, same load, same verdict — the judgement has nowhere to put a term-dependent
  // branch even if someone wanted one.
  for (let term = 0; term < 10; term++) {
    assert.equal(loadState(20, { cap: UG }), LOAD_OVER, `term ${term} stopped warning`);
  }
  // And the boundary stays where the cap is, not where the generator's allowance is.
  assert.equal(loadState(UG, { cap: UG }), LOAD_OK, "exactly at the cap is not over it");
  assert.equal(loadState(UG + 1, { cap: UG }), LOAD_OVER, "one over the cap is over it");
});

test("planner › a graduate 18 SH term is over the cap even though it is under the undergraduate one", () => {
  // The case a single hard-coded number gets wrong. 18 SH is fine for an undergraduate and an
  // overload for a graduate student; an absolute ceiling of 21 handed graduate students a
  // five-credit overload, which is exactly how this was found the first time.
  assert.equal(loadState(18, { cap: GRAD }), LOAD_OVER);
  assert.equal(loadState(18, { cap: UG }),   LOAD_OK);
});

test("planner › no surface may raise its own cap for the first term", () => {
  // The source-level half. The behavioural tests above prove `loadState` cannot be told the
  // term; this proves no CALLER hands it a cap it inflated first. Reading the files is the
  // only way to check it — a surface that raised its cap would still pass every unit test,
  // because it would be asking a correct function a wrong question.
  const surfaces = [
    "src/ui/SemRow.jsx",
    "src/ui/SummerRow.jsx",
    "src/ui/MiniPlanGrid.jsx",
    "src/adapters/mcp/plannerQueryAdapter.js",
  ];
  // Names that only ever mean "the generator's first-term allowance". `creditCeiling` is the
  // engine's own raised ceiling, written onto term 0 by `engine/index.js`; if it ever appears
  // in a planner surface it is being used as a cap, which is the bug.
  const forbidden = [/FIRST_TERM_OVERLOAD_SH/, /firstTermOverload/, /creditCeiling/,
                     /earlyTerms/, /firstTermCap/];
  for (const rel of surfaces) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const pat of forbidden) {
      assert.ok(!pat.test(src),
        `${rel} mentions ${pat} — a planner surface must judge against the plain registration cap`);
    }
    // And it must actually be asking the shared judgement rather than rolling its own.
    assert.ok(/loadState|isOverCap/.test(src),
      `${rel} no longer uses the shared credit-load verdict`);
  }
});

test("planner › the generator's allowance is a small bound, not an open licence", () => {
  // If this constant ever grows, the tests above keep passing while the gap between what the
  // generator builds and what a student may register for widens silently. Two credits is one
  // merged corequisite partner; it is not a policy change.
  assert.equal(FIRST_TERM_OVERLOAD_SH, 2);
  assert.ok(FIRST_TERM_OVERLOAD_SH > 0 && FIRST_TERM_OVERLOAD_SH <= 3,
    "the first-term allowance left the range this design was measured over");
});
