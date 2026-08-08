// UNIT · which id a drop acts on.
//
// This existed twice. Dropping on a SEMESTER resolved a fresh instance id for a
// repeatable course already in the plan; dropping on a CARD did not, and so
// moved the existing take instead of adding one. The rule has no reason to
// differ by what is under the cursor, and two copies could only drift.
//
// The tests below try to make it add a take when it should move, and move when
// it should add — across repeatables, retakes, placed-out courses, reservation
// ids and every junk input the drag layer can hand it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDropId, resolveAddId, baseId } from "../../src/core/repeatInstances.js";

const REPEATABLE = { id: "MUS1990", repeatable: true, repeatMax: 4 };
const PLAIN      = { id: "CS3000", repeatable: false };
const courseMap  = { MUS1990: REPEATABLE, CS3000: PLAIN };

const drag = (id, fromSem = null) => ({ id, fromSem, type: "course" });
const ctx = (placements, extra = {}) =>
  ({ placements, courseMap, placedOut: new Set(), ...extra });

// ── The inconsistency X10 names ────────────────────────────────────

test("a bank drag of a placed repeatable ADDS a take, wherever it lands", () => {
  const placements = { MUS1990: "fall2026" };
  const got = resolveDropId(drag("MUS1990"), ctx(placements));
  assert.equal(got, "MUS1990#2", "the bank drag moved the existing take instead of adding one");
});

test("a GRID drag of the same course still moves it", () => {
  const placements = { MUS1990: "fall2026" };
  const got = resolveDropId(drag("MUS1990", "fall2026"), ctx(placements));
  assert.equal(got, "MUS1990", "a drag from inside the grid must stay a move");
});

test("the semester drop and the card drop now resolve identically", () => {
  // Both call sites pass the same drag object; the only difference used to be
  // that one of them called this at all.
  const placements = { MUS1990: "fall2026", "MUS1990#2": "spr2027" };
  const d = drag("MUS1990");
  const a = resolveDropId(d, ctx(placements));
  const b = resolveDropId(d, ctx(placements));
  assert.equal(a, b);
  assert.equal(a, "MUS1990#3", "should pick the lowest free instance");
});

// ── Not an add ─────────────────────────────────────────────────────

test("a course NOT in the plan keeps its base id", () => {
  assert.equal(resolveDropId(drag("MUS1990"), ctx({})), "MUS1990");
  assert.equal(resolveDropId(drag("CS3000"), ctx({})), "CS3000");
});

test("a non-repeatable course with no retake unlocked still MOVES", () => {
  // Keeping the existing semantics: dragging a plain placed course from the
  // bank relocates it rather than duplicating it.
  const placements = { CS3000: "fall2026" };
  assert.equal(resolveDropId(drag("CS3000"), ctx(placements)), "CS3000");
});

test("a palette drag is not treated as coming from outside the grid", () => {
  // PalettePanel passes fromSem: "palette" — not null — and the semester path
  // has always read that as "not an add". Pinned so the two stay aligned.
  const placements = { MUS1990: "fall2026" };
  assert.equal(resolveDropId(drag("MUS1990", "palette"), ctx(placements)), "MUS1990");
});

// ── Retakes ────────────────────────────────────────────────────────

test("a non-repeatable course whose take is graded resolves a retake id", () => {
  const placements = { CS3000: "fall2026" };
  const graded = resolveDropId(drag("CS3000"),
    ctx(placements, { grades: { CS3000: "C" } }));
  // Only asserted to agree with resolveAddId — the retake rules live there and
  // this function must not develop opinions of its own about them.
  assert.equal(graded, resolveAddId(PLAIN, placements, new Set(), { CS3000: "C" }).id);
});

test("resolveDropId never disagrees with resolveAddId for an outside drag", () => {
  const cases = [
    [{}, {}], [{ MUS1990: "fall2026" }, {}],
    [{ MUS1990: "fall2026", "MUS1990#2": "spr2027" }, {}],
    [{ CS3000: "fall2026" }, { CS3000: "F" }],
    [{ CS3000: "fall2026" }, {}],
  ];
  for (const [placements, grades] of cases) {
    for (const id of ["MUS1990", "CS3000"]) {
      const viaDrop = resolveDropId(drag(id), ctx(placements, { grades }));
      const course = courseMap[baseId(id)];
      const viaAdd = placements[id] == null
        ? id
        : resolveAddId(course, placements, new Set(), grades).id;
      assert.equal(viaDrop, viaAdd,
        `disagreed for ${id} with ${JSON.stringify(placements)} / ${JSON.stringify(grades)}`);
    }
  }
});

// ── Instance ids ───────────────────────────────────────────────────

test("dragging an INSTANCE from the bank resolves through its base course", () => {
  const placements = { MUS1990: "fall2026", "MUS1990#2": "spr2027" };
  const got = resolveDropId(drag("MUS1990#2"), ctx(placements));
  assert.equal(got, "MUS1990#3", "an instance drag should add the next take");
});

test("dragging an instance from the GRID keeps that exact instance", () => {
  const placements = { MUS1990: "fall2026", "MUS1990#2": "spr2027" };
  assert.equal(resolveDropId(drag("MUS1990#2", "spr2027"), ctx(placements)), "MUS1990#2");
});

// ── Reservations ───────────────────────────────────────────────────

test("a reservation id passes through untouched — it has no takes", () => {
  const placements = { MUS1990: "fall2026" };
  for (const fromSem of [null, "fall2026", "palette"]) {
    assert.equal(resolveDropId(drag("~res:abc", fromSem), ctx(placements)), "~res:abc");
  }
});

test("a reservation id is never looked up in the course map", () => {
  // A course map that throws on any access proves no lookup happens.
  const hostile = new Proxy({}, { get() { throw new Error("looked up a reservation"); } });
  assert.doesNotThrow(() =>
    resolveDropId(drag("~res:abc"), { placements: {}, courseMap: hostile, placedOut: new Set() }));
});

// ── Placed-out ─────────────────────────────────────────────────────

test("a placed-out repeatable still adds a take", () => {
  const got = resolveDropId(drag("MUS1990"),
    { placements: { MUS1990: "fall2026" }, courseMap, placedOut: new Set(["MUS1990"]) });
  assert.equal(got, "MUS1990#2");
});

test("a course that is ONLY placed out is not an add", () => {
  // `placements[id]` is null, so this is a plain drop of a course not on the
  // board. resolveAddId would see it as placed; the drop path deliberately
  // does not, matching what the semester path has always done.
  const got = resolveDropId(drag("MUS1990"),
    { placements: {}, courseMap, placedOut: new Set(["MUS1990"]) });
  assert.equal(got, "MUS1990");
});

// ── Degenerate input ───────────────────────────────────────────────

test("junk input is returned unchanged rather than thrown on", () => {
  for (const d of [null, undefined, {}, { id: null }, { id: 42 }, { id: "" }]) {
    assert.doesNotThrow(() => resolveDropId(d, ctx({})), JSON.stringify(d));
  }
  assert.equal(resolveDropId(drag("MUS1990"), undefined), "MUS1990", "no ctx");
  assert.equal(resolveDropId(drag("MUS1990"), {}), "MUS1990", "empty ctx");
  assert.equal(resolveDropId(drag("UNKNOWN"), ctx({ UNKNOWN: "fall2026" })), "UNKNOWN",
    "a course the map does not have must keep its id");
  assert.equal(resolveDropId(drag("MUS1990"), { placements: { MUS1990: "f" }, courseMap: null }),
    "MUS1990", "a missing course map must not add a take");
});

test("resolution is idempotent for a drag that is already a move", () => {
  const placements = { MUS1990: "fall2026" };
  const once = resolveDropId(drag("MUS1990", "fall2026"), ctx(placements));
  const twice = resolveDropId(drag(once, "fall2026"), ctx(placements));
  assert.equal(once, twice);
});

test("repeated ADD resolutions never collide once each is placed", () => {
  const placements = { MUS1990: "fall2026" };
  const seen = new Set(Object.keys(placements));
  for (let i = 0; i < 8; i++) {
    const id = resolveDropId(drag("MUS1990"), ctx(placements));
    assert.ok(!seen.has(id), `resolved ${id} twice`);
    seen.add(id);
    placements[id] = "spr2027";
  }
});
