// UNIT · the candidate spec algebra, checked by brute force against the real
// catalog.
//
// A compressed set is only useful if its operations mean exactly what the
// expanded ones would. So every property here is verified the expensive way:
// run the operation symbolically, then walk all ~8,000 catalog courses and
// compare membership against `courseEligible` applied to the operands.
//
// That is the only check worth making. A hand-written expectation would be a
// second implementation of the same idea, and would agree with the first
// wherever both were wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { emptySpec, courseEligible, specForNode } from "../../src/core/programEligibility.js";
import {
  cloneSpec, unionSpec, unionAll, intersectSpec, intersectAll,
  subtractIds, isEmptySpec, materialize, countSpec,
} from "../../src/core/candidateSpec.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ── the universe ───────────────────────────────────────────────────

const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSES = raw.map(c => ({
  id: `${c.subject}${parseInt(c.number, 10)}`,
  subject: c.subject,
  number: String(parseInt(c.number, 10)),
}));
const COURSE_MAP = {};
for (const c of COURSES) COURSE_MAP[c.id] = c;

/** Membership of every real course — the ground truth every property uses. */
const denote = (spec) => {
  const out = new Set();
  for (const c of COURSES) if (courseEligible(c, spec)) out.add(c.id);
  return out;
};
const sameSet = (a, b, msg) => {
  if (a.size !== b.size) assert.fail(`${msg}: sizes ${a.size} vs ${b.size}`);
  for (const x of a) if (!b.has(x)) assert.fail(`${msg}: ${x} in first only`);
};

// ── real specs, drawn from shipped programs ────────────────────────

function realSpecs(limit = 240) {
  const out = [];
  const base = join(ROOT, "data/northeastern/programs/majors/2026");
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs) {
      const f = join(base, college, prog, "parsed.initial.json");
      if (!existsSync(f)) continue;
      let data;
      try { data = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      for (const section of data.requirementSections ?? []) {
        const s = specForNode(section);
        if (!isEmptySpec(s)) out.push(s);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
const SPECS = realSpecs();

// Deterministic PRNG — a failing pair has to be reproducible.
let seed = 20260808;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rand() * a.length)];

// ── adversarial specs the corpus may never produce ─────────────────
//
// Real sections are well behaved. These are the shapes that break a careless
// implementation, written by hand so they are guaranteed to be exercised.

const S = (keys = [], ranges = []) => ({
  keys: new Set(keys),
  ranges: ranges.map(([subject, start, end, exceptions = []]) =>
    ({ subject, start, end, exceptions: new Set(exceptions) })),
});

// Fixture ids, pinned to courses that DO exist.
//
// `CS3500` is the obvious choice for a hand-written fixture and is not in the
// catalog: NEU renumbered CS 2500/2510/3500 and only the prerequisite text
// still cites the old numbers. A fixture built on one would pass vacuously —
// every membership question about a non-existent course answers "no" — so the
// ids are pinned and asserted below rather than assumed.
const REAL  = "CS3200";   // inside CS 3000–4000
const REAL2 = "CS3100";   // also inside, used as an exception
const FAKE  = "ZZ9999";   // in no catalog

const ADVERSARIAL = [
  emptySpec(),
  // a key that a range in the SAME spec excludes — keys must still win
  S([REAL], [["CS", 3000, 4000, [REAL]]]),
  // overlapping ranges, same subject, different exceptions
  S([], [["CS", 2000, 3000, ["CS2000"]], ["CS", 2500, 3500, [REAL2]]]),
  // touching ranges (boundary arithmetic)
  S([], [["MATH", 1000, 2000], ["MATH", 2000, 3000]]),
  // a single-point range
  S([], [["CS", 3200, 3200]]),
  // an inverted range should denote nothing
  S([], [["CS", 4000, 3000]]),
  // a range whose exceptions remove everything it covers
  S([], [["CS", 3200, 3200, [REAL]]]),
  // keys only, including one the catalog does not have
  S([REAL, FAKE]),
  // different subjects entirely — intersection must be empty
  S([], [["ENGW", 1000, 5000]]),
  S([], [["PHYS", 1000, 5000]]),
];

// ═══════════════════════════════════════════════════════════════════
// The three operations, verified against the expanded truth
// ═══════════════════════════════════════════════════════════════════

test("the corpus yields enough real specs to be a real test", () => {
  assert.ok(SPECS.length >= 200, `only ${SPECS.length} specs found — corpus missing?`);
  assert.ok(COURSES.length > 7000, `only ${COURSES.length} courses`);
});

test("hand-written fixtures name courses that actually exist", () => {
  // Without this, a renumbering turns half the suite below into assertions
  // about nothing, and they would all still pass.
  assert.ok(COURSE_MAP[REAL],  `${REAL} is not in the catalog — repin the fixtures`);
  assert.ok(COURSE_MAP[REAL2], `${REAL2} is not in the catalog — repin the fixtures`);
  assert.ok(!COURSE_MAP[FAKE], `${FAKE} unexpectedly exists — pick another non-course`);
  const n = parseInt(COURSE_MAP[REAL].number, 10);
  assert.ok(n >= 3000 && n < 4000, `${REAL} must sit inside CS 3000–4000, got ${n}`);
  assert.equal(COURSE_MAP[REAL].subject, "CS", "fixture subject drifted");
});

test("union denotes exactly the union, on real spec pairs", () => {
  for (let i = 0; i < 400; i++) {
    const a = pick(SPECS), b = pick(SPECS);
    const got = denote(unionSpec(a, b));
    const want = new Set([...denote(a), ...denote(b)]);
    sameSet(got, want, `union #${i}`);
  }
});

test("intersect denotes exactly the intersection, on real spec pairs", () => {
  for (let i = 0; i < 400; i++) {
    const a = pick(SPECS), b = pick(SPECS);
    const got = denote(intersectSpec(a, b, COURSE_MAP));
    const da = denote(a), db = denote(b);
    const want = new Set([...da].filter(x => db.has(x)));
    sameSet(got, want, `intersect #${i}`);
  }
});

test("union and intersect are exact on adversarial specs too", () => {
  for (const a of ADVERSARIAL) {
    for (const b of [...ADVERSARIAL, ...SPECS.slice(0, 20)]) {
      const da = denote(a), db = denote(b);
      sameSet(denote(unionSpec(a, b)), new Set([...da, ...db]), "adversarial union");
      sameSet(denote(intersectSpec(a, b, COURSE_MAP)),
              new Set([...da].filter(x => db.has(x))), "adversarial intersect");
    }
  }
});

test("a key beats an exception in the same spec", () => {
  // The one asymmetry in courseEligible. If this regresses, a directly named
  // course silently disappears from its own requirement.
  const spec = S([REAL], [["CS", 3000, 4000, [REAL]]]);
  assert.ok(denote(spec).has(REAL), "the named course was excluded by its own range");
  // and it must survive every operation
  assert.ok(denote(unionSpec(spec, emptySpec())).has(REAL), "union lost it");
  assert.ok(denote(intersectSpec(spec, spec, COURSE_MAP)).has(REAL), "self-intersect lost it");
  assert.ok(denote(cloneSpec(spec)).has(REAL), "clone lost it");
  assert.ok(denote(subtractIds(spec, [REAL2])).has(REAL), "unrelated subtraction lost it");
});

test("subtract removes exactly the ids given, however they were matched", () => {
  for (let i = 0; i < 150; i++) {
    const a = pick(SPECS);
    const inside = [...denote(a)];
    if (!inside.length) continue;
    // Remove a mix of members and non-members.
    const drop = new Set([
      inside[Math.floor(rand() * inside.length)],
      inside[Math.floor(rand() * inside.length)],
      FAKE,
    ]);
    const got = denote(subtractIds(a, drop));
    const want = new Set([...denote(a)].filter(x => !drop.has(x)));
    sameSet(got, want, `subtract #${i}`);
  }
});

test("subtract reaches a course matched by a range, not just by a key", () => {
  const spec = S([], [["CS", 3000, 4000]]);
  const before = denote(spec);
  assert.ok(before.has(REAL), `fixture assumption: ${REAL} is in CS 3000-4000`);
  const after = denote(subtractIds(spec, [REAL]));
  assert.ok(!after.has(REAL), "a range-matched course survived subtraction");
  assert.equal(after.size, before.size - 1, "subtraction removed more than it was asked to");
});

// ═══════════════════════════════════════════════════════════════════
// Algebraic laws — these catch classes of error the samples might miss
// ═══════════════════════════════════════════════════════════════════

test("laws: idempotence, commutativity, associativity", () => {
  for (let i = 0; i < 120; i++) {
    const a = pick(SPECS), b = pick(SPECS), c = pick(SPECS);
    const da = denote(a);

    sameSet(denote(unionSpec(a, a)), da, "union idempotence");
    sameSet(denote(intersectSpec(a, a, COURSE_MAP)), da, "intersect idempotence");

    sameSet(denote(unionSpec(a, b)), denote(unionSpec(b, a)), "union commutativity");
    sameSet(denote(intersectSpec(a, b, COURSE_MAP)),
            denote(intersectSpec(b, a, COURSE_MAP)), "intersect commutativity");

    sameSet(denote(unionSpec(unionSpec(a, b), c)),
            denote(unionSpec(a, unionSpec(b, c))), "union associativity");
    sameSet(denote(intersectSpec(intersectSpec(a, b, COURSE_MAP), c, COURSE_MAP)),
            denote(intersectSpec(a, intersectSpec(b, c, COURSE_MAP), COURSE_MAP)),
            "intersect associativity");
  }
});

test("laws: absorption and distribution", () => {
  for (let i = 0; i < 80; i++) {
    const a = pick(SPECS), b = pick(SPECS), c = pick(SPECS);
    // a ∩ (a ∪ b) = a
    sameSet(denote(intersectSpec(a, unionSpec(a, b), COURSE_MAP)), denote(a), "absorption ∩");
    // a ∪ (a ∩ b) = a
    sameSet(denote(unionSpec(a, intersectSpec(a, b, COURSE_MAP))), denote(a), "absorption ∪");
    // a ∩ (b ∪ c) = (a ∩ b) ∪ (a ∩ c)
    sameSet(denote(intersectSpec(a, unionSpec(b, c), COURSE_MAP)),
            denote(unionSpec(intersectSpec(a, b, COURSE_MAP), intersectSpec(a, c, COURSE_MAP))),
            "distribution");
  }
});

test("intersection only ever shrinks — the property every filter relies on", () => {
  // §11's monotonicity rests on this. If an intersection could ADD a course,
  // a narrowing pass could hand a card back a candidate it had ruled out.
  for (let i = 0; i < 200; i++) {
    const a = pick(SPECS), b = pick(SPECS);
    const da = denote(a);
    for (const x of denote(intersectSpec(a, b, COURSE_MAP))) {
      assert.ok(da.has(x), `intersect ADDED ${x}, which breaks monotonicity`);
    }
  }
});

test("subtraction only ever shrinks", () => {
  for (let i = 0; i < 120; i++) {
    const a = pick(SPECS);
    const da = denote(a);
    const ids = [...da].slice(0, 3);
    for (const x of denote(subtractIds(a, ids))) {
      assert.ok(da.has(x), `subtract ADDED ${x}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// Inputs are never mutated — shared specs are held by several cards
// ═══════════════════════════════════════════════════════════════════

test("no operation mutates its inputs", () => {
  const snapshot = (s) => JSON.stringify({
    keys: [...s.keys].sort(),
    ranges: s.ranges.map(r => [r.subject, r.start, r.end, [...r.exceptions].sort()]),
  });
  for (let i = 0; i < 60; i++) {
    const a = pick(SPECS), b = pick(SPECS);
    const sa = snapshot(a), sb = snapshot(b);
    unionSpec(a, b);
    intersectSpec(a, b, COURSE_MAP);
    subtractIds(a, [REAL, "MATH2331"]);
    cloneSpec(a);
    unionAll([a, b]);
    intersectAll([a, b], COURSE_MAP);
    assert.equal(snapshot(a), sa, "input a was mutated");
    assert.equal(snapshot(b), sb, "input b was mutated");
  }
});

test("a clone shares no mutable structure with its source", () => {
  const a = S([REAL], [["CS", 3000, 4000, [REAL2]]]);
  const c = cloneSpec(a);
  c.keys.add("ZZ1111");
  c.ranges[0].exceptions.add("ZZ2222");
  c.ranges.push({ subject: "X", start: 1, end: 2, exceptions: new Set() });
  assert.ok(!a.keys.has("ZZ1111"), "clone shared the key set");
  assert.ok(!a.ranges[0].exceptions.has("ZZ2222"), "clone shared an exception set");
  assert.equal(a.ranges.length, 1, "clone shared the range array");
});

// ═══════════════════════════════════════════════════════════════════
// Degenerate input — these must not throw, because they arrive from data
// ═══════════════════════════════════════════════════════════════════

test("null, undefined and malformed specs are handled, not thrown on", () => {
  const a = pick(SPECS);
  const malformed = [
    null, undefined, {},
    { keys: new Set() },                       // no ranges
    { ranges: [] },                            // no keys — this one threw
    { keys: [REAL], ranges: [] },              // keys as an array (survives JSON)
    { keys: new Set([REAL]), ranges: [{ subject: "CS", start: 1, end: 2 }] }, // no exceptions
    { keys: new Set(), ranges: [null] },       // a hole in the range list
    { keys: new Set(), ranges: "nonsense" },   // ranges not an array at all
  ];
  for (const bad of malformed) {
    assert.doesNotThrow(() => unionSpec(a, bad), `union with ${JSON.stringify(bad)}`);
    assert.doesNotThrow(() => unionSpec(bad, a), "union, bad first");
    assert.doesNotThrow(() => intersectSpec(a, bad, COURSE_MAP), "intersect");
    assert.doesNotThrow(() => intersectSpec(bad, a, COURSE_MAP), "intersect, bad first");
    assert.doesNotThrow(() => subtractIds(bad, ["CS3500"]), "subtract");
    assert.doesNotThrow(() => cloneSpec(bad), "clone");
    assert.doesNotThrow(() => materialize(bad, COURSE_MAP), "materialize");
  }
  assert.doesNotThrow(() => unionAll(null), "unionAll(null)");
  assert.doesNotThrow(() => intersectAll(null, COURSE_MAP), "intersectAll(null)");
  assert.doesNotThrow(() => subtractIds(a, null), "subtract null ids");
});

test("intersecting with nothing is nothing, unioning with nothing is unchanged", () => {
  const a = pick(SPECS);
  assert.equal(denote(intersectSpec(a, emptySpec(), COURSE_MAP)).size, 0, "x ∩ ∅ ≠ ∅");
  sameSet(denote(unionSpec(a, emptySpec())), denote(a), "x ∪ ∅ ≠ x");
});

test("intersect without a course map does not silently keep unmatched keys", () => {
  // A caller that forgets the course map must get a CONSERVATIVE result (fewer
  // candidates), never a wrong one. Keys cannot be tested without it, so they
  // are dropped; ranges are unaffected because they need no lookup.
  const a = S([REAL], [["CS", 3000, 4000]]);
  const b = S([REAL], [["CS", 3100, 3300]]);
  const withMap = denote(intersectSpec(a, b, COURSE_MAP));
  const without = denote(intersectSpec(a, b));
  for (const x of without) assert.ok(withMap.has(x), `${x} appeared without a course map`);
  assert.ok(withMap.has(REAL), "fixture should intersect to something with a map");
});

// ═══════════════════════════════════════════════════════════════════
// materialize / count
// ═══════════════════════════════════════════════════════════════════

test("materialize agrees with courseEligible on every real spec", () => {
  for (const spec of SPECS.slice(0, 120)) {
    sameSet(materialize(spec, COURSE_MAP), denote(spec), "materialize");
  }
});

test("materialize omits keys the catalog does not have", () => {
  const spec = S([REAL, FAKE]);
  const got = materialize(spec, COURSE_MAP);
  assert.ok(got.has(REAL), "dropped a real course");
  assert.ok(!got.has(FAKE), "kept a course the catalog does not have");
});

test("countSpec equals the size of the materialized set", () => {
  for (const spec of SPECS.slice(0, 60)) {
    assert.equal(countSpec(spec, COURSE_MAP), denote(spec).size, "countSpec disagreed");
  }
});

test("isEmptySpec means 'accepts nothing', not 'accepts everything'", () => {
  assert.ok(isEmptySpec(emptySpec()), "empty spec not recognised");
  assert.ok(isEmptySpec(null), "null not treated as empty");
  assert.ok(!isEmptySpec(S([REAL])), "a spec with a key called empty");
  assert.ok(!isEmptySpec(S([], [["CS", 1, 2]])), "a spec with a range called empty");
  // A spec can be non-empty structurally yet denote nothing. That is not the
  // same question, and conflating them would hide "no course can go here".
  const denotesNothing = S([], [["CS", 3200, 3200, [REAL]]]);
  assert.ok(!isEmptySpec(denotesNothing), "structural emptiness confused with denotation");
  assert.equal(denote(denotesNothing).size, 0, "fixture should denote nothing");
});
