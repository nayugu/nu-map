// UNIT · the consolidated candidate object.
//
// The design claim being tested is that narrowing is monotone BY CONSTRUCTION —
// a filter returns what to remove and cannot return a replacement, so no filter
// can hand a card back a candidate it had ruled out. These tests attack that
// claim, and the three states that are easy to conflate:
//
//   unbounded   anything counts (44% of cells), or we never knew (113 cells)
//   spare       every candidate was ruled out — the plan already covers it
//   impossible  every course that could answer it is ruled out
//
// Collapsing any two of those turns an open picker into a false warning, or a
// false warning into silence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { specForNode, emptySpec } from "../../src/core/programEligibility.js";
import { materialize } from "../../src/core/candidateSpec.js";
import {
  createCandidates, narrow, applyFilters, answerGroups,
  courseSpec, courseIds, preferredCourseIds, forcedRequirement, reasonFor,
  isUnbounded, isSpare, isImpossible, isSentinel,
  withoutSatisfiedRequirements, withoutPlacedCourses, withoutOptionsRuledOut,
  GENERAL_ELECTIVE, CONCENTRATION,
} from "../../src/core/candidates.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSE_MAP = {};
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)) };
}

/** A real program, so specs are the shapes the scraper actually emits. */
function aProgram() {
  const base = join(ROOT, "data/northeastern/programs/majors/2026");
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs) {
      const f = join(base, college, prog, "parsed.initial.json");
      if (!existsSync(f)) continue;
      const data = JSON.parse(readFileSync(f, "utf8"));
      const secs = data.requirementSections ?? [];
      const withCourses = secs.filter(s => {
        const sp = specForNode(s);
        return sp.keys.size > 2 || sp.ranges.length;
      });
      if (withCourses.length >= 3) return { name: prog, sections: secs };
    }
  }
  return null;
}
const PROGRAM = aProgram();
const specOf = (i) => (typeof i === "number" ? specForNode(PROGRAM.sections[i]) : null);
const ctx = { specOf, courseMap: COURSE_MAP };

/** Section indices whose spec actually names courses. */
const REAL_SECTIONS = (PROGRAM?.sections ?? [])
  .map((s, i) => i)
  .filter(i => {
    const sp = specForNode(PROGRAM.sections[i]);
    return sp.keys.size || sp.ranges.length;
  });

test("the fixture program is real enough to test against", () => {
  assert.ok(PROGRAM, "no program with enumerable sections found");
  assert.ok(REAL_SECTIONS.length >= 3, `only ${REAL_SECTIONS.length} enumerable sections`);
  assert.ok(Object.keys(COURSE_MAP).length > 7000, "catalog missing");
});

// ═══════════════════════════════════════════════════════════════════
// The three states that must never be confused
// ═══════════════════════════════════════════════════════════════════

test("a card that never had a requirement is unbounded, NOT impossible", () => {
  // 113 corpus cells bind to nothing. That is missing data, not a proof that
  // no course fits, and saying "nothing can go here" would be false confidence.
  const c = createCandidates({ requirements: [] });
  assert.ok(isUnbounded(c, ctx), "an unbound card should read as 'anything might'");
  assert.ok(!isImpossible(c, ctx), "an unbound card must not read as impossible");
  assert.ok(!isSpare(c), "nothing was ruled out, so it is not spare");
  assert.ok(courseIds(c, ctx).size > 7000, "an unbound card should offer the catalog");
});

test("a card whose requirements were all RULED OUT is spare, not unbounded", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  const after = narrow(c, { requirements: [REAL_SECTIONS[0]], reason: "already satisfied" });
  assert.ok(isSpare(after), "should be spare");
  assert.ok(!isUnbounded(after, ctx), "a ruled-out card must not start offering everything");
  assert.ok(!isImpossible(after, ctx), "spare is not the same as impossible");
  assert.equal(courseIds(after, ctx).size, 0, "a spare card offers nothing");
});

test("a general-elective card is unbounded, and an empty spec is not the same thing", () => {
  const general = createCandidates({ requirements: [GENERAL_ELECTIVE] });
  assert.ok(isUnbounded(general, ctx), "~general admits everything");
  assert.ok(!isImpossible(general, ctx));
  assert.ok(courseIds(general, ctx).size > 7000, "should offer the whole catalog");

  // A seeded card whose seed names nothing is genuinely impossible.
  const nothing = createCandidates({ seed: emptySpec() });
  assert.ok(!isUnbounded(nothing, ctx), "an empty seed is not 'anything'");
  assert.ok(isImpossible(nothing, ctx), "an empty seed should be impossible");
});

test("a concentration sentinel is unbounded until it is resolved", () => {
  const c = createCandidates({ requirements: [CONCENTRATION] });
  assert.ok(isSentinel(CONCENTRATION));
  assert.ok(isUnbounded(c, ctx), "an unresolved concentration must not read as impossible");
});

test("a RESOLVED concentration stops offering the whole catalog", () => {
  // Which concentration is the student's choice, so the sentinel names nothing
  // in general. Once chosen it names that section's courses, and a card
  // reserving concentration credit should narrow to them. Enumerability is
  // asked of `specOf`, not of whether the target looks like a sentinel.
  const c = createCandidates({ requirements: [CONCENTRATION] });
  const resolved = {
    specOf: (t) => (t === CONCENTRATION ? specForNode(PROGRAM.sections[REAL_SECTIONS[0]])
                                        : (typeof t === "number" ? specForNode(PROGRAM.sections[t]) : null)),
    courseMap: COURSE_MAP,
  };
  assert.ok(!isUnbounded(c, resolved), "a resolved concentration still read as unbounded");
  const ids = courseIds(c, resolved);
  assert.ok(ids.size > 0 && ids.size < 7000, `expected a narrowed set, got ${ids.size}`);
  assert.ok(preferredCourseIds(c, resolved).size > 0, "a resolved concentration expresses no preference");
});

test("~general never resolves, however hard a caller tries", () => {
  // It admits everything by nature. A specOf that returned a spec for it would
  // be claiming a free elective is restricted, which is the opposite of true.
  const c = createCandidates({ requirements: [GENERAL_ELECTIVE] });
  assert.ok(isUnbounded(c, ctx));
  assert.equal(preferredCourseIds(c, ctx).size, 0);
});

test("CORPUS FACT: no requirement section is open-ended", () => {
  // Measured: 0 of 4,234 sections across 532 programs have an empty spec. Every
  // real section names courses, and open-endedness reaches us only through the
  // `~general` sentinel.
  //
  // Pinned because the next test's branch is DEFENSIVE, not load-bearing, and
  // that is worth knowing. If this ever fails, the scraper started emitting a
  // shape the binder has never seen, and `~general`'s derived allowance (which
  // is sized from what the other sections demand) is the first thing to check.
  const base = join(ROOT, "data/northeastern/programs/majors/2026");
  let sections = 0, openEnded = 0;
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs) {
      const f = join(base, college, prog, "parsed.initial.json");
      if (!existsSync(f)) continue;
      for (const s of JSON.parse(readFileSync(f, "utf8")).requirementSections ?? []) {
        sections += 1;
        const sp = specForNode(s);
        if (!sp.keys.size && !sp.ranges.length) openEnded += 1;
      }
    }
  }
  assert.ok(sections > 4000, `only ${sections} sections scanned — corpus missing`);
  assert.equal(openEnded, 0, `${openEnded} open-ended sections appeared; see the comment above`);
});

test("an open-ended SECTION would be unbounded, not impossible", () => {
  // Synthetic, because the corpus has none (test above). The branch still has
  // to be right: a section naming no course means "any course", and reading it
  // as "no course" would put a false warning on a card the student can answer
  // with anything.
  const localSpecOf = () => emptySpec();
  const c = createCandidates({ requirements: [0] });
  assert.ok(isUnbounded(c, { specOf: localSpecOf }), "a section naming no course means 'any course'");
  assert.ok(!isImpossible(c, { specOf: localSpecOf, courseMap: COURSE_MAP }),
    "an open-ended section must not read as impossible");
  assert.equal(courseSpec(c, { specOf: localSpecOf }), null, "it is not expressible as a spec");
});

test("courseSpec refuses to answer for an unbounded card", () => {
  // Otherwise it returns the bounded PART of the card — a narrower answer than
  // courseIds gives for the same card, which is the exact accessor-disagreement
  // this module exists to prevent.
  const mixed = createCandidates({ requirements: [GENERAL_ELECTIVE, REAL_SECTIONS[0]] });
  assert.equal(courseSpec(mixed, ctx), null, "courseSpec answered for an unbounded card");
  assert.ok(courseIds(mixed, ctx).size > 7000, "courseIds should offer the catalog");

  const bounded = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  assert.ok(courseSpec(bounded, ctx), "courseSpec should answer for a bounded card");
});

// ═══════════════════════════════════════════════════════════════════
// Monotonicity — the property the whole design rests on
// ═══════════════════════════════════════════════════════════════════

test("no sequence of filters ever grows either set", () => {
  let seed = 991;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rand() * a.length)];

  for (let trial = 0; trial < 60; trial++) {
    let c = createCandidates({ requirements: REAL_SECTIONS.slice(0, 4) });
    let reqs = new Set(c.requirements);
    let courses = courseIds(c, ctx);

    for (let step = 0; step < 8; step++) {
      const kind = Math.floor(rand() * 3);
      let removal = null;
      if (kind === 0) removal = { requirements: [pick(REAL_SECTIONS)], reason: `r${step}` };
      else if (kind === 1) removal = { courses: [pick([...courses, "ZZ9999"])], reason: `c${step}` };
      else removal = { requirements: [pick(REAL_SECTIONS)], courses: [pick([...courses, "ZZ0000"])], reason: `b${step}` };

      c = narrow(c, removal);
      const nextReqs = new Set(c.requirements);
      const nextCourses = courseIds(c, ctx);

      for (const r of nextReqs) assert.ok(reqs.has(r), `trial ${trial} step ${step}: requirement ${r} APPEARED`);
      for (const id of nextCourses) assert.ok(courses.has(id), `trial ${trial} step ${step}: course ${id} APPEARED`);
      reqs = nextReqs; courses = nextCourses;
    }
  }
});

test("the monotonicity fuzz above actually removes things", () => {
  // A shrinking-only property passes trivially if nothing ever shrinks. This
  // pins that the same generator really does reduce both sets.
  let c = createCandidates({ requirements: REAL_SECTIONS.slice(0, 4) });
  const reqs0 = c.requirements.size, courses0 = courseIds(c, ctx).size;
  assert.ok(reqs0 >= 3 && courses0 > 0, "fixture is not wide enough to shrink");
  const ids = [...courseIds(c, ctx)].slice(0, 3);
  c = narrow(c, { requirements: [REAL_SECTIONS[0]], courses: ids, reason: "x" });
  assert.ok(c.requirements.size < reqs0, "requirements did not shrink");
  assert.ok(courseIds(c, ctx).size < courses0, "courses did not shrink");
});

test("a spare card that NAMED its options still offers them", () => {
  // "Spare" is a claim about the requirement, not about the courses: the plan
  // already covers what this card was for, but either named course remains a
  // real course the student may place. Asserting it so the two seeded/unseeded
  // behaviours are a decision rather than an accident.
  const seed = { keys: new Set(["CS4300", "CS4100"]), ranges: [] };
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]], seed });
  const after = narrow(c, { requirements: [REAL_SECTIONS[0]], reason: "already satisfied" });
  assert.ok(isSpare(after), "should be spare");
  assert.deepEqual([...courseIds(after, ctx)].sort(), ["CS4100", "CS4300"],
    "a seeded card lost its options when its requirement was ruled out");
});

test("narrowing requirements narrows courses, because courses are derived", () => {
  const wide = createCandidates({ requirements: REAL_SECTIONS.slice(0, 3) });
  const before = courseIds(wide, ctx);
  const narrowed = narrow(wide, { requirements: [REAL_SECTIONS[0]], reason: "x" });
  const after = courseIds(narrowed, ctx);
  for (const id of after) assert.ok(before.has(id), `${id} appeared after narrowing requirements`);
  assert.ok(after.size <= before.size, "the course set grew");
});

test("removal commutes — order changes the reason, never the survivors", () => {
  const base = createCandidates({ requirements: REAL_SECTIONS.slice(0, 4) });
  const ids = [...courseIds(base, ctx)].slice(0, 5);
  const rA = { requirements: [REAL_SECTIONS[0]], courses: ids.slice(0, 2), reason: "A" };
  const rB = { requirements: [REAL_SECTIONS[1]], courses: ids.slice(1, 4), reason: "B" };

  const ab = narrow(narrow(base, rA), rB);
  const ba = narrow(narrow(base, rB), rA);
  assert.deepEqual([...ab.requirements].sort(), [...ba.requirements].sort(), "requirements differ by order");
  assert.deepEqual([...courseIds(ab, ctx)].sort(), [...courseIds(ba, ctx)].sort(), "courses differ by order");
  // The overlapping course keeps whichever reason ran first — that is the
  // documented difference, and it must be the ONLY one.
  assert.equal(reasonFor(ab, ids[1]), "A");
  assert.equal(reasonFor(ba, ids[1]), "B");
});

test("a filter cannot add — there is no API for it, and unknown removals are inert", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  const after = narrow(c, { requirements: [REAL_SECTIONS[1], "~nonsense"], courses: [], reason: "z" });
  assert.ok(!after.requirements.has(REAL_SECTIONS[1]), "a non-candidate was added by removing it");
  assert.ok(!after.droppedRequirements.has("~nonsense"),
    "a reason was recorded for something that was never a candidate");
  assert.equal(after.requirements.size, 1, "the surviving set changed");
});

// ═══════════════════════════════════════════════════════════════════
// Seed (a cell that names its options) — §17.2's one-code-path claim
// ═══════════════════════════════════════════════════════════════════

test("a seeded card is bounded by its options, whatever its requirements say", () => {
  const seed = { keys: new Set(["CS4300", "CS4100"]), ranges: [] };
  const c = createCandidates({ requirements: [GENERAL_ELECTIVE, REAL_SECTIONS[0]], seed });
  assert.ok(!isUnbounded(c, ctx), "a named cell must not inherit ~general's unboundedness");
  assert.deepEqual([...courseIds(c, ctx)].sort(), ["CS4100", "CS4300"]);
});

test("a seeded card still narrows, and can be reduced to one answer", () => {
  const seed = { keys: new Set(["CS4300", "CS4100"]), ranges: [] };
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]], seed });
  const after = narrow(c, { courses: ["CS4100"], reason: "ruled out" });
  assert.deepEqual([...courseIds(after, ctx)], ["CS4300"]);
  assert.equal(reasonFor(after, "CS4100"), "ruled out");
});

test("a seed naming a course the catalog lacks contributes nothing", () => {
  const seed = { keys: new Set(["CS4300", "CS3500"]), ranges: [] };   // CS3500 was renumbered away
  const c = createCandidates({ requirements: [], seed });
  assert.deepEqual([...courseIds(c, ctx)], ["CS4300"], "a phantom option was offered");
});

// ═══════════════════════════════════════════════════════════════════
// Option GROUPS — the 36 cells design rule 2 exists for
// ═══════════════════════════════════════════════════════════════════

test("CORPUS FACT: 36 named cells have a multi-course option group", () => {
  // "PSYC 3200 or PT 5410 and PT 5411" — PT 5410 alone does not answer it.
  // Pinned so that if the parser ever flattens groups again, this fails here
  // rather than in a student's plan.
  let cells = 0, multi = 0;
  const walk = function* (es) { for (const e of es ?? []) { yield e; yield* walk(e.children); } };
  for (const root of ["data/northeastern/programs/majors/2026", "data/northeastern/programs/grad-majors/2026"]) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const college of readdirSync(base)) {
      let progs = [];
      try { progs = readdirSync(join(base, college)); } catch { continue; }
      for (const prog of progs) {
        const f = join(base, college, prog, "plan.json");
        if (!existsSync(f)) continue;
        const grid = JSON.parse(readFileSync(f, "utf8"));
        for (const plan of grid.plans ?? []) {
          for (const y of plan.years ?? []) for (const t of y.terms ?? []) {
            for (const e of walk(t.entries)) {
              if (e.coop || e.vacation || e.heading || e.either) continue;
              if (!(e.options?.length > 1)) continue;
              cells += 1;
              if (e.options.some(g => g.length > 1)) multi += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(cells > 1300, `only ${cells} named cells found — corpus missing`);
  assert.equal(multi, 36, `${multi} cells have a compound option; the entry model may have flattened`);
});

test("a compound option is answered as a group, never course by course", () => {
  const groups = [["PSYC3200"], ["PT5410", "PT5411"]];
  const c = createCandidates({ requirements: [], groups });
  assert.deepEqual(answerGroups(c, {}).length, 2, "both options should stand");

  // Losing one half of a compound option kills the whole option.
  const half = narrow(c, { courses: ["PT5410"], reason: "ruled out" });
  assert.deepEqual(answerGroups(half, {}), [["PSYC3200"]], "the compound option survived losing a half");
  assert.ok(!courseIds(half, { courseMap: { PSYC3200: {}, PT5410: {}, PT5411: {} } }).has("PT5411"),
    "PT 5411 is still offered although its group is dead — it was never an answer alone");
});

test("ruling out enough courses to kill every GROUP is refused", () => {
  // The count-based guard passed here: 2 of 3 courses removed looks safe, and
  // leaves zero answerable options.
  const groups = [["PSYC3200"], ["PT5410", "PT5411"]];
  const map = { PSYC3200: {}, PT5410: {}, PT5411: {} };
  const c = createCandidates({ requirements: [], groups });
  const killed = new Set(["PSYC3200", "PT5410"]);
  const after = applyFilters(c, [withoutOptionsRuledOut((id) => (killed.has(id) ? "X" : null))],
                             { courseMap: map });
  assert.ok(answerGroups(after, { courseMap: map }).length > 0,
    "every answer was ruled out — the prereq graph is not entitled to say that");
  assert.equal(after, c, "the removal should have been refused wholesale");
});

test("a group naming a course the catalog lacks is not offered", () => {
  const groups = [["CS4300"], ["CS4100", "CS3500"]];   // CS3500 was renumbered away
  const c = createCandidates({ requirements: [], groups });
  assert.deepEqual(answerGroups(c, { courseMap: COURSE_MAP }), [["CS4300"]],
    "an unanswerable group was offered");
});

test("single-course groups behave exactly like plain courses", () => {
  const viaGroups = createCandidates({ requirements: [], groups: [["CS4300"], ["CS4100"]] });
  const viaSeed = createCandidates({ requirements: [], seed: { keys: new Set(["CS4300", "CS4100"]), ranges: [] } });
  assert.deepEqual([...courseIds(viaGroups, ctx)].sort(), [...courseIds(viaSeed, ctx)].sort());
});

// ═══════════════════════════════════════════════════════════════════
// preferredCourseIds — a ranking hint, never a restriction
// ═══════════════════════════════════════════════════════════════════

test("a card that allows anything still says what the plan meant", () => {
  // Most ambiguous cards carry ~general among their candidates, so anything is
  // allowed. Answering only "the whole catalog" throws away the rest of the
  // list, which is what the department actually had in mind.
  const c = createCandidates({ requirements: [GENERAL_ELECTIVE, REAL_SECTIONS[0]] });
  assert.ok(isUnbounded(c, ctx), "fixture should be unbounded");
  const pref = preferredCourseIds(c, ctx);
  assert.ok(pref.size > 0, "no preference expressed");
  assert.ok(pref.size < 7000, "the preference is just the catalog again");
});

test("preferred is always a subset of allowed", () => {
  for (const cands of [
    createCandidates({ requirements: [GENERAL_ELECTIVE, REAL_SECTIONS[0]] }),
    createCandidates({ requirements: REAL_SECTIONS.slice(0, 3) }),
    createCandidates({ requirements: [], groups: [["CS4300"], ["CS4100"]] }),
  ]) {
    const allowed = courseIds(cands, ctx);
    for (const id of preferredCourseIds(cands, ctx)) {
      assert.ok(allowed.has(id), `${id} is preferred but not allowed`);
    }
  }
});

test("a pure general-elective card expresses no preference", () => {
  // Inventing one would be the false confidence rule 4 forbids.
  const c = createCandidates({ requirements: [GENERAL_ELECTIVE] });
  assert.equal(preferredCourseIds(c, ctx).size, 0);
  const conc = createCandidates({ requirements: [CONCENTRATION] });
  assert.equal(preferredCourseIds(conc, ctx).size, 0);
});

test("preference respects what has been ruled out", () => {
  const c = createCandidates({ requirements: [GENERAL_ELECTIVE, REAL_SECTIONS[0]] });
  const [victim] = [...preferredCourseIds(c, ctx)];
  const after = narrow(c, { courses: [victim], reason: "x" });
  assert.ok(!preferredCourseIds(after, ctx).has(victim),
    "a ruled-out course is still being recommended");
});

test("for a named card, preference and allowance are the same thing", () => {
  const c = createCandidates({ requirements: [], groups: [["CS4300"], ["CS4100"]] });
  assert.deepEqual([...preferredCourseIds(c, ctx)].sort(), [...courseIds(c, ctx)].sort());
});

// ═══════════════════════════════════════════════════════════════════
// forcedRequirement — what §12's pending mark reads
// ═══════════════════════════════════════════════════════════════════

test("forcedRequirement is null until exactly one survives", () => {
  const c = createCandidates({ requirements: REAL_SECTIONS.slice(0, 3) });
  assert.equal(forcedRequirement(c), null, "forced with three candidates");
  const one = narrow(c, { requirements: REAL_SECTIONS.slice(1, 3), reason: "x" });
  assert.equal(forcedRequirement(one), REAL_SECTIONS[0]);
  const none = narrow(one, { requirements: [REAL_SECTIONS[0]], reason: "y" });
  assert.equal(forcedRequirement(none), null, "forced with zero candidates");
});

// ═══════════════════════════════════════════════════════════════════
// The shipped filters
// ═══════════════════════════════════════════════════════════════════

test("withoutSatisfiedRequirements drops exactly the ones with no demand", () => {
  const c = createCandidates({ requirements: REAL_SECTIONS.slice(0, 3) });
  const outstanding = new Set([REAL_SECTIONS[1]]);
  const after = applyFilters(c, [withoutSatisfiedRequirements(outstanding)], ctx);
  assert.deepEqual([...after.requirements], [REAL_SECTIONS[1]]);
  assert.equal(reasonFor(after, REAL_SECTIONS[0]), "already satisfied");
});

test("withoutSatisfiedRequirements accepts a Set, a Map or a plain object", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0], REAL_SECTIONS[1]] });
  const keep = REAL_SECTIONS[0];
  for (const outstanding of [new Set([keep]), new Map([[keep, 1]]), { [keep]: 1 }]) {
    const after = applyFilters(c, [withoutSatisfiedRequirements(outstanding)], ctx);
    assert.equal(after.requirements.size, 1, `shape ${outstanding.constructor.name} mishandled`);
  }
});

test("withoutPlacedCourses removes placed courses but keeps repeatables", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  const all = [...courseIds(c, ctx)];
  assert.ok(all.length >= 2, "fixture needs at least two candidates");
  const [placed, repeat] = all;

  const plain = applyFilters(c, [withoutPlacedCourses({ [placed]: "fall2026" })], ctx);
  assert.ok(!courseIds(plain, ctx).has(placed), "a placed course was still offered");
  assert.equal(reasonFor(plain, placed), "already in your plan");

  const withRepeat = applyFilters(c, [
    withoutPlacedCourses({ [repeat]: "fall2026" }, { repeatable: (id) => id === repeat }),
  ], ctx);
  assert.ok(courseIds(withRepeat, ctx).has(repeat), "a repeatable course was hidden after one take");
});

test("withoutPlacedCourses resolves repeat-instance keys to their base", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  const [id] = [...courseIds(c, ctx)];
  const after = applyFilters(c, [withoutPlacedCourses({ [`${id}#2`]: "fall2026" })], ctx);
  assert.ok(!courseIds(after, ctx).has(id), "a '#2' placement did not hide its base course");
});

test("withoutOptionsRuledOut never empties the card", () => {
  // The prereq graph may narrow a choice; it is not entitled to say the card
  // cannot be answered at all.
  const seed = { keys: new Set(["CS4300", "CS4100"]), ranges: [] };
  const c = createCandidates({ requirements: [], seed });
  const all = applyFilters(c, [withoutOptionsRuledOut(() => "CS9999")], ctx);
  assert.equal(courseIds(all, ctx).size, 2, "every option was ruled out");

  const one = applyFilters(c, [withoutOptionsRuledOut((id) => (id === "CS4100" ? "CS9999" : null))], ctx);
  assert.deepEqual([...courseIds(one, ctx)], ["CS4300"]);
  assert.equal(reasonFor(one, "CS4100"), "ruled out by a course already in your plan");
});

test("withoutOptionsRuledOut does nothing when there is only one candidate", () => {
  const seed = { keys: new Set(["CS4300"]), ranges: [] };
  const c = createCandidates({ requirements: [], seed });
  const after = applyFilters(c, [withoutOptionsRuledOut(() => "CS9999")], ctx);
  assert.deepEqual([...courseIds(after, ctx)], ["CS4300"]);
});

// ═══════════════════════════════════════════════════════════════════
// Hygiene
// ═══════════════════════════════════════════════════════════════════

test("narrow does not mutate the candidates it is given", () => {
  const c = createCandidates({ requirements: REAL_SECTIONS.slice(0, 3) });
  const before = {
    reqs: [...c.requirements].sort(),
    dropped: [...c.droppedRequirements.keys()].sort(),
    courses: [...c.droppedCourses.keys()].sort(),
  };
  narrow(c, { requirements: [REAL_SECTIONS[0]], courses: ["CS4300"], reason: "x" });
  applyFilters(c, [withoutSatisfiedRequirements(new Set())], ctx);
  assert.deepEqual([...c.requirements].sort(), before.reqs, "requirements mutated");
  assert.deepEqual([...c.droppedRequirements.keys()].sort(), before.dropped, "dropped reqs mutated");
  assert.deepEqual([...c.droppedCourses.keys()].sort(), before.courses, "dropped courses mutated");
});

test("a no-op narrow returns the identical object, so memos downstream hold", () => {
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  assert.equal(narrow(c, { requirements: [], courses: [] }), c, "an empty removal allocated");
  assert.equal(narrow(c, null), c, "a null removal allocated");
  assert.equal(applyFilters(c, [() => null], ctx), c, "a filter returning null allocated");
});

test("degenerate input does not throw", () => {
  assert.doesNotThrow(() => createCandidates(), "no argument");
  assert.doesNotThrow(() => createCandidates({}), "empty argument");
  const c = createCandidates({ requirements: [REAL_SECTIONS[0]] });
  assert.doesNotThrow(() => courseSpec(c, {}), "no specOf");
  assert.doesNotThrow(() => courseIds(c, {}), "no courseMap");
  assert.doesNotThrow(() => courseIds(c, { specOf }), "no courseMap, with specOf");
  assert.doesNotThrow(() => isUnbounded(c, {}), "isUnbounded without specOf");
  assert.doesNotThrow(() => applyFilters(c, [null, undefined, 42, () => null], ctx), "junk filters");
  assert.doesNotThrow(() => applyFilters(c, null, ctx), "null filter list");
  assert.equal(reasonFor(c, "nothing"), null, "a reason for an unknown thing");
});

test("courseSpec agrees with courseIds for bounded cards", () => {
  for (const i of REAL_SECTIONS.slice(0, 6)) {
    const c = createCandidates({ requirements: [i] });
    const viaSpec = materialize(courseSpec(c, ctx), COURSE_MAP);
    const viaIds = courseIds(c, ctx);
    assert.deepEqual([...viaIds].sort(), [...viaSpec].sort(), `section ${i} disagreed`);
  }
});
