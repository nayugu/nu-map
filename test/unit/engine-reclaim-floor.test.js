// UNIT · src/engine/objective.js `reclaimFromFiller` — the floor that says how early is too early.
//
// This pass takes an early term back from a placeholder and gives it to a real requirement, which
// is the defect CHART was built to fix. Its one bound is a FLOOR: a course may not be pulled in
// front of where a course of its kind belongs, because that is where the gates nobody recorded
// bite — "junior standing or above" lives in prose `RESTRICTION_ONLY` discards.
//
// The floor was the LEVEL BAND alone, and the band is a median over every course of a level. For
// the courses this pass actually moves that is too coarse in a way a reader notices:
//
//     ENGW 3302   band (3000-level)  0.64      26 departments that place it   0.769
//
// So the pass reclaimed Advanced Writing to study term 5 of 10 — inside the band's one-term slack,
// with every guard reporting itself satisfied — and the plan showed it BEFORE THE FIRST CO-OP.
//
// The per-course position now raises the floor where the corpus has an opinion. It can only ever
// REFUSE a move; it never chooses one, and that distinction is the whole licence for reading this
// corpus at all, since the same published plans violate prerequisite order in 7.7% of cases and
// season in 31.9%.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reclaimFromFiller } from "../../src/engine/objective.js";

const course = (id, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

/** A bounded cell — one that names courses, so the pass may pull it forward. */
const want = (id, ids, domain) => ({
  cell: { id, kind: "named", groups: [ids], sh: 4, title: id },
  candidates: [...ids], domain,
});
/** A filler — `candidates === null` is the only test the pass uses. */
const filler = (id, domain) => ({
  cell: { id, kind: "open", groups: null, sh: 4, title: "General Elective", target: "~general" },
  candidates: null, domain,
});

// Ten terms, so a study-term index maps cleanly onto the 0..1 positions the corpus is measured in.
const TERMS = Array.from({ length: 10 }, (_, i) => ({ label: `T${i}`, weight: 1, targetSH: 16 }));
const ALL = TERMS.map((_, i) => i);
const CAP = TERMS.map(() => 99);
const yes = () => true;

test("reclaim floor › a placeholder's early term goes to a real requirement", () => {
  // The pass's whole purpose, and the control for everything below: with no corpus opinion and a
  // 1000-level course, nothing should stop the exchange.
  const courseMap = mapOf(course("AAA1000"));
  const plans = [filler("f", ALL), want("w", ["AAA1000"], ALL)];
  const termOf = new Map([["f", 1], ["w", 8]]);
  const out = reclaimFromFiller(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, positions: null,
  });
  assert.equal(out.moves, 1, "a 1000-level course should take the early term from a placeholder");
  assert.equal(out.termOf.get("w"), 1);
});

test("reclaim floor › the CORPUS position refuses a pull the level band would allow", () => {
  // The `ENGW 3302` case, in miniature and with the real numbers. Term 5 of 10 is 0.556, which
  // clears the 3000-level band of 0.64 by the one-term slack — and is a long way in front of the
  // 0.769 the departments that teach it actually use.
  const courseMap = mapOf(course("ENGW3302"));
  const plans = [filler("f", ALL), want("w", ["ENGW3302"], ALL)];
  const termOf = new Map([["f", 5], ["w", 8]]);
  const band = reclaimFromFiller(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, positions: null,
  });
  assert.equal(band.moves, 1, "the level band alone permits this — which is the defect");

  const floored = reclaimFromFiller(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { ENGW3302: { at: 0.769, programs: 26 } },
  });
  assert.equal(floored.moves, 0, "advanced writing was pulled in front of every department");
  assert.equal(floored.termOf.get("w"), 8);
});

test("reclaim floor › the corpus never PROMOTES, only refuses", () => {
  // The asymmetry that keeps this a witness rather than a source. A course the corpus places LATE
  // must not be dragged late by it — the floor bounds how early a move may go and says nothing
  // about staying put. `w` is already at 8 and there is no filler before it to trade with, so a
  // floor that "aimed" at 0.769 would have to invent a move. It must not.
  const courseMap = mapOf(course("ENGW3302"));
  const plans = [filler("f", ALL), want("w", ["ENGW3302"], ALL)];
  const termOf = new Map([["f", 9], ["w", 8]]);
  const out = reclaimFromFiller(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { ENGW3302: { at: 0.769, programs: 26 } },
  });
  assert.equal(out.moves, 0, "the floor moved a course it should only ever have refused");
  assert.equal(out.termOf.get("w"), 8);
});

test("reclaim floor › a course the corpus has never placed keeps the BAND", () => {
  // 334 courses clear the support bar; the catalog has 7,966. The overwhelming majority of cells
  // have no corpus opinion, and for them the behaviour must be exactly what shipped before —
  // otherwise this change is not a floor, it is a new policy for everything.
  const courseMap = mapOf(course("ZZZ1000"));
  const plans = [filler("f", ALL), want("w", ["ZZZ1000"], ALL)];
  const termOf = new Map([["f", 1], ["w", 8]]);
  const out = reclaimFromFiller(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { SOMETHINGELSE9999: { at: 0.9, programs: 40 } },
  });
  assert.equal(out.moves, 1, "an unmeasured course must behave exactly as before");
});

test("reclaim floor › the LATER of the two floors wins, in both directions", () => {
  // Neither bound excuses the other. A 4000-level course the corpus places EARLY still owes the
  // band, because the band carries the standing proxy; a 1000-level course the corpus places LATE
  // owes the corpus. Taking either alone would open one of these two holes.
  const courseMap = mapOf(course("XXX4000"), course("YYY1000"));
  // 4000-level (band 0.91) that the corpus happens to place at 0.20 — the band must still hold.
  const a = reclaimFromFiller(new Map([["f", 1], ["w", 9]]), {
    plans: [filler("f", ALL), want("w", ["XXX4000"], ALL)],
    terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { XXX4000: { at: 0.20, programs: 12 } },
  });
  assert.equal(a.moves, 0, "a low corpus position must not erase the level floor");
  // 1000-level (band 0.00) that the corpus places at 0.80 — the corpus must hold.
  const b = reclaimFromFiller(new Map([["f", 1], ["w", 9]]), {
    plans: [filler("f", ALL), want("w", ["YYY1000"], ALL)],
    terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { YYY1000: { at: 0.80, programs: 12 } },
  });
  assert.equal(b.moves, 0, "a zero level floor must not erase the corpus position");
});

test("reclaim floor › a corequisite group is bounded by its EARLIEST member", () => {
  // A group sits in one term and is ready when its earliest member is. Taking the latest would bar
  // the pair from a term one half of it plainly occupies in published plans.
  const courseMap = mapOf(course("PAIR1000"), course("PAIR1001"));
  const plans = [filler("f", ALL), want("w", ["PAIR1000", "PAIR1001"], ALL)];
  const out = reclaimFromFiller(new Map([["f", 1], ["w", 8]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    positions: { PAIR1000: { at: 0.0, programs: 30 }, PAIR1001: { at: 0.9, programs: 30 } },
  });
  assert.equal(out.moves, 1, "the group was held back by its latest member instead of its earliest");
});

test("reclaim floor › malformed position data is ignored, not obeyed", () => {
  // This arrives from a derived JSON file over the network in the browser. A missing `at`, a
  // string, a null record or a junk payload must degrade to the band rather than throw or bar
  // every move — the adapter already catches a failed fetch, and this is the half that survives it.
  const courseMap = mapOf(course("AAA1000"));
  const plans = [filler("f", ALL), want("w", ["AAA1000"], ALL)];
  for (const positions of [
    {}, null, undefined, { AAA1000: null }, { AAA1000: {} },
    { AAA1000: { at: "late" } }, { AAA1000: { at: NaN } }, { AAA1000: 0.9 },
  ]) {
    const out = reclaimFromFiller(new Map([["f", 1], ["w", 8]]), {
      plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, positions,
    });
    assert.equal(out.moves, 1, `junk positions changed behaviour: ${JSON.stringify(positions)}`);
  }
});
