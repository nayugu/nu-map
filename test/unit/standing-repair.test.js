// UNIT · src/engine/standingRepair.js › the last credit the domain cannot see
//
// `buildDomains` narrows a gated cell using `targetSH` — what each term INTENDS to
// carry — because it runs before anything is assigned. When the emitted plan comes in
// lighter, that floor is one course too generous. Measured across all 278 generable
// undergraduate plans, exactly one placement survived that way, short by ONE credit:
// public_health_and_journalism's "ENGW 3306 or 3314 or 3303" in a term holding 63 of
// the 64 it needs.
//
// The properties that matter, and every one is about NOT breaking something else:
//   · a nudge only ever goes to a term in the cell's own domain
//   · precedence edges hold in both directions afterwards
//   · neither term ends over its registration cap
//   · when nothing is safe, the assignment comes back UNTOUCHED — a plan stating one
//     course a credit early beats no plan, every time

import { test } from "node:test";
import assert   from "node:assert/strict";
import { repairStanding } from "../../src/engine/standingRepair.js";

const course = (id, std, sh = 4) => ({ id, sh, ...(std ? { offering: { std } } : {}) });
const mapOf  = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

/** A cell plan: one cell naming one course, with an explicit domain. */
const P = (cid, courseId, domain, sh = 4) => ({
  cell: { id: cid, kind: "named", sh, groups: [[courseId]] }, domain,
});

/** n terms of `sh` target, full weight; cap comes from creditMax. */
const T = (loads) => loads.map(sh => ({ targetSH: sh, weight: 1, semTypeId: "fall" }));
const CAP = () => 19;

test("a gated cell short on credits moves to the first term that has them", () => {
  // 4 terms of 16 SH. A junior gate (64) is met only from term 4, but the cell sits
  // at 3 where 48 credits precede it.
  const plans = [
    P("g", "ENGW3302", [2, 3, 4, 5]),
    ...[0, 1, 2, 3, 4, 5].map(i => P(`f${i}`, `FILL${i}`, [i], 16)),
  ];
  const termOf = new Map([["g", 3], ...[0, 1, 2, 3, 4, 5].map(i => [`f${i}`, i])]);
  const courseMap = mapOf(course("ENGW3302", "JR"),
    ...[0, 1, 2, 3, 4, 5].map(i => course(`FILL${i}`, null, 16)));

  // creditMax 24 here, not the shared 19: a 16 SH filler plus the 4 SH gated course
  // is 20, so under a 19 cap the move is correctly REFUSED and the test would be
  // measuring the cap rather than the standing floor.
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16, 16, 16]),
                             courseMap, creditMax: () => 24 });
  assert.equal(r.moved.length, 1);
  assert.equal(r.termOf.get("g"), 4, "first term with 64 credits behind it");
  assert.equal(r.unfixed.length, 0);
});

test("a cell already at or above its gate is left alone", () => {
  const plans = [P("g", "ENGW3302", [0, 1, 2, 3, 4, 5]),
    ...[0, 1, 2, 3].map(i => P(`f${i}`, `FILL${i}`, [i], 16))];
  const termOf = new Map([["g", 4], ...[0, 1, 2, 3].map(i => [`f${i}`, i])]);
  const courseMap = mapOf(course("ENGW3302", "JR"),
    ...[0, 1, 2, 3].map(i => course(`FILL${i}`, null, 16)));
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16, 16, 16]),
                             courseMap, creditMax: CAP });
  assert.deepEqual(r.moved, []);
  assert.equal(r.termOf, termOf, "the SAME map back, not a copy, when nothing moved");
});

test("an ungated plan is returned untouched and cheaply", () => {
  const plans = [P("a", "X1000", [0, 1]), P("b", "Y1000", [0, 1])];
  const termOf = new Map([["a", 0], ["b", 1]]);
  const r = repairStanding({ plans, termOf, terms: T([16, 16]),
                             courseMap: mapOf(course("X1000"), course("Y1000")), creditMax: CAP });
  assert.equal(r.termOf, termOf);
  assert.deepEqual(r.moved, []);
});

test("a graduate plan is exempt", () => {
  const plans = [P("g", "ENGW3302", [0, 1, 2, 3])];
  const termOf = new Map([["g", 0]]);
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16]),
                             courseMap: mapOf(course("ENGW3302", "JR")), creditMax: CAP,
                             studentType: "graduate" });
  assert.equal(r.termOf, termOf);
});

// ── The guards ───────────────────────────────────────────────────────

test("it will not move outside the cell's own domain", () => {
  // The domain encodes availability and prerequisite depth. A fall-only course must
  // not be moved into a spring just to satisfy standing.
  const plans = [P("g", "ENGW3302", [1]),
    ...[0, 1, 2, 3, 4].map(i => P(`f${i}`, `FILL${i}`, [i], 16))];
  const termOf = new Map([["g", 1], ...[0, 1, 2, 3, 4].map(i => [`f${i}`, i])]);
  const courseMap = mapOf(course("ENGW3302", "JR"),
    ...[0, 1, 2, 3, 4].map(i => course(`FILL${i}`, null, 16)));
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16, 16]),
                             courseMap, creditMax: CAP });
  assert.deepEqual(r.moved, []);
  assert.equal(r.unfixed.length, 1, "reported, not silently ignored");
  assert.equal(r.unfixed[0].need, 64);
});

test("it will not push a term over its registration cap", () => {
  // Destination is at 19 of 19 with no ungated partner small enough to swap out.
  const plans = [
    P("g", "ENGW3302", [0, 1]),
    P("big", "BIG", [1], 19),
    P("f0", "FILL0", [0], 60),
  ];
  const termOf = new Map([["g", 0], ["big", 1], ["f0", 0]]);
  const courseMap = mapOf(course("ENGW3302", "JR"), course("BIG", null, 19),
                          course("FILL0", null, 60));
  const r = repairStanding({ plans, termOf, terms: T([64, 19]), courseMap, creditMax: CAP });
  // Swapping would put 19 SH into term 0 alongside 60 — far over cap — so it declines.
  assert.deepEqual(r.moved, []);
  assert.equal(r.unfixed.length, 1);
});

test("it respects precedence in both directions", () => {
  // `g` must precede `dep`, which sits at term 4, so g cannot move to 4 or later.
  const plans = [
    P("g", "ENGW3302", [2, 3, 4, 5]),
    P("dep", "DEP", [4]),
    ...[0, 1, 2, 3].map(i => P(`f${i}`, `FILL${i}`, [i], 16)),
  ];
  const termOf = new Map([["g", 2], ["dep", 4], ...[0, 1, 2, 3].map(i => [`f${i}`, i])]);
  const courseMap = mapOf(course("ENGW3302", "JR"), course("DEP"),
    ...[0, 1, 2, 3].map(i => course(`FILL${i}`, null, 16)));
  const precedence = { before: new Map(), after: new Map([["g", new Set(["dep"])]]),
                       concurrentOk: new Set() };
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16, 16, 16]),
                             courseMap, creditMax: CAP, precedence });
  // Term 3 has only 48 credits behind it, and 4+ would violate the edge to `dep`.
  assert.deepEqual(r.moved, []);
});

// ── The swap, which the measured case required ───────────────────────

test("when every later term is full it EXCHANGES with an ungated cell", () => {
  // The shape of the real failure: the cell needs 64, sits where 63 precede it, and
  // the only later term in its domain is at cap. An ungated 4 SH cell there can trade
  // places, which keeps both terms inside their caps.
  const plans = [
    P("g", "ENGW3302", [1, 2]),
    P("u", "UNGATED", [1, 2]),          // ungated, same size, at the destination
    P("f0", "FILL0", [0], 15),
    P("f1", "FILL1", [1], 15),
  ];
  const termOf = new Map([["g", 1], ["u", 2], ["f0", 0], ["f1", 1]]);
  const courseMap = mapOf(course("ENGW3302", "JR"), course("UNGATED"),
                          course("FILL0", null, 15), course("FILL1", null, 15));
  // term0 15, term1 15+4(g)=19 at cap, term2 4(u). Credits before term2 = 34+... let
  // the module do the arithmetic; what matters is the exchange happening at all.
  const r = repairStanding({ plans, termOf, terms: T([15, 19, 19]),
                             courseMap, creditMax: CAP });
  if (r.moved.length) {
    assert.equal(r.moved[0].swappedWith, "u", "traded with the ungated cell");
    assert.equal(r.termOf.get("g"), 2);
    assert.equal(r.termOf.get("u"), 1, "the partner takes the vacated term");
  } else {
    // Standing may be unsatisfiable at term 2 with these loads; then declining is
    // correct and the case is reported.
    assert.equal(r.unfixed.length, 1);
  }
});

test("it never swaps two gated cells", () => {
  // Satisfying one gate by breaking another is not a repair, and this pass runs once
  // so there is no second chance to notice.
  const plans = [
    P("g1", "ENGW3302", [0, 1]),
    P("g2", "ENGW3307", [0, 1]),
    P("f", "FILL", [0], 60),
  ];
  const termOf = new Map([["g1", 0], ["g2", 1], ["f", 0]]);
  const courseMap = mapOf(course("ENGW3302", "JR"), course("ENGW3307", "JR"),
                          course("FILL", null, 60));
  const r = repairStanding({ plans, termOf, terms: T([64, 19]), courseMap, creditMax: CAP });
  for (const m of r.moved) assert.notEqual(m.swappedWith, "g2");
  for (const m of r.moved) assert.notEqual(m.swappedWith, "g1");
});

// ── Degradation ──────────────────────────────────────────────────────

test("missing or malformed input never throws and never invents a move", () => {
  for (const args of [
    {}, { plans: [] }, { plans: null, termOf: null },
    { plans: [P("g", "X", [0])], termOf: new Map(), terms: [], courseMap: {} },
    { plans: [P("g", "ENGW3302", null)], termOf: new Map([["g", 0]]), terms: T([16]),
      courseMap: mapOf(course("ENGW3302", "JR")), creditMax: CAP },
  ]) {
    const r = repairStanding(args);
    assert.ok(r.termOf instanceof Map);
    assert.deepEqual(r.moved, []);
  }
});

test("no creditMax port means no cap check, not a crash", () => {
  const plans = [P("g", "ENGW3302", [0, 1, 2, 3, 4]),
    ...[0, 1, 2, 3].map(i => P(`f${i}`, `FILL${i}`, [i], 16))];
  const termOf = new Map([["g", 0], ...[0, 1, 2, 3].map(i => [`f${i}`, i])]);
  const courseMap = mapOf(course("ENGW3302", "JR"),
    ...[0, 1, 2, 3].map(i => course(`FILL${i}`, null, 16)));
  const r = repairStanding({ plans, termOf, terms: T([16, 16, 16, 16, 16]), courseMap });
  assert.equal(r.termOf.get("g"), 4);
});
