// A Sample Plan of Study belongs to ONE catalog edition, and `planKeyFor` is
// the rule that keeps it there.
//
// These are written to attack the thing that was actually wrong rather than to
// demonstrate the happy path: the old code migrated the plan lookup across
// years all by itself, using the same `resolveInMap` the program loader uses.
// That is correct for requirements (a saved path that no longer resolves must
// land on something) and silently wrong for plans, so every case below is
// really asking one question — "given the chance to substitute a neighbouring
// year's plan, does it?"
import { test } from "node:test";
import assert from "node:assert/strict";
import { planKeyFor, resolveInMap, parseMajorPathParts } from "../../src/data/programPaths.js";

const P = "../../data/northeastern/programs";
const req  = (y, col, f) => `${P}/undergraduate/${y}/${col}/${f}/requirements.json`;
const plan = (y, col, f) => `${P}/undergraduate/${y}/${col}/${f}/plan.json`;
const grad = (y, col, f) => `${P}/graduate/${y}/${col}/${f}/requirements.json`;
const gplan = (y, col, f) => `${P}/graduate/${y}/${col}/${f}/plan.json`;

const CS = ["computer-information-science", "computer_science_bscs_(boston)"];

/** The live shape: both editions of the program, a plan only in the older one. */
const programs = {
  [req(2026, ...CS)]: () => {},
  [req(2027, ...CS)]: () => {},
};
const plans = {
  [plan(2026, ...CS)]: () => {},
};

test("the plan comes from the edition asked for", () => {
  assert.equal(planKeyFor(plans, programs, req(2026, ...CS)), plan(2026, ...CS));
});

test("an edition that publishes no plan gets NULL, not the neighbouring year's", () => {
  // The defect, stated exactly. Northeastern moved Sample Plans of Study onto
  // the colleges' own websites for 2026-2027, so we hold none for that edition
  // — which makes this not a corner case but every undergraduate on the current
  // catalog, and the wrong answer here is a plan that looks authoritative and
  // describes last year's degree.
  assert.equal(planKeyFor(plans, programs, req(2027, ...CS)), null);
});

test("it does not fall FORWARD either", () => {
  // Same rule, other direction — a 2027-only plan must not answer for 2026.
  const fwd = { [plan(2027, ...CS)]: () => {} };
  assert.equal(planKeyFor(fwd, programs, req(2026, ...CS)), null);
  assert.equal(planKeyFor(fwd, programs, req(2027, ...CS)), plan(2027, ...CS));
});

test("a saved path from a DROPPED edition follows its requirements, wherever they went", () => {
  // The case that stops this being "never migrate at all", and the one where
  // the expected answer has to be READ off `resolveInMap` rather than assumed.
  // Its order is `exact ?? older ?? newest`, so a 2025 path — older than
  // anything held — lands on the NEWEST edition, not the oldest. That surprised
  // this test, which first asserted 2026 and was wrong.
  //
  // The invariant does not care which year it picked. It cares that the plan is
  // that year's or nothing: 2025 → 2027 requirements → 2027 publishes no plan
  // → null. A plan is never shown for requirements that are not on screen.
  const only2026 = { [req(2026, ...CS)]: () => {} };
  assert.equal(planKeyFor(plans, programs,  req(2025, ...CS)), null);
  assert.equal(planKeyFor(plans, only2026,  req(2025, ...CS)), plan(2026, ...CS));
});

test("the plan's year EQUALS the resolved requirements' year, over every combination", () => {
  // The rule stated as the property, rather than as a handful of examples —
  // this is the one that would still fail if the migration crept back in
  // through some path the cases above do not name.
  const yearOf = (p) => Number(String(p).match(/\/(\d{4})\//)?.[1]);
  const held = [[2026], [2027], [2026, 2027]];
  const published = [[], [2026], [2027], [2026, 2027]];

  for (const hs of held) for (const ps of published) for (const ask of [2024, 2025, 2026, 2027, 2028]) {
    const pm = Object.fromEntries(hs.map(y => [req(y, ...CS), () => {}]));
    // A plan can only exist beside requirements we hold, so intersect.
    const pl = Object.fromEntries(ps.filter(y => hs.includes(y)).map(y => [plan(y, ...CS), () => {}]));
    const key = planKeyFor(pl, pm, req(ask, ...CS));
    if (key === null) continue;
    const resolved = yearOf(resolveInMap(pm, req(ask, ...CS), parseMajorPathParts));
    assert.equal(yearOf(key), resolved,
      `asked ${ask}, held [${hs}], published [${ps}] → plan ${yearOf(key)} but requirements ${resolved}`);
    assert.ok(key in pl);
  }
});

test("a plan is never borrowed from another PROGRAM", () => {
  const other = ["science", "biology_bs_(boston)"];
  const p = { [plan(2026, ...other)]: () => {} };
  assert.equal(planKeyFor(p, programs, req(2026, ...CS)), null);
});

test("graduate paths resolve in the graduate tree", () => {
  const G = ["computer-information-science", "computer_science_ms_(boston)"];
  const gp = { [grad(2026, ...G)]: () => {} };
  const gpl = { [gplan(2026, ...G)]: () => {} };
  assert.equal(planKeyFor(gpl, gp, grad(2026, ...G)), gplan(2026, ...G));
  assert.equal(planKeyFor(gpl, gp, grad(2027, ...G)), gplan(2026, ...G)); // 2027 not held → resolves back
});

test("junk in, null out — never a throw and never a guess", () => {
  for (const bad of [null, undefined, "", 0, {}, [], "not/a/path"]) {
    assert.equal(planKeyFor(plans, programs, bad), null, `path ${JSON.stringify(bad)}`);
  }
  assert.equal(planKeyFor(null, programs, req(2026, ...CS)), null);
  assert.equal(planKeyFor(plans, null, req(2026, ...CS)), null);
  assert.equal(planKeyFor({}, {}, req(2026, ...CS)), null);
});

test("handed a plan.json path by mistake, it still answers for the right edition", () => {
  // Checked rather than assumed, and the assumption was wrong: this was written
  // expecting null, on the theory that the sibling derivation needs a
  // `requirements.json` to replace. It does not — `resolveInMap` parses the
  // year/college/folder out of any program path, so the slip canonicalizes to
  // the same record and lands on the same plan. Left as the recorded behaviour
  // rather than tightened into a refusal: no caller does this, and a rule with
  // no consumer is a rule nobody is keeping.
  assert.equal(planKeyFor(plans, programs, plan(2026, ...CS)), plan(2026, ...CS));
});

test("the answer is a REAL key in the plan map, always", () => {
  // The whole point is that the UI can load what it was told exists. A key that
  // is not in the map is the blank-panel failure wearing a different hat.
  for (const path of [req(2025, ...CS), req(2026, ...CS), req(2027, ...CS)]) {
    const k = planKeyFor(plans, programs, path);
    if (k !== null) assert.ok(k in plans, `${k} is not in the plan map`);
  }
});
