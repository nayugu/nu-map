// UNIT · src/engine/domains.js › class standing narrows the domain, and never empties it
//
// As an ordering PREFERENCE in search.js this rule leaked: measured over all 279
// generable undergraduate plans, 54 of 585 gated placements (9.2%) sat earlier than
// the earned credits allow — ENGW 3302 in term 1 with 17 SH against a 64 SH gate,
// MUSI 4601 in term 1 against a 96 SH gate. A preference only breaks ties, and
// capacity pressure outranks it.
//
// So it narrows the domain. The dangerous part is not the rule but the narrowing:
// the same filter applied to the level-DIGIT proxy cost 15 points of coverage
// (77.4% → 62.6%) by emptying domains and turning a taste into an infeasibility.
// The guard is therefore the thing under test here — the narrowed domain is adopted
// only if something survives.

import { test } from "node:test";
import assert   from "node:assert/strict";
import { buildDomains } from "../../src/engine/domains.js";
import { EXCLUSION } from "../../src/core/derivation/events.js";

/** Eight 16 SH fall/spring terms: junior standing (64 SH) is reached at index 4. */
const evenTerms = (n = 8, sh = 16) =>
  Array.from({ length: n }, (_, i) => ({
    semTypeId: i % 2 === 0 ? "fall" : "spring", targetSH: sh, weight: 1,
    work: false, unused: false,
  }));

const course = (id, std, sh = 4) => ({ id, sh, ...(std ? { offering: { std } } : {}) });
const mapOf  = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

/**
 * A cell naming one course outright. `kind: "named"` is load-bearing, not
 * decoration: without it `minDepthOf` short-circuits to 0 and `candidatesFor`
 * reports an open pool, so the season and depth bounds never engage and the cell
 * looks legal everywhere. An earlier draft of these tests omitted it and two
 * assertions failed for that reason rather than for anything about standing.
 */
const cell = (id, i = 0) => ({ id: `c${i}`, kind: "named", title: id, sh: 4, groups: [[id]] });

const run = (cells, terms, courseMap, opts = {}) =>
  buildDomains(cells, terms, { courseMap, offered: () => true, trace: true, ...opts });

test("a junior-gated course loses the terms before 64 credits", () => {
  const terms = evenTerms();
  const map = mapOf(course("ENGW3302", "JR"));
  const { plans } = run([cell("ENGW3302")], terms, map);
  assert.deepEqual(plans[0].domain, [4, 5, 6, 7],
    "16 SH a term reaches 64 after four terms, so terms 0-3 are out");
});

test("the dropped terms are recorded as before-class-standing, not as a prereq", () => {
  // A student asking "why not year one" must get the real reason. Sharing the
  // prereq DISPLAY group is fine; sharing its vocabulary would be a wrong answer.
  const { plans } = run([cell("ENGW3302")], evenTerms(), mapOf(course("ENGW3302", "JR")));
  const standing = plans[0].excluded.filter(e => e.reason === EXCLUSION.BEFORE_STANDING);
  assert.deepEqual(standing.map(e => e.term), [0, 1, 2, 3]);
});

test("each standing threshold lands where its credits do", () => {
  const terms = evenTerms();
  for (const [std, first] of [["SH", 2], ["JR", 4], ["SR", 6]]) {
    const { plans } = run([cell("X4000")], terms, mapOf(course("X4000", std)));
    assert.equal(plans[0].domain[0], first, `${std} should first be legal at term ${first}`);
  }
});

test("FR gates nothing", () => {
  const { plans } = run([cell("X1000")], evenTerms(), mapOf(course("X1000", "FR")));
  assert.equal(plans[0].domain[0], 0);
});

test("an ungated course is untouched", () => {
  const { plans } = run([cell("X4000")], evenTerms(), mapOf(course("X4000")));
  assert.equal(plans[0].domain[0], 0);
  assert.equal((plans[0].excluded ?? []).some(e => e.reason === EXCLUSION.BEFORE_STANDING), false);
});

// ── Co-op: the reason this is credits and not a fraction ─────────────

test("co-op terms earn nothing, so the floor moves later", () => {
  // Terms 2 and 3 are work terms at targetSH 0 — what shape.js emits for co-op.
  // 64 SH now arrives at index 6 rather than 4: two terms later than a
  // fraction-of-plan model would say, on the same eight-term plan.
  const terms = evenTerms();
  terms[2].targetSH = 0; terms[3].targetSH = 0;
  const { plans } = run([cell("ENGW3302")], terms, mapOf(course("ENGW3302", "JR")));
  assert.equal(plans[0].domain[0], 6);
});

// ── The guard: never empty, never refuse ─────────────────────────────

test("a plan too short to reach the standing keeps ALL its terms", () => {
  // THE case that cost 15 points of coverage when the level-digit filter had no
  // such guard. Three 16 SH terms never reach 96, so a senior-gated course would
  // have an empty domain and the whole plan would be refused. Degrade to the
  // preference instead: less information, never a refusal this rule caused.
  const terms = evenTerms(3);
  const { plans } = run([cell("CAP4999")], terms, mapOf(course("CAP4999", "SR")));
  assert.deepEqual(plans[0].domain, [0, 1, 2]);
  assert.equal((plans[0].excluded ?? []).some(e => e.reason === EXCLUSION.BEFORE_STANDING), false,
    "nothing was actually excluded, so nothing may be reported as excluded");
});

test("no cell is ever made impossible by the standing rule alone", () => {
  const terms = evenTerms(4);
  const cells = [["FR", 0], ["SH", 1], ["JR", 2], ["SR", 3]].map(([s, i]) => cell(`X${i}000`, i));
  const map = mapOf(...[["FR", 0], ["SH", 1], ["JR", 2], ["SR", 3]].map(([s, i]) => course(`X${i}000`, s)));
  const { plans, impossible } = run(cells, terms, map);
  assert.equal(impossible.length, 0, "a standing gate must never be the reason a plan refuses");
  for (const p of plans) assert.ok(p.domain.length > 0);
});

test("a graduate plan is exempt entirely", () => {
  // A master's student takes 5000-level courses in their first term.
  const { plans } = run([cell("ENGW3302")], evenTerms(), mapOf(course("ENGW3302", "JR")),
    { studentType: "graduate" });
  assert.equal(plans[0].domain[0], 0);
});

test("narrowing composes with an existing exclusion rather than replacing it", () => {
  // A fall-only course that is also junior-gated: the surviving domain must satisfy
  // BOTH, and the standing rule must not resurrect a term the season ruled out.
  const terms = evenTerms();
  const map = mapOf(course("ENGW3302", "JR"));
  const { plans } = run([cell("ENGW3302")], terms, map,
    { offered: (id, semTypeId) => semTypeId === "fall" });
  assert.deepEqual(plans[0].domain, [4, 6], "fall terms at or after 64 SH");
});

test("a gate that removes nothing reports nothing", () => {
  // The floor sits at term 2 and the domain already starts at 4 (a deep prereq
  // chain). Reporting phantom exclusions would mislead the derivation view.
  const terms = evenTerms();
  const map = mapOf(course("X2000", "SH"));
  const { plans } = run([cell("X2000")], terms, map, { depthOf: () => 4 });
  assert.equal(plans[0].domain[0], 4);
  assert.equal((plans[0].excluded ?? []).some(e => e.reason === EXCLUSION.BEFORE_STANDING), false);
});
