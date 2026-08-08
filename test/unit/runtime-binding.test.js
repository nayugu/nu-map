// UNIT · recomputing which requirements a card could be for.
//
// §3 rejected binding as a runtime query and named the failure exactly:
// satisfy Khoury by hand and a fresh solve re-points the "Khoury Elective" card
// at general electives. §11 permits it only as NARROWING — a live solve may
// intersect with what was already possible and may never introduce a candidate
// that was not.
//
// These tests attack that rule directly: they try to make a card acquire a
// candidate, re-point away from a forced binding, or change its answer when
// nothing relevant changed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { bindReservations, outstandingObligations } from "../../src/core/runtimeBinding.js";
import { createReservation } from "../../src/core/reservations.js";
import { specAdmitsSubject, specAdmitsRange } from "../../src/core/requirementBinding.js";
import { specForNode } from "../../src/core/programEligibility.js";
import { createPlanHints } from "../../src/adapters/northeastern/planHints.js";
import {
  candidatesForReservation, applyFilters, withoutSatisfiedRequirements,
  isSpare, isUnbounded,
} from "../../src/core/candidates.js";

const courseMap = {
  CS3000: { id: "CS3000", subject: "CS", number: "3000", sh: 4 },
  CS4300: { id: "CS4300", subject: "CS", number: "4300", sh: 4 },
  CS4100: { id: "CS4100", subject: "CS", number: "4100", sh: 4 },
  MATH3081: { id: "MATH3081", subject: "MATH", number: "3081", sh: 4 },
  MATH3175: { id: "MATH3175", subject: "MATH", number: "3175", sh: 4 },
  ENGW1111: { id: "ENGW1111", subject: "ENGW", number: "1111", sh: 4 },
};
const hints = createPlanHints(["CS", "MATH", "ENGW"], { specAdmitsSubject, specAdmitsRange });

/** Two real requirement sections plus a stated total, so ~general appears. */
const program = () => ({
  totalCreditsRequired: 24,
  requirementSections: [
    { title: "Khoury Approved Electives", type: "SECTION",
      minRequirementCount: 1,
      requirements: [
        { type: "COURSE", subject: "CS", classId: "4300" },
        { type: "COURSE", subject: "CS", classId: "4100" },
      ] },
    { title: "Mathematics Electives", type: "SECTION",
      minRequirementCount: 1,
      requirements: [
        { type: "COURSE", subject: "MATH", classId: "3081" },
        { type: "COURSE", subject: "MATH", classId: "3175" },
      ] },
  ],
});

const res = (label, extra = {}) => ({
  ...createReservation({ semId: "fall2026", label, sh: 4 }), ...extra,
});
const bind = (reservations, { placements = {}, programData = program() } = {}) =>
  bindReservations(reservations, { programData, placements, courseMap, hints });

// ── It produces something at all ───────────────────────────────────

test("an ambiguous card gets a candidate list where it had nothing stored", () => {
  const r = res("Elective");
  const got = bind({ [r.id]: r });
  assert.ok(got.has(r.id), "no entry for the card");
  assert.ok(got.get(r.id).length >= 1, "the card was left with no candidates");
});

test("wording narrows a card to its requirement", () => {
  const r = res("Mathematics Elective");
  const targets = bind({ [r.id]: r }).get(r.id);
  assert.ok(targets.includes(1), `expected the Mathematics section, got ${JSON.stringify(targets)}`);
});

test("a subject-prefixed label cannot bind to a bucket without that subject", () => {
  // `admits` is checkable evidence: the Khoury section holds no MATH course.
  const r = res("MATH elective");
  const targets = bind({ [r.id]: r }).get(r.id);
  assert.ok(!targets.includes(0), "a MATH card bound to a section with no MATH course");
});

// ── §11: a stored forced binding is never re-pointed ───────────────

test("a stored requirement wins, and the live solve is not consulted", () => {
  const r = res("Khoury Elective", { requirement: { index: 0, title: "Khoury Approved Electives" } });
  assert.deepEqual(bind({ [r.id]: r }).get(r.id), [0]);
});

test("a stored requirement still wins once the plan has satisfied it", () => {
  // The §3 failure. A fresh solve would find section 0 has no demand left and
  // re-point the card at general electives. It must not: the card still means
  // Khoury, and "already covered" is decided downstream by isSpare.
  const r = res("Khoury Elective", { requirement: { index: 0, title: "Khoury Approved Electives" } });
  const after = bind({ [r.id]: r }, { placements: { CS4300: "fall2026", CS4100: "spr2027" } });
  assert.deepEqual(after.get(r.id), [0], "the card re-pointed away from its own requirement");
});

test("a card whose stored requirement is met reads SPARE, end to end", () => {
  // The §11 outcome, across both modules: the solve refuses to re-point the
  // card, and the satisfied-requirement filter then leaves it with nothing,
  // which is what "your plan already covers this" is made of.
  //
  // Neither half is enough alone. Without the filter the card keeps pointing at
  // a finished requirement; without the solve's refusal it would silently
  // become a general elective.
  const r = res("Khoury Elective", { requirement: { index: 0, title: "Khoury Approved Electives" } });
  const p = program();
  const placements = { CS4300: "fall2026", CS4100: "spr2027" };

  const targets = bindReservations({ [r.id]: r },
    { programData: p, placements, courseMap, hints });
  assert.deepEqual(targets.get(r.id), [0], "the solve re-pointed the card");

  const outstanding = new Set(
    outstandingObligations(p, { placements, courseMap }).map(o => o.target));
  assert.ok(!outstanding.has(0), "fixture assumption: the Khoury section should be met");

  const cands = applyFilters(
    candidatesForReservation(r, { programData: p, targets: targets.get(r.id) }),
    [withoutSatisfiedRequirements(outstanding)],
    { specOf: (t) => (typeof t === "number" ? specForNode(p.requirementSections[t]) : null), courseMap });

  assert.ok(isSpare(cands), "the card should read as already covered");
  assert.ok(!isUnbounded(cands, {}), "a spare card must not fall back to offering everything");
});

test("a card whose requirement is only PARTLY met is not spare", () => {
  const r = res("Khoury Elective", { requirement: { index: 0, title: "Khoury Approved Electives" } });
  const p = program();
  const placements = {};                       // nothing placed
  const outstanding = new Set(
    outstandingObligations(p, { placements, courseMap }).map(o => o.target));
  const cands = applyFilters(
    candidatesForReservation(r, { programData: p, targets: [0] }),
    [withoutSatisfiedRequirements(outstanding)], { courseMap });
  assert.ok(!isSpare(cands), "an outstanding requirement was treated as met");
});

test("a stored requirement whose title drifted is abandoned, not followed", () => {
  const p = program();
  p.requirementSections[0].title = "Renamed Entirely";
  const r = res("Khoury Elective", { requirement: { index: 0, title: "Khoury Approved Electives" } });
  const targets = bind({ [r.id]: r }, { programData: p }).get(r.id);
  assert.ok(!targets.includes(0) || targets.length > 1,
    "a drifted index was followed as though it were still forced");
});

// ── Monotonicity: placing courses may only narrow ──────────────────

test("placing courses never gives a card a candidate it did not have", () => {
  const a = res("Elective");
  const b = res("Elective");
  const reservations = { [a.id]: a, [b.id]: b };

  const steps = [
    {},
    { CS4300: "fall2026" },
    { CS4300: "fall2026", CS4100: "spr2027" },
    { CS4300: "fall2026", CS4100: "spr2027", MATH3081: "fall2027" },
    { CS4300: "fall2026", CS4100: "spr2027", MATH3081: "fall2027", MATH3175: "spr2028" },
  ];
  let prev = null;
  for (const placements of steps) {
    const now = bind(reservations, { placements });
    if (prev) {
      for (const id of Object.keys(reservations)) {
        const before = new Set(prev.get(id) ?? []);
        for (const t of now.get(id) ?? []) {
          assert.ok(before.has(t),
            `${id} ACQUIRED candidate ${t} after placing ${JSON.stringify(placements)}`);
        }
      }
    }
    prev = now;
  }
});

test("`previous` is what makes narrowing monotone — the solve is not", () => {
  // Elimination is relative to competition, so a raw solve CAN hand a card a
  // candidate back once its rivals are satisfied elsewhere. Passing the last
  // answer in makes each solve a refinement of the one before.
  const r = res("Elective");
  const reservations = { [r.id]: r };
  const raw = bind(reservations);
  const pinned = new Map([[r.id, [raw.get(r.id)[0]]]]);   // pretend we knew less

  const refined = bindReservations(reservations, {
    programData: program(), placements: {}, courseMap, hints, previous: pinned,
  });
  assert.deepEqual(refined.get(r.id), pinned.get(r.id),
    "the solve widened a card past what was already known");
});

test("an empty intersection is allowed to empty the card", () => {
  // That is the "your plan already covers this" case, decided downstream by
  // isSpare — not something to paper over by keeping the stale answer.
  const r = res("Elective");
  const refined = bindReservations({ [r.id]: r }, {
    programData: program(), placements: {}, courseMap, hints,
    previous: new Map([[r.id, ["~nothing-real"]]]),
  });
  assert.deepEqual(refined.get(r.id), []);
});

test("previous never lets a card keep a candidate the live solve rejected", () => {
  const r = res("MATH elective");
  const wide = new Map([[r.id, [0, 1, "~general", "~concentration"]]]);
  const refined = bindReservations({ [r.id]: r }, {
    programData: program(), placements: {}, courseMap, hints, previous: wide,
  });
  assert.ok(!refined.get(r.id).includes(0),
    "a MATH card kept a section with no MATH course, because it was in `previous`");
});

// ── Determinism ────────────────────────────────────────────────────

test("the same input gives the same answer, whatever order the cards arrive in", () => {
  const a = res("Khoury Elective");
  const b = res("Mathematics Elective");
  const c = res("Elective");
  const forward = bind({ [a.id]: a, [b.id]: b, [c.id]: c });
  const backward = bind({ [c.id]: c, [b.id]: b, [a.id]: a });
  for (const id of [a.id, b.id, c.id]) {
    assert.deepEqual(forward.get(id), backward.get(id), `${id} depended on insertion order`);
  }
});

test("repeated solves are identical", () => {
  const r = res("Elective");
  const one = bind({ [r.id]: r });
  const two = bind({ [r.id]: r });
  assert.deepEqual(one.get(r.id), two.get(r.id));
});

// ── Named cells take part (N2) ─────────────────────────────────────

test("a named card is bound too, and only to requirements that admit an option", () => {
  const r = res("CS 4300 or 4100", { options: [["CS4300"], ["CS4100"]] });
  const targets = bind({ [r.id]: r }).get(r.id);
  assert.ok(!targets.includes(1),
    "a card of CS courses bound to the Mathematics section");
});

test("a named card consumes capacity, so it competes with unnamed ones", () => {
  // The Khoury section needs one course. A named CS card can answer it, so an
  // unnamed card cannot ALSO be forced there — which is the over-subscription
  // §12.0 measured when the two populations were solved separately.
  const named = res("CS 4300 or 4100", { options: [["CS4300"], ["CS4100"]] });
  const other = res("Khoury Elective");
  const got = bind({ [named.id]: named, [other.id]: other });
  const claims = [named.id, other.id].filter(id => (got.get(id) ?? []).length === 1
    && got.get(id)[0] === 0).length;
  assert.ok(claims <= 1, `${claims} cards were both forced to a section with room for one`);
});

test("a named card whose options no requirement admits still gets an answer", () => {
  const r = res("ENGW 1111", { options: [["ENGW1111"]] });
  const targets = bind({ [r.id]: r }).get(r.id);
  assert.ok(Array.isArray(targets), "no entry at all");
  assert.ok(!targets.includes(0) && !targets.includes(1),
    "bound to a section that admits none of its options");
});

test("hints built from an ARRAY of subject codes actually match", () => {
  // The runtime holds `subjects` as an array of codes; the scrape reads an
  // object and takes its keys. Passing the array through Object.keys yields
  // "0","1","2"… and every subject-prefix hint silently stops matching —
  // no error, just worse binding. Pinned because nothing else would notice.
  const fromArray = createPlanHints(["CS", "MATH"], { specAdmitsSubject, specAdmitsRange });
  assert.equal(fromArray.subjectOf("MATH elective"), "MATH");

  const wrong = createPlanHints(Object.keys(["CS", "MATH"]), { specAdmitsSubject, specAdmitsRange });
  assert.equal(wrong.subjectOf("MATH elective"), null,
    "fixture assumption: index strings should not match a subject");

  // And it changes the answer, which is the reason it matters.
  const r = res("MATH elective");
  const good = bindReservations({ [r.id]: r },
    { programData: program(), courseMap, hints: fromArray }).get(r.id);
  const bad = bindReservations({ [r.id]: r },
    { programData: program(), courseMap, hints: wrong }).get(r.id);
  assert.ok(!good.includes(0), "a MATH card should not reach the Khoury section");
  assert.ok(bad.includes(0), "fixture assumption: broken hints let it through");
});

// ── Degenerate input ───────────────────────────────────────────────

test("no program, no reservations, no hints: empty rather than thrown", () => {
  const r = res("Elective");
  assert.equal(bindReservations({ [r.id]: r }, {}).size, 0, "no programData");
  assert.equal(bindReservations({}, { programData: program() }).size, 0, "no reservations");
  assert.equal(bindReservations(null, { programData: program() }).size, 0, "null reservations");
  assert.doesNotThrow(() =>
    bindReservations({ [r.id]: r }, { programData: program(), courseMap }), "no hints");
});

test("a program with no requirements and no total yields nothing", () => {
  const r = res("Elective");
  assert.equal(bindReservations({ [r.id]: r },
    { programData: { requirementSections: [] }, courseMap, hints }).size, 0);
});

test("malformed reservations are skipped, not thrown on", () => {
  const good = res("Elective");
  const reservations = {
    [good.id]: good,
    bad1: null, bad2: {}, bad3: { id: null },
    bad4: { id: "x", options: "nope" },
    bad5: { id: "y", options: [null] },
  };
  let got;
  assert.doesNotThrow(() => { got = bind(reservations); });
  assert.ok(got.has(good.id), "the valid card lost its answer");
});

test("placements naming courses the map does not have do not break the solve", () => {
  const r = res("Elective");
  assert.doesNotThrow(() => bind({ [r.id]: r }, { placements: { GONE9999: "fall2026" } }));
});

test("repeat-instance placements collapse to their base course", () => {
  // A requirement is satisfied by the course, not by which take of it. If "#2"
  // did not collapse, a second take would look like a different course and
  // demand would never fall.
  const r = res("Khoury Elective");
  const viaBase = bind({ [r.id]: r }, { placements: { CS4300: "fall2026" } }).get(r.id);
  const viaTake = bind({ [r.id]: r }, { placements: { "CS4300#2": "fall2026" } }).get(r.id);
  assert.deepEqual(viaTake, viaBase, "an instance id was treated as a different course");
});
