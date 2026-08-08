// UNIT · candidates under data drift and malformed input.
//
// Reservations outlive the data they were built against. Requirement sections
// are re-scraped monthly, plans are restored from share links written weeks
// ago, and a stored index can end up pointing at a section that has moved,
// changed name, or stopped existing.
//
// The rule the whole module rests on: **degrade to less information, never to
// wrong information.** A card that has lost track of its requirement must read
// as "we do not know" (offer search) and never as a different requirement, and
// never as "nothing fits".
//
// Everything here feeds candidates the kind of input that actually arrives —
// half-scraped programs, drifted indices, JSON round-trips that turned Sets
// into arrays — and checks that nothing throws and nothing lies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidatesForReservation, createCandidates, narrow, applyFilters,
  courseIds, courseSpec, answerGroups, forcedRequirement, reasonFor,
  isUnbounded, isSpare, isImpossible,
  withoutPlacedCourses, withoutSatisfiedRequirements, withoutOptionsRuledOut,
} from "../../src/core/candidates.js";
import { createReservation } from "../../src/core/reservations.js";
import { specForNode } from "../../src/core/programEligibility.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSE_MAP = {};
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)) };
}

/** A tiny program, so drift can be staged exactly. */
const program = () => ({
  requirementSections: [
    { title: "Khoury Electives", type: "SECTION", requirements: [
      { type: "COURSE", subject: "CS", classId: "4300" },
      { type: "COURSE", subject: "CS", classId: "4100" },
    ] },
    { title: "Mathematics Electives", type: "SECTION", requirements: [
      { type: "COURSE", subject: "MATH", classId: "3081" },
    ] },
  ],
});
const specOfFor = (p) => (t) =>
  (typeof t === "number" ? specForNode(p.requirementSections?.[t]) : null);
const ctxFor = (p) => ({ specOf: specOfFor(p), courseMap: COURSE_MAP });

const reservationFor = (index, title, extra = {}) => ({
  ...createReservation({ semId: "fall2026", label: "Khoury Elective", sh: 4 }),
  requirement: { index, title },
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════
// Drift: the stored index no longer means what it meant
// ═══════════════════════════════════════════════════════════════════

test("an index that still agrees with its title is followed", () => {
  const p = program();
  const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
  assert.equal(forcedRequirement(c), 0);
  assert.deepEqual([...courseIds(c, ctxFor(p))].sort(), ["CS4100", "CS4300"]);
});

test("a REORDERED section is found by title, not followed by index", () => {
  const p = program();
  p.requirementSections.reverse();                      // Khoury is now index 1
  const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
  assert.equal(forcedRequirement(c), 1, "the card followed the stale index");
  assert.deepEqual([...courseIds(c, ctxFor(p))].sort(), ["CS4100", "CS4300"],
    "the card is offering another requirement's courses");
});

test("a RENAMED section is abandoned, not followed", () => {
  // The dangerous case: index 0 still exists and still looks plausible, but it
  // is a different requirement now. Following it would silently offer the wrong
  // courses under the old label.
  const p = program();
  p.requirementSections[0].title = "Something Else Entirely";
  const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
  assert.equal(forcedRequirement(c), null, "a renamed section was followed anyway");
  assert.ok(isUnbounded(c, ctxFor(p)), "the card should degrade to 'we do not know'");
  assert.ok(!isImpossible(c, ctxFor(p)), "degrading must not become a false warning");
});

test("a DELETED section degrades to unbounded, never to impossible", () => {
  const p = program();
  p.requirementSections = [p.requirementSections[1]];
  const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
  assert.equal(forcedRequirement(c), null);
  assert.ok(isUnbounded(c, ctxFor(p)));
  assert.ok(courseIds(c, ctxFor(p)).size > 7000, "should fall back to offering the catalog");
});

test("a nonsense index is rescued by the title — the title is the identity", () => {
  // The index is a hint; the title is what a reservation is actually keyed on.
  // A garbage index with an intact title should still find its requirement,
  // which is the whole reason both halves are stored.
  const p = program();
  for (const idx of [99, -1, 1.5, NaN, null, undefined, "0"]) {
    const c = candidatesForReservation(reservationFor(idx, "Khoury Electives"), { programData: p });
    assert.equal(forcedRequirement(c), 0, `index ${JSON.stringify(idx)} did not recover by title`);
    assert.doesNotThrow(() => courseIds(c, ctxFor(p)), `index ${JSON.stringify(idx)} threw`);
  }
});

test("a nonsense index AND an unknown title resolves to nothing", () => {
  const p = program();
  for (const idx of [99, -1, NaN]) {
    const c = candidatesForReservation(reservationFor(idx, "No Such Requirement"), { programData: p });
    assert.equal(forcedRequirement(c), null, `index ${idx} invented a requirement`);
    assert.ok(isUnbounded(c, ctxFor(p)), "it should degrade to 'we do not know'");
  }
});

test("whitespace drift in a title is not read as a rename", () => {
  // A re-scrape that gains or loses a trailing space would otherwise look like
  // the requirement was renamed, and the card would abandon a binding that is
  // still perfectly good.
  const p = program();
  p.requirementSections[0].title = "  Khoury Electives ";
  const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
  assert.equal(forcedRequirement(c), 0, "a trailing space was treated as a rename");

  const q = program();
  const d = candidatesForReservation(reservationFor(0, " Khoury Electives  "), { programData: q });
  assert.equal(forcedRequirement(d), 0, "a padded STORED title was treated as a rename");
});

test("a resolved index is always a number, never a numeric string", () => {
  // isSentinel() is `typeof target !== "number"`, so a string index would make
  // a correctly bound card read as "admits any course".
  const p = program();
  const c = candidatesForReservation(reservationFor("0", "Khoury Electives"), { programData: p });
  const forced = forcedRequirement(c);
  assert.equal(typeof forced, "number", `forced requirement came back as ${typeof forced}`);
  assert.ok(!isUnbounded(c, ctxFor(p)), "a bound card was treated as unbounded");
  assert.deepEqual([...courseIds(c, ctxFor(p))].sort(), ["CS4100", "CS4300"]);
});

test("an empty or missing title never matches a section by accident", () => {
  // Sections with no title exist in scraped data. A reservation whose title is
  // also empty must not collide with one of them and adopt its courses.
  const p = program();
  p.requirementSections.push({ title: "", type: "SECTION", requirements: [
    { type: "COURSE", subject: "MATH", classId: "3081" },
  ] });
  for (const title of ["", null, undefined]) {
    const c = candidatesForReservation(reservationFor(0, title), { programData: p });
    assert.equal(forcedRequirement(c), null,
      `title ${JSON.stringify(title)} matched a section it should not have`);
  }
});

test("a program with no requirement data at all degrades cleanly", () => {
  for (const p of [null, undefined, {}, { requirementSections: null }, { requirementSections: [] }]) {
    const c = candidatesForReservation(reservationFor(0, "Khoury Electives"), { programData: p });
    assert.equal(forcedRequirement(c), null);
    assert.ok(isUnbounded(c, { specOf: specOfFor(p ?? {}), courseMap: COURSE_MAP }),
      `program ${JSON.stringify(p)} should leave the card unbounded`);
  }
});

test("a reservation with NO stored requirement is unbounded, not impossible", () => {
  const p = program();
  const bare = createReservation({ semId: "fall2026", label: "General Elective", sh: 4 });
  const c = candidatesForReservation(bare, { programData: p });
  assert.ok(isUnbounded(c, ctxFor(p)));
  assert.ok(!isSpare(c), "nothing was ruled out");
  assert.ok(!isImpossible(c, ctxFor(p)));
});

// ═══════════════════════════════════════════════════════════════════
// Malformed options — what a bad scrape or a JSON round-trip produces
// ═══════════════════════════════════════════════════════════════════

test("malformed option lists never throw and never invent an answer", () => {
  const p = program();
  const ctx = ctxFor(p);
  const cases = [
    [],                              // no groups at all
    [[]],                            // one empty group
    [[], []],                        // all empty
    [["CS4300"], []],                // one real, one empty
    [["CS4300"], ["ZZ9999"]],        // one real, one phantom
    [["ZZ9999"], ["QQ0000"]],        // all phantom
    [["CS4300"], ["CS4300"]],        // duplicate groups
    [["CS4300", "CS4300"]],          // duplicate inside a group
    null, undefined, "nonsense", 42, // not a list
    [null, undefined],               // holes
    [["CS4300"], null],              // a hole beside a real group
  ];
  for (const options of cases) {
    const r = { ...createReservation({ semId: "fall2026", label: "x", sh: 4 }), options };
    let c;
    assert.doesNotThrow(() => { c = candidatesForReservation(r, { programData: p }); },
      `options ${JSON.stringify(options)} threw`);
    assert.doesNotThrow(() => courseIds(c, ctx), `courseIds threw for ${JSON.stringify(options)}`);
    assert.doesNotThrow(() => answerGroups(c, ctx), `answerGroups threw for ${JSON.stringify(options)}`);
    assert.doesNotThrow(() => courseSpec(c, ctx), `courseSpec threw for ${JSON.stringify(options)}`);
    // Whatever is offered must be real.
    for (const id of courseIds(c, ctx)) {
      assert.ok(COURSE_MAP[id], `offered ${id}, which the catalog does not have`);
    }
    // A group is only offered if every member of it is real.
    for (const g of answerGroups(c, ctx) ?? []) {
      assert.ok(g.length, "an empty group was offered as an answer");
      for (const id of g) assert.ok(COURSE_MAP[id], `group offers unreal ${id}`);
    }
  }
});

test("a card whose every option is phantom is impossible, and says so", () => {
  const p = program();
  const r = { ...createReservation({ semId: "fall2026", label: "x", sh: 4 }),
              options: [["ZZ9999"], ["QQ0000"]] };
  const c = candidatesForReservation(r, { programData: p });
  assert.equal(courseIds(c, ctxFor(p)).size, 0);
  assert.ok(isImpossible(c, ctxFor(p)),
    "a card naming only courses we do not have is genuinely unanswerable");
  assert.ok(!isUnbounded(c, ctxFor(p)), "it must not fall back to offering everything");
});

// ═══════════════════════════════════════════════════════════════════
// Reason provenance under long chains
// ═══════════════════════════════════════════════════════════════════

test("reasons survive a long narrowing chain, first writer wins", () => {
  const p = program();
  let c = createCandidates({ requirements: [0, 1] });
  c = narrow(c, { courses: ["CS4300"], reason: "first" });
  for (let i = 0; i < 200; i++) c = narrow(c, { courses: ["CS4300"], reason: `later-${i}` });
  assert.equal(reasonFor(c, "CS4300"), "first", "a later filter overwrote an earlier reason");
  assert.equal(c.droppedCourses.size, 1, "the same removal was recorded repeatedly");
});

test("a reason is never recorded for a requirement that was not a candidate", () => {
  let c = createCandidates({ requirements: [0] });
  c = narrow(c, { requirements: [1, 7, "~ghost"], reason: "nope" });
  assert.equal(c.droppedRequirements.size, 0, "reasons accumulated for non-candidates");
  assert.equal(reasonFor(c, 1), null);
});

test("removing every requirement one at a time ends spare, not unbounded", () => {
  const p = program();
  let c = createCandidates({ requirements: [0, 1] });
  c = narrow(c, { requirements: [0], reason: "a" });
  assert.ok(!isSpare(c), "still has one candidate");
  c = narrow(c, { requirements: [1], reason: "b" });
  assert.ok(isSpare(c), "should be spare once all are ruled out");
  assert.ok(!isUnbounded(c, ctxFor(p)), "a fully ruled-out card must not start offering everything");
  assert.equal(reasonFor(c, 0), "a");
  assert.equal(reasonFor(c, 1), "b");
});

// ═══════════════════════════════════════════════════════════════════
// Filters against hostile arguments
// ═══════════════════════════════════════════════════════════════════

test("filters tolerate null placements, null maps and missing ctx", () => {
  const p = program();
  const c = createCandidates({ requirements: [0] });
  const ctx = ctxFor(p);
  assert.doesNotThrow(() => applyFilters(c, [withoutPlacedCourses(null)], ctx));
  assert.doesNotThrow(() => applyFilters(c, [withoutPlacedCourses(undefined)], ctx));
  assert.doesNotThrow(() => applyFilters(c, [withoutPlacedCourses({})], ctx));
  assert.doesNotThrow(() => applyFilters(c, [withoutSatisfiedRequirements(null)], ctx));
  assert.doesNotThrow(() => applyFilters(c, [withoutOptionsRuledOut(() => null)], ctx));
  assert.doesNotThrow(() => applyFilters(c, [withoutPlacedCourses({ CS4300: "f" })], {}));
});

test("withoutSatisfiedRequirements(null) rules everything out rather than nothing", () => {
  // A null 'outstanding' means "nothing has demand". That must read as spare —
  // silently treating it as "everything has demand" would keep pending marks on
  // requirements the plan already met.
  const p = program();
  const c = applyFilters(createCandidates({ requirements: [0, 1] }),
                         [withoutSatisfiedRequirements(null)], ctxFor(p));
  assert.ok(isSpare(c), "a null outstanding set should rule every requirement out");
});

test("a filter that removes nothing returns the identical object", () => {
  const p = program();
  const c = createCandidates({ requirements: [0] });
  assert.equal(applyFilters(c, [withoutPlacedCourses({})], ctxFor(p)), c);
  assert.equal(applyFilters(c, [withoutSatisfiedRequirements(new Set([0]))], ctxFor(p)), c);
  assert.equal(applyFilters(c, [withoutOptionsRuledOut(() => null)], ctxFor(p)), c);
});

test("a throwing filter does not leave a half-narrowed card behind", () => {
  const p = program();
  const c = createCandidates({ requirements: [0, 1] });
  const before = JSON.stringify([...c.requirements]);
  assert.throws(() => applyFilters(c, [
    () => ({ requirements: [0], reason: "ok" }),
    () => { throw new Error("boom"); },
  ], ctxFor(p)), /boom/);
  assert.equal(JSON.stringify([...c.requirements]), before,
    "the original card was modified by a run that threw");
});

// ═══════════════════════════════════════════════════════════════════
// Accessor agreement — the thing §17 exists to guarantee
// ═══════════════════════════════════════════════════════════════════

test("courseIds, courseSpec and answerGroups never disagree", () => {
  const p = program();
  const ctx = ctxFor(p);
  const shapes = [
    createCandidates({ requirements: [0] }),
    createCandidates({ requirements: [0, 1] }),
    createCandidates({ requirements: [] }),
    createCandidates({ requirements: [0], groups: [["CS4300"], ["CS4100"]] }),
    createCandidates({ requirements: [], groups: [["CS4300"], ["CS4100", "MATH3081"]] }),
    createCandidates({ requirements: ["~general"] }),
  ];
  for (const base of shapes) {
    for (const drop of [[], ["CS4300"], ["CS4100"], ["CS4300", "CS4100"], ["MATH3081"]]) {
      const c = narrow(base, { courses: drop, reason: "t" });
      const ids = courseIds(c, ctx);
      const spec = courseSpec(c, ctx);
      const groups = answerGroups(c, ctx);

      if (spec === null) {
        assert.ok(isUnbounded(c, ctx), "courseSpec returned null for a bounded card");
      } else {
        // Every id must be reachable through the spec, and vice versa.
        const viaSpec = new Set();
        for (const id in COURSE_MAP) {
          if (spec.keys.has(id)) viaSpec.add(id);
        }
        for (const id of viaSpec) assert.ok(ids.has(id), `${id} in spec but not in ids`);
      }
      if (groups) {
        const flat = new Set(groups.flat());
        for (const id of ids) assert.ok(flat.has(id), `${id} offered but in no surviving group`);
        for (const id of flat) assert.ok(ids.has(id), `${id} in a surviving group but not offered`);
      }
      // isImpossible must agree with there being nothing to offer.
      if (!isUnbounded(c, ctx) && !isSpare(c)) {
        assert.equal(isImpossible(c, ctx), ids.size === 0, "isImpossible disagreed with courseIds");
      }
    }
  }
});
