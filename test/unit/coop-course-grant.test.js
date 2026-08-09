// A co-op block IS a registration for COOP 3945.
//
// The defect this file exists for: a work term granted only ATTRIBUTES (NUPath
// EX) and there was no bridge from the block to a course key. 37 undergraduate
// programs name a COOP course as a requirement, so a student with two co-ops
// on the board was told the experiential requirement was unmet. An advisor
// sees that once.
//
// The conservative half matters as much as the fix. Only 3945 is granted:
// 3946/3947 are half-time and 3947/3948 are abroad, and they are not
// interchangeable. Degrade to less information, never to wrong information.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGrantedCourses, computeGrantedAttrs } from "../../src/core/specialTermUtils.js";
import { derivePlanSets } from "../../src/core/planModel.js";
import { allocateSections, calculateGeneralElectives } from "../../src/core/gradRequirements.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

const TYPES = specialTerms.getTypes();
const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2, sem4: 3 };

const coopAt = semId => ({ c1: { typeId: "coop", semId, duration: 6 } });

// ── the grant itself ────────────────────────────────────────────────

test("a placed co-op grants COOP 3945", () => {
  const granted = computeGrantedCourses(coopAt("sem2"), TYPES, SEM_IDX);
  assert.deepEqual([...granted], ["COOP3945"]);
});

test("only 3945 — half-time and abroad co-ops are not interchangeable", () => {
  // Exactly one section in the corpus (International Business's
  // "International Experiential Learning") requires 3948 alone. An ordinary
  // co-op must leave it unmet rather than claim experience abroad.
  const granted = computeGrantedCourses(coopAt("sem2"), TYPES, SEM_IDX);
  for (const wrong of ["COOP3946", "COOP3947", "COOP3948", "COOP3949"]) {
    assert.ok(!granted.has(wrong), `${wrong} was granted by an ordinary co-op`);
  }
});

test("an internship grants no course — only co-op is a COOP registration", () => {
  const granted = computeGrantedCourses({ i1: { typeId: "intern", semId: "sem2", duration: 4 } }, TYPES, SEM_IDX);
  assert.equal(granted.size, 0);
});

test("no work terms grants nothing, and the empty case is safe", () => {
  assert.equal(computeGrantedCourses({}, TYPES, SEM_IDX).size, 0);
  assert.equal(computeGrantedCourses(undefined, TYPES, SEM_IDX).size, 0);
  assert.equal(computeGrantedCourses(coopAt("sem2"), [], SEM_IDX).size, 0);
});

test("an unplaced or out-of-timeline co-op grants nothing", () => {
  // Same rule computeGrantedAttrs already applies: a co-op parked outside the
  // cohort range stays in state, uncounted.
  assert.equal(computeGrantedCourses({ c1: { typeId: "coop" } }, TYPES, SEM_IDX).size, 0);
  assert.equal(computeGrantedCourses(coopAt("__overflow:1"), TYPES, SEM_IDX).size, 0);
  // …and it is the same rule, not a parallel one.
  assert.equal(computeGrantedAttrs(coopAt("__overflow:1"), TYPES, SEM_IDX).size, 0);
});

// ── the reason the split exists: no phantom credits ─────────────────

test("the granted course satisfies requirements but is NOT a general elective", () => {
  // placedSet gets it; realPlacedSet must not, because realPlacedSet feeds
  // General Electives and the student never dragged a COOP card anywhere.
  const courseMap = { CS2500: { subject: "CS", number: "2500", sh: 4 } };
  const { placedSet, realPlacedSet } = derivePlanSets({
    placements: { CS2500: "sem1" }, courseMap, dynSemIdx: SEM_IDX, curIdx: 2,
    specialTermPl: coopAt("sem2"), specialTermTypes: TYPES,
  });
  assert.ok(placedSet.has("COOP3945"), "the co-op did not satisfy its course");
  assert.ok(!realPlacedSet.has("COOP3945"), "the granted course leaked into the real set");

  // And the GE calculation — which iterates realPlacedSet — invents no credit.
  const ge = calculateGeneralElectives(placedSet, new Set(), courseMap, 0, null, null, realPlacedSet);
  assert.ok(!ge.children.some(c => c.key === "COOP3945"), "a co-op appeared as a general elective");
  const geSH = ge.children.reduce((n, c) => n + (c.sh ?? 0), 0);
  assert.equal(geSH, 4, "the co-op inflated general-elective credit");
});

// ── the tri-state: a finished co-op is COMPLETED, not planned ───────

test("a co-op in a past semester is completed; a future one is only planned", () => {
  const courseMap = {};
  const past = derivePlanSets({
    placements: {}, courseMap, dynSemIdx: SEM_IDX, curIdx: 2,
    specialTermPl: coopAt("sem1"), specialTermTypes: TYPES,
  });
  assert.ok(past.placedSet.has("COOP3945"));
  assert.ok(past.doneKeys.has("COOP3945"), "a finished co-op still reads as pending");

  const future = derivePlanSets({
    placements: {}, courseMap, dynSemIdx: SEM_IDX, curIdx: 2,
    specialTermPl: coopAt("sem4"), specialTermTypes: TYPES,
  });
  assert.ok(future.placedSet.has("COOP3945"));
  assert.ok(!future.doneKeys.has("COOP3945"), "a future co-op already counts as done");
});

// ── the shape the corpus actually uses ──────────────────────────────

test("the corpus shape: an OR of COOP options under a 1-of-1 SECTION", () => {
  // Verbatim from "Architectural Studies and Business Administration, BS".
  const section = {
    type: "SECTION", title: "Experiential Requirements", minRequirementCount: 1,
    requirements: [{
      type: "OR", courses: [
        { type: "COURSE", subject: "COOP", classId: 3945 },
        { type: "COURSE", subject: "BUSN", classId: 4945 },
        { type: "COURSE", subject: "COOP", classId: 3946 },
        { type: "COURSE", subject: "COOP", classId: 3947 },
        { type: "COURSE", subject: "COOP", classId: 3948 },
      ],
    }],
  };
  const courseMap = { COOP3945: { subject: "COOP", number: "3945", sh: 0 } };

  const without = allocateSections([section], new Set(), new Set(), courseMap);
  assert.equal(without[0].sat, false, "the requirement was already satisfied with no co-op");

  const withCoop = allocateSections([section], new Set(["COOP3945"]), new Set(), courseMap);
  assert.equal(withCoop[0].sat, true, "a placed co-op did not satisfy the experiential requirement");
});

test("COOP 3945 is a zero-credit course, so it cannot inflate a credit pool", () => {
  // One program (Speech-Language Pathology and Audiology and Human Services)
  // nests COOP under an XOM credit pool, where gradRequirements' DEFAULT_SH
  // of 4 would otherwise be invented for a course with no `sh`. The catalog
  // publishes credits: 0 for it, so creditsOf reads 0 — this pins that the
  // day the field goes missing, rather than discovering it in an audit.
  const xom = {
    type: "SECTION", title: "Experiential", minRequirementCount: 1,
    requirements: [{
      type: "XOM", numCreditsMin: 8,
      courses: [
        { type: "COURSE", subject: "COOP", classId: 3945 },
        { type: "COURSE", subject: "CS",   classId: 2500 },
      ],
    }],
  };
  const courseMap = {
    COOP3945: { subject: "COOP", number: "3945", sh: 0 },
    CS2500:   { subject: "CS",   number: "2500", sh: 4 },
  };
  const [res] = allocateSections([xom], new Set(["COOP3945", "CS2500"]), new Set(), courseMap);
  const pool = res.children[0];
  assert.equal(pool.satSh, 4, "the zero-credit co-op contributed phantom credit to the pool");
});
