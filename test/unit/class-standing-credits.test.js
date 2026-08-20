// UNIT · src/core/classStanding.js › standing by EARNED semester hours
//
// Northeastern's rule, verbatim from the undergraduate catalog's Academic
// Progression Standards: "freshman, sophomore, junior, and senior standing are
// determined by earned semester hours" — <32 / >=32 / >=64 / >=96.
//
// Two words carry the whole design and both get their own tests below:
//   · "earned"        credits from the term you are registering INTO do not count
//   · "semester hours" not terms — which is why the old fraction-of-plan model was
//                      wrong rather than approximate, since co-op earns no credit
//                      and an overload earns extra
//
// The bias under test is one-directional: this feeds a warning on a student's
// plan, so every ambiguous case must resolve to "no warning".

import { test } from "node:test";
import assert   from "node:assert/strict";
import {
  STANDING_SH, STANDING_LADDER, standingAtSH, meetsStanding,
  requiredSHFor, earnedSHBefore, standingFloorTerm,
} from "../../src/core/classStanding.js";

// ── The thresholds themselves ────────────────────────────────────────

test("the thresholds are the registrar's, exactly", () => {
  assert.deepEqual(STANDING_SH, { FR: 0, SH: 32, JR: 64, SR: 96 });
});

test("boundaries are inclusive at the bottom, exclusive at the top", () => {
  // "at least 32 but less than 64" — 31 is a freshman, 32 is a sophomore.
  assert.equal(standingAtSH(0),  "FR");
  assert.equal(standingAtSH(31), "FR");
  assert.equal(standingAtSH(32), "SH");
  assert.equal(standingAtSH(63), "SH");
  assert.equal(standingAtSH(64), "JR");
  assert.equal(standingAtSH(95), "JR");
  assert.equal(standingAtSH(96), "SR");
  assert.equal(standingAtSH(300), "SR");
});

test("standingAtSH survives junk without inventing a standing", () => {
  for (const bad of [undefined, null, NaN, -1, "64", {}]) {
    assert.equal(standingAtSH(bad), "FR", `input ${String(bad)}`);
  }
});

test("every ladder rung has a threshold and they ascend", () => {
  const vals = STANDING_LADDER.map(c => STANDING_SH[c]);
  assert.equal(vals.filter(v => typeof v === "number").length, STANDING_LADDER.length);
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b));
});

// ── meetsStanding degrades to permissive ─────────────────────────────

test("meetsStanding is exact at the boundary", () => {
  assert.equal(meetsStanding(63, "JR"), false);
  assert.equal(meetsStanding(64, "JR"), true);
  assert.equal(meetsStanding(95, "SR"), false);
  assert.equal(meetsStanding(96, "SR"), true);
});

test("an unknown or unreadable requirement never warns", () => {
  // GR is not on the undergraduate ladder, so it cannot gate an undergrad plan.
  for (const req of ["GR", "XX", "", null, undefined, 7]) {
    assert.equal(meetsStanding(0, req), true, `requirement ${String(req)}`);
  }
});

test("a junk credit total is treated as zero, not as satisfied", () => {
  // The one place permissiveness would be wrong: if we cannot count credits we
  // must not silently pass a real gate. 0 credits fails a JR gate, correctly.
  for (const bad of [undefined, null, NaN, "many"]) {
    assert.equal(meetsStanding(bad, "JR"), false, `earned ${String(bad)}`);
  }
  assert.equal(meetsStanding(bad_none(), "FR"), true, "FR requires 0, so it always passes");
  function bad_none() { return undefined; }
});

test("requiredSHFor is 0 for anything off the ladder", () => {
  assert.equal(requiredSHFor("SR"), 96);
  assert.equal(requiredSHFor("GR"), 0);
  assert.equal(requiredSHFor(undefined), 0);
});

// ── "earned" means strictly before ───────────────────────────────────

test("the term being registered for does not count toward its own standing", () => {
  // 4 terms of 16 SH. Registering for term 2 (0-indexed), the registrar sees
  // terms 0 and 1 only: 32 SH, a sophomore. Counting term 2 would read 48 and
  // wrongly clear a junior gate.
  const sh = [16, 16, 16, 16];
  assert.equal(earnedSHBefore(0, sh), 0);
  assert.equal(earnedSHBefore(1, sh), 16);
  assert.equal(earnedSHBefore(2, sh), 32);
  assert.equal(earnedSHBefore(4, sh), 64);
  assert.equal(standingAtSH(earnedSHBefore(2, sh)), "SH");
});

test("transfer and AP credit count from the very first term", () => {
  // A student arriving with 32 transfer credits IS a sophomore in term 0. No
  // fraction-of-plan model can express this, which is half the reason for the
  // rewrite.
  const sh = [16, 16];
  assert.equal(earnedSHBefore(0, sh, 32), 32);
  assert.equal(standingAtSH(earnedSHBefore(0, sh, 32)), "SH");
  assert.equal(meetsStanding(earnedSHBefore(0, sh, 32), "SH"), true);
});

test("a co-op year earns nothing and delays standing accordingly", () => {
  // THE case the fixed fractions get wrong. Eight terms, two of them co-op at
  // 0 SH. At the plan's midpoint (term 4) the old model called the student a
  // junior; by credits they have 48 SH and are a sophomore.
  const sh = [16, 16, 0, 0, 16, 16, 16, 16];
  const atMidpoint = earnedSHBefore(4, sh);
  assert.equal(atMidpoint, 32);
  assert.equal(standingAtSH(atMidpoint), "SH");
  assert.equal(meetsStanding(atMidpoint, "JR"), false,
    "the 0.50 fraction would have cleared a junior gate here");
});

test("a heavier load reaches junior standing in fewer terms", () => {
  // The opposite direction from co-op, and it must not be punished. Note the
  // comparison has to be made at the SAME term index to mean anything: a plain
  // 16 SH load hits exactly 64 after four terms, so a mild overload changes
  // nothing and only a real one (approved 20–22 SH) crosses a term earlier.
  const fast = [20, 22, 22];   // 64 before term 3
  const slow = [16, 16, 16];   // 48 before term 3
  assert.equal(earnedSHBefore(3, fast), 64);
  assert.equal(earnedSHBefore(3, slow), 48);
  assert.equal(meetsStanding(earnedSHBefore(3, fast), "JR"), true);
  assert.equal(meetsStanding(earnedSHBefore(3, slow), "JR"), false);
});

test("a standard 16 SH load lands exactly on the junior boundary at term 4", () => {
  // Worth pinning because it is the modal NEU plan and it sits ON the boundary,
  // where an off-by-one in `earnedSHBefore` would be invisible in any other test:
  // counting the registering term would clear the gate a full term early.
  const even = [16, 16, 16, 16, 16, 16, 16, 16];
  assert.equal(earnedSHBefore(3, even), 48, "three terms in, still a sophomore");
  assert.equal(earnedSHBefore(4, even), 64, "four terms in, junior");
  assert.equal(meetsStanding(earnedSHBefore(3, even), "JR"), false);
  assert.equal(meetsStanding(earnedSHBefore(4, even), "JR"), true);
  // Senior: 96 SH = six 16 SH terms.
  assert.equal(meetsStanding(earnedSHBefore(5, even), "SR"), false, "80 SH");
  assert.equal(meetsStanding(earnedSHBefore(6, even), "SR"), true,  "96 SH");
});

test("earnedSHBefore accepts a sparse index map, not just an array", () => {
  // PlannerContext keys credits by SEM_INDEX, which is not dense from 0.
  const map = { 1: 16, 2: 16, 5: 16 };
  assert.equal(earnedSHBefore(3, map), 32);
  assert.equal(earnedSHBefore(6, map), 48);
  assert.equal(earnedSHBefore(0, map), 0);
});

test("earnedSHBefore ignores malformed entries instead of throwing", () => {
  assert.equal(earnedSHBefore(5, null), 0);
  assert.equal(earnedSHBefore(5, undefined, 12), 12);
  assert.equal(earnedSHBefore(5, { 1: 16, 2: NaN, x: 8, 3: null }), 16);
  assert.equal(earnedSHBefore(5, [16, undefined, 16]), 32);
  assert.equal(earnedSHBefore(5, { 1: 16 }, NaN), 16, "junk bonus does not poison the sum");
});

test("a negative term index earns nothing", () => {
  assert.equal(earnedSHBefore(-1, [16, 16]), 0);
});

// ── Property: monotonic, and never retroactively strips a standing ───

test("earned credit is non-decreasing in the term index, so standing never regresses", () => {
  let rng = 7654321;
  const rand = (n) => {
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >>> 17;
    rng ^= rng << 5;  rng >>>= 0;
    return rng % n;
  };
  let sawEveryRung = new Set();
  for (let iter = 0; iter < 2000; iter++) {
    const n = 2 + rand(10);
    const sh = Array.from({ length: n }, () => [0, 4, 8, 12, 16, 20][rand(6)]);
    const bonus = [0, 0, 8, 32][rand(4)];
    let prev = -1, prevRung = -1;
    for (let ti = 0; ti <= n; ti++) {
      const e = earnedSHBefore(ti, sh, bonus);
      assert.ok(e >= prev, "credit went backwards");
      const rung = STANDING_LADDER.indexOf(standingAtSH(e));
      assert.ok(rung >= prevRung, "standing regressed");
      // Consistency between the two entry points, at every step.
      for (const code of STANDING_LADDER) {
        assert.equal(meetsStanding(e, code), e >= STANDING_SH[code], `${e} vs ${code}`);
      }
      sawEveryRung.add(standingAtSH(e));
      prev = e; prevRung = rung;
    }
  }
  // Not a vacuous sweep: the generator must have produced all four standings.
  assert.deepEqual([...sawEveryRung].sort(), ["FR", "JR", "SH", "SR"]);
});

// ── standingFloorTerm: the generator's credit-derived floor ──────────
//
// search.js used `cellLevelFloor(...) * span` — a fraction of the plan's LENGTH.
// This replaces it for gated courses with a fraction of the plan's CREDITS, and
// the two disagree exactly where Northeastern is unusual: co-op.

test("standingFloorTerm finds the first term the plan has the credits", () => {
  const even = [16, 16, 16, 16, 16, 16, 16, 16];
  assert.equal(standingFloorTerm(0,  even), 0, "no requirement, no floor");
  assert.equal(standingFloorTerm(32, even), 2, "32 SH earned after two terms");
  assert.equal(standingFloorTerm(64, even), 4);
  assert.equal(standingFloorTerm(96, even), 6);
});

test("co-op terms earn nothing, so the floor moves LATER than any fraction", () => {
  // An 8-term plan with two co-op terms (shape.js gives a work term targetSH 0).
  // A junior gate lands at term 6 of 8 — 0.75 of the way — where the old fixed
  // fraction said 0.50, i.e. term 4. Two terms of difference on the same plan.
  const withCoop = [16, 16, 0, 0, 16, 16, 16, 16];
  assert.equal(standingFloorTerm(64, withCoop), 6);
  const noCoop   = [16, 16, 16, 16, 16, 16, 16, 16];
  assert.equal(standingFloorTerm(64, noCoop), 4);
});

test("transfer credit moves the floor EARLIER, including to term 0", () => {
  const even = [16, 16, 16, 16];
  assert.equal(standingFloorTerm(32, even, 32), 0, "arrives a sophomore");
  assert.equal(standingFloorTerm(64, even, 32), 2);
});

test("a plan that never earns enough returns the end, not a wrong term", () => {
  // Real conflict: a 3-term plan cannot contain a senior-only course. Expressed
  // as "last" because this drives ordering; as a filter it would forbid all.
  const short = [16, 16, 16];
  assert.equal(standingFloorTerm(96, short), 3);
  assert.equal(standingFloorTerm(96, short), short.length);
});

test("standingFloorTerm tolerates junk term lists", () => {
  assert.equal(standingFloorTerm(64, null), 0);
  assert.equal(standingFloorTerm(64, undefined), 0);
  assert.equal(standingFloorTerm(64, []), 0);
  // Four readable 16s among six slots. They only total 64 once term 5 has been
  // COMPLETED, so the first term with 64 earned is index 6 — one past the end,
  // i.e. this plan never legally reaches it. Skipped entries genuinely cost
  // credit rather than being silently treated as full terms.
  assert.equal(standingFloorTerm(64, [16, NaN, 16, undefined, 16, 16]), 6);
  assert.equal(standingFloorTerm(NaN, [16, 16]), 0);
});

test("the credit floor and the plan-position floor agree on an even 8-term plan", () => {
  // Sanity: where the old model's assumption HOLDS (even load, no co-op), the new
  // one must not move anything. 8 terms x 16 SH: junior at term 4 = 0.50 = the old
  // STANDING_FLOOR.JR. If this ever fails, one of the two models has drifted.
  const even = Array(8).fill(16);
  assert.equal(standingFloorTerm(STANDING_SH.SH, even) / 8, 0.25);
  assert.equal(standingFloorTerm(STANDING_SH.JR, even) / 8, 0.50);
  assert.equal(standingFloorTerm(STANDING_SH.SR, even) / 8, 0.75);
});
