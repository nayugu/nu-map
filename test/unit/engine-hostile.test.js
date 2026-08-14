// UNIT · adversarial input for the paths added while working the success criteria.
//
// Every test here is an attempt to BREAK something, not to confirm it. The targets are the
// pieces written today, because they are the least exercised and each already produced one
// real defect: `termIsFull`'s new argument, the trailing-term trim, the co-op slot cap, the
// unguided classifier, and the breadth reader.
//
// The bar is CLAUDE.md's: stop when everything tried still holds, not at first green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { termIsFull, DEFAULT_CALIBRATION as CAL, minCoursesFor } from "../../src/engine/calibration.js";
import { termSlotCap } from "../../src/engine/domains.js";
import { shapeFromPlan, defaultShape, extendShape, studyTerms } from "../../src/engine/shape.js";
import { breadthCodes } from "../../src/engine/demand.js";
import { isUnguided } from "../../scripts/lib/chart-gate.js";

const UG = "undergraduate";

// ── termIsFull, at the edges ────────────────────────────────────────

test("hostile › termIsFull survives nonsense numbers", () => {
  // A shape read from a malformed plan can carry NaN hours, and a cap of 0 is what a
  // zero-weight term computes. None of these may throw, and none may report a term with no
  // courses as full — that would silently license an empty term.
  for (const args of [
    [0, NaN, 19], [0, 0, 0], [0, -5, 19], [NaN, 0, 19], [0, Infinity, 19],
    [0, 0, NaN], [0, 0, -19],
  ]) {
    assert.doesNotThrow(() => termIsFull(args[0], args[1], args[2], CAL, UG, args[1]),
      JSON.stringify(args));
  }
  assert.equal(termIsFull(0, 0, 19, CAL, UG, 0), false, "an empty term is never full");
});

test("hostile › a term cannot be full on real credit it does not have", () => {
  // `bigSH` above `loadSH` is incoherent — more real-course credit than total credit — and
  // the likely cause is a bookkeeping bug like the one already found in `fillFullTerms`.
  // It must not be the thing that makes a short term read as full.
  assert.equal(termIsFull(1, 4, 19, CAL, UG, 4), false);
  assert.equal(termIsFull(3, 12, 19, CAL, UG, 12), false, "12 SH of real course leaves room");
});

// ── The co-op slot cap ──────────────────────────────────────────────

test("hostile › a co-op term with a broken target still admits a course", () => {
  // `targetSH` comes from a scraped plan and can be absent, zero, negative or NaN. A cap of
  // zero would make the term unusable and could refuse the degree, which is the direction
  // criterion 2 forbids — so the floor of 1 has to hold for every one of these.
  for (const targetSH of [undefined, null, 0, -4, NaN, Infinity, "4"]) {
    const cap = termSlotCap({ coop: true, targetSH, weight: 1 });
    assert.ok(Number.isFinite(cap) && cap >= 1,
      `targetSH ${String(targetSH)} produced cap ${cap}`);
  }
});

test("hostile › a co-op term is capped even when the plan-wide maximum is huge", () => {
  // `maxCoursesFull` is read from the published plan's worst term and can be 7. Read first
  // it would hand a co-op term seven slots.
  assert.equal(termSlotCap({ coop: true, targetSH: 4, weight: 1 },
                           { maxCoursesFull: 7, maxCoursesHalf: 4 }), 1);
});

// ── Shapes that should not exist ────────────────────────────────────

test("hostile › a plan of nothing but co-op yields no study terms and does not throw", () => {
  const s = shapeFromPlan({ years: [{ label: "Year 1", terms: [
    { term: "Fall", type: "fall", entries: [{ text: "Co-op", coop: true }] },
    { term: "Spring", type: "spring", entries: [{ text: "Co-op", coop: true }] },
  ] }] });
  assert.equal(s.terms.every(t => t.work), true);
  assert.deepEqual(studyTerms(s, UG, CAL), []);
});

test("hostile › a degree of zero credits produces a shape rather than a crash", () => {
  for (const totalSH of [0, -10, NaN, undefined]) {
    assert.doesNotThrow(() => defaultShape({ totalSH }), String(totalSH));
    const s = defaultShape({ totalSH });
    assert.ok(s.terms.length >= 1, "even a degenerate degree needs somewhere to put nothing");
  }
});

test("hostile › an absurd degree does not run away to infinite years", () => {
  // 10,000 credits is not a degree, and the shape must stay bounded rather than emitting a
  // term per credit — which would make every downstream loop quadratic.
  const s = defaultShape({ totalSH: 10000 });
  assert.ok(s.terms.length <= 40, `produced ${s.terms.length} terms`);
});

test("hostile › extending a shape never invents work or co-op, however odd the pattern", () => {
  const s = shapeFromPlan({ years: [{ label: "Year 1", terms: [
    { term: "Fall", type: "fall", hours: 4,
      entries: [{ text: "Co-op", coop: true }, { text: "X", sh: 4, options: [["X1000"]] }] },
    { term: "Spring", type: "spring", entries: [{ text: "Co-op", coop: true }] },
  ] }] });
  const ext = extendShape(s, 2);
  for (const t of ext.terms.slice(s.terms.length)) {
    assert.equal(t.work, false);
    assert.equal(t.coop, false);
  }
});

// ── The unguided classifier ─────────────────────────────────────────

test("hostile › the unguided classifier is not fooled by whitespace or case", () => {
  for (const s of ["  general   elective ", "ELECTIVE", "Free  Elective", "electives"]) {
    assert.equal(isUnguided(s), true, JSON.stringify(s));
  }
});

// CHART no longer prints a competency on an elective card — see `demand.js`, where the title
// is now plainly "General Elective". The classifier still has to READ one, because the
// departments' own published plans write titles like this and the gate measures those against
// ours; it is our own output that stopped containing them.
test("hostile › a competency code in a DEPARTMENT's title is guidance; an aside is not", () => {
  assert.equal(isUnguided("General Elective (IC)"), false);
  assert.equal(isUnguided("Elective (Dialogue of Civilizations possible)"), true);
  // A lowercase parenthetical is not a NUPath code — those are two capitals.
  assert.equal(isUnguided("Elective (ic)"), true);
});

test("hostile › our own elective cards carry no competency to read", () => {
  // The guidance still exists on the cell as `nupath` and still spreads breadth across the
  // plan; it is simply not a label, because binding a competency to an elective is one
  // ordering among several and printing it would read as an instruction.
  assert.equal(isUnguided("General Elective"), true);
});

test("hostile › anything naming a subject or level is guided", () => {
  for (const s of ["PSYC elective", "Upper-division elective", "Foreign language core course",
                   "CS 3500", "Concentration", "Elective in Biology"]) {
    assert.equal(isUnguided(s), false, JSON.stringify(s));
  }
});

test("hostile › the classifier survives non-strings", () => {
  for (const v of [null, undefined, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => isUnguided(v), String(v));
    assert.equal(isUnguided(v), false);
  }
});

// ── Breadth, with hostile catalogs ──────────────────────────────────

test("hostile › breadth handles a catalog whose attributes are junk", () => {
  const cm = {
    A1: { id: "A1", attributes: null },
    A2: { id: "A2", attributes: "IC" },      // a string, not an array
    A3: { id: "A3" },
    A4: { id: "A4", attributes: ["IC"] },
  };
  assert.doesNotThrow(() => breadthCodes([], cm, []));
  const got = breadthCodes([], cm, []);
  // "IC" the string is iterable, so a careless reader would invent codes "I" and "C".
  for (const { code } of got) assert.ok(code.length >= 2, `invented single-letter code ${code}`);
});

test("hostile › granting every code asks for no breadth at all", () => {
  const cm = { A1: { id: "A1", attributes: ["IC"] }, A2: { id: "A2", attributes: ["WF"] } };
  assert.deepEqual(breadthCodes([], cm, ["IC", "WF"]), []);
});

// ── The convention that does not apply ──────────────────────────────

test("hostile › the four-course bar never applies to a graduate term", () => {
  // 16.4% of published graduate full terms carry four courses. Enforcing it there forces a
  // maximal load and reports a defect where the departments agree with CHART.
  assert.equal(minCoursesFor(CAL, "graduate"), 0);
  assert.equal(termIsFull(0, 0, 16, CAL, "graduate", 0), true);
});
