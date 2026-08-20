// UNIT · scripts/lib/term-history.js › "not offered" needs evidence
//
// The bug these tests pin down was live in the monthly unattended scrape: Banner
// answered one term's first page with success:true/totalCount:0, the empty result
// was stored as an empty Set, and every course in the catalog was written `false`
// for that term — a wiped semester of offering history, pushed straight to main.
//
// So the property under test is one-directional and blunt: a term that returned
// nothing may never cause a `false` to be written, and may never delete a verdict
// the file already had.

import { test } from "node:test";
import assert   from "node:assert/strict";
import { knownTermCodes, buildTermHistory, mergePreviousHistory }
  from "../../scripts/lib/term-history.js";

const S = (...ids) => new Set(ids);

test("a term with sections is known; empty and absent are not", () => {
  const results = { "202510": S("CS2500"), "202530": S(), /* 202610 absent */ };
  assert.deepEqual(knownTermCodes(["202510", "202530", "202610"], results), ["202510"]);
});

test("known-term order follows the caller's list, not object order", () => {
  const results = { "202610": S("A"), "202510": S("A") };
  assert.deepEqual(knownTermCodes(["202510", "202610"], results), ["202510", "202610"]);
});

test("junk inputs yield no known terms rather than throwing", () => {
  assert.deepEqual(knownTermCodes(undefined, undefined), []);
  assert.deepEqual(knownTermCodes([], {}), []);
  assert.deepEqual(knownTermCodes(["202510"], {}), []);
  assert.deepEqual(knownTermCodes(["202510"], { "202510": null }), []);
});

// ── The core claim ──────────────────────────────────────────────────

test("an empty term produces no key at all, not a false", () => {
  const results = { "202510": S("CS2500"), "202530": S() };
  const known = knownTermCodes(["202510", "202530"], results);
  const hist = buildTermHistory(["CS2500", "MATH1341"], results, known);

  assert.deepEqual(hist.CS2500, { "202510": true });
  assert.equal("202530" in hist.CS2500, false,
    "the unread term must be ABSENT — a false here is the wiped-semester bug");
});

test("a course genuinely absent from a READ term still records false", () => {
  // The guard must not cost us the real negatives — that is the information the
  // offering history exists to carry.
  const results = { "202510": S("CS2500"), "202530": S("CS2500", "MATH1341") };
  const known = knownTermCodes(["202510", "202530"], results);
  const hist = buildTermHistory(["CS2500", "MATH1341"], results, known);

  assert.deepEqual(hist.CS2500,   { "202510": true,  "202530": true });
  assert.deepEqual(hist.MATH1341, { "202510": false, "202530": true });
});

test("a course offered in no known term is omitted entirely", () => {
  const results = { "202510": S("CS2500") };
  const hist = buildTermHistory(["CS2500", "RETIRED9999"], results, ["202510"]);
  assert.deepEqual(Object.keys(hist), ["CS2500"]);
});

test("every term empty means an empty history, not a catalog of falses", () => {
  // The total-outage case. Writing this would have claimed nothing was ever
  // offered, for every course, in every term.
  const results = { "202510": S(), "202530": S() };
  const known = knownTermCodes(["202510", "202530"], results);
  assert.deepEqual(known, []);
  assert.deepEqual(buildTermHistory(["CS2500", "MATH1341"], results, known), {});
});

// ── Merging must not let a failed read delete a good verdict ─────────

test("an empty term keeps its previous verdict", () => {
  const prev = { CS2500: { "202510": true, "202530": true } };
  const results = { "202510": S("CS2500"), "202530": S() };
  const known = knownTermCodes(["202510", "202530"], results);
  const merged = mergePreviousHistory(buildTermHistory(["CS2500"], results, known), prev, known);

  assert.equal(merged.CS2500["202530"], true,
    "202530 was queried but unreadable — the file's existing verdict must survive");
  assert.equal(merged.CS2500["202510"], true);
});

test("a known term retracts a stale offering rather than preserving it", () => {
  // The direction that must still work: a course really dropped from Spring. Note
  // the retraction lands as ABSENT, not false — CS2500 has no `true` in any known
  // term, so buildTermHistory omits it and the merge has nothing to reinstate. Both
  // readings are honest; what must not happen is the stale `true` surviving.
  const prev = { CS2500: { "202530": true } };
  const results = { "202530": S("MATH1341") };
  const known = knownTermCodes(["202530"], results);
  const merged = mergePreviousHistory(
    buildTermHistory(["CS2500", "MATH1341"], results, known), prev, known);

  assert.notEqual(merged.CS2500?.["202530"], true, "a read term must retract a stale offering");
  assert.equal(merged.MATH1341["202530"], true);
});

test("a course still offered elsewhere records the retraction as false", () => {
  // Same retraction, but the course survives in another known term, so it keeps an
  // entry and the dropped term is an explicit false.
  const prev = { CS2500: { "202510": true, "202530": true } };
  const results = { "202510": S("CS2500"), "202530": S("MATH1341") };
  const known = knownTermCodes(["202510", "202530"], results);
  const merged = mergePreviousHistory(
    buildTermHistory(["CS2500", "MATH1341"], results, known), prev, known);

  assert.deepEqual(merged.CS2500, { "202510": true, "202530": false });
});

test("terms outside the run are untouched", () => {
  const prev = { CS2500: { "202410": true, "202430": false } };
  const results = { "202530": S("CS2500") };
  const known = knownTermCodes(["202530"], results);
  const merged = mergePreviousHistory(buildTermHistory(["CS2500"], results, known), prev, known);
  assert.deepEqual(merged.CS2500, { "202410": true, "202430": false, "202530": true });
});

test("merging is pure — neither input is mutated", () => {
  const prev  = { CS2500: { "202410": true } };
  const fresh = { CS2500: { "202530": true } };
  const snapshot = JSON.stringify({ prev, fresh });
  mergePreviousHistory(fresh, prev, ["202530"]);
  assert.equal(JSON.stringify({ prev, fresh }), snapshot);
});

test("merging tolerates missing arguments", () => {
  assert.deepEqual(mergePreviousHistory(undefined, undefined, undefined), {});
  assert.deepEqual(mergePreviousHistory({ A: { t: true } }, null, []), { A: { t: true } });
  assert.deepEqual(mergePreviousHistory(null, { A: { t: true } }, []), { A: { t: true } });
});

// ── Property: no false without evidence, ever ───────────────────────

test("across random runs, a false only ever appears for a term that returned sections", () => {
  const CODES = ["202410", "202430", "202510", "202530", "202610"];
  const IDS   = ["A", "B", "C", "D"];
  // xorshift32, and the two rejected alternatives are worth recording because both
  // produced a sweep that PASSED while testing almost nothing:
  //   · `rng * 1103515245` exceeds 2^53 within a few steps, the low bits vanish into
  //     float rounding and the sequence goes constant — zero falses generated.
  //   · Math.imul fixes the overflow but an LCG modulo a power of two has a low bit
  //     of period 2, so `rand(2)` merely alternates and no term ever drew all four
  //     ids absent — zero empty terms generated, which is the case under test.
  // The sawFalse / sawEmptyTerm floors below caught both. They are not decoration.
  let rng = 424242;
  const rand = (n) => {
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >>> 17;
    rng ^= rng << 5;  rng >>>= 0;
    return rng % n;
  };

  let sawFalse = 0, sawEmptyTerm = 0;
  for (let i = 0; i < 3000; i++) {
    const results = {};
    for (const c of CODES) {
      if (rand(4) === 0) continue;                       // term absent entirely
      const set = S();
      for (const id of IDS) if (rand(2)) set.add(id);
      if (set.size === 0) sawEmptyTerm += 1;
      results[c] = set;
    }
    const known = knownTermCodes(CODES, results);
    const hist  = buildTermHistory(IDS, results, known);

    for (const [id, byTerm] of Object.entries(hist)) {
      for (const [tc, v] of Object.entries(byTerm)) {
        // Any recorded verdict — true OR false — requires a term that had sections.
        assert.ok(known.includes(tc), `${id} got a verdict for unknown term ${tc}`);
        assert.ok((results[tc]?.size ?? 0) > 0);
        assert.equal(v, results[tc].has(id));
        if (v === false) sawFalse += 1;
      }
      assert.ok(Object.values(byTerm).some(Boolean), `${id} kept with no true`);
    }
  }
  // Guard against a vacuous sweep: both interesting situations must have occurred.
  assert.ok(sawFalse > 100, `only ${sawFalse} falses generated`);
  assert.ok(sawEmptyTerm > 10, `only ${sawEmptyTerm} empty terms generated`);
});
