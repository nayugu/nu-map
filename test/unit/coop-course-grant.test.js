// A work-term block IS a course registration — but only the one the student
// named on the card.
//
// The defect this file started for: a work term granted only ATTRIBUTES (NUPath
// EX) and there was no bridge from the block to a course key. 37 undergraduate
// programs name a COOP course as a requirement, so a student with two co-ops
// on the board was told the experiential requirement was unmet. An advisor
// sees that once.
//
// The bridge it originally grew — grant COOP 3945 from any placed co-op — is
// gone, and these tests now pin its absence. It was defensible only while the
// student had no way to say which course they had registered; once the card
// carried a course field, the inference was the app asserting something it
// could not support. It picked an option that FIT rather than the one that was
// true: a co-op registering a course a section does not accept ticked it
// anyway. Degrade to less information, never to wrong information.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workTermGrants, computeGrantedAttrs } from "../../src/core/specialTermUtils.js";
import { derivePlanSets } from "../../src/core/planModel.js";
import { allocateSections, calculateGeneralElectives } from "../../src/core/gradRequirements.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

const TYPES = specialTerms.getTypes();
const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2, sem4: 3 };

/** A co-op block. `courseId` omitted = the student never touched the field. */
const coopAt = (semId, courseId) =>
  ({ c1: { typeId: "coop", semId, duration: 6, ...(courseId ? { courseId } : {}) } });

const keysAt = (pl) => workTermGrants(pl, TYPES, SEM_IDX).planned;

// ── the grant itself ────────────────────────────────────────────────

test("a co-op with no course chosen registers NOTHING", () => {
  assert.equal(keysAt(coopAt("sem2")).size, 0);
  // …but it is still a co-op: EX is a property of doing one at all, and does
  // not depend on which course records it.
  assert.ok(computeGrantedAttrs(coopAt("sem2"), TYPES, SEM_IDX).has("EX"));
});

test("a co-op registers exactly the course the student named", () => {
  assert.deepEqual([...keysAt(coopAt("sem2", "COOP3945"))], ["COOP3945"]);
  assert.deepEqual([...keysAt(coopAt("sem2", "COOP3948"))], ["COOP3948"]);
});

test("nothing is inferred from a chosen course — the variants stay distinct", () => {
  // Exactly one section in the corpus (International Business's
  // "International Experiential Learning") requires 3948 alone. A student who
  // recorded an ordinary 3945 must leave it unmet rather than have the app
  // claim experience abroad on their behalf — and vice versa: an abroad co-op
  // does not silently also count as the domestic one.
  const granted = keysAt(coopAt("sem2", "COOP3945"));
  for (const wrong of ["COOP3946", "COOP3947", "COOP3948", "COOP3949"]) {
    assert.ok(!granted.has(wrong), `${wrong} was granted by a co-op recorded as 3945`);
  }
  assert.ok(!keysAt(coopAt("sem2", "COOP3948")).has("COOP3945"));
});

test("an internship registers its own course, and only if named", () => {
  const at = (courseId) =>
    keysAt({ i1: { typeId: "intern", semId: "sem2", duration: 4, ...(courseId ? { courseId } : {}) } });
  assert.equal(at().size, 0);
  assert.deepEqual([...at("COOP3949")], ["COOP3949"]);
  // An internship grants no attribute — unlike co-op it carries no EX.
  assert.equal(computeGrantedAttrs({ i1: { typeId: "intern", semId: "sem2" } }, TYPES, SEM_IDX).size, 0);
});

test("two work terms each register their own course", () => {
  // The multiplicity the old inference could not express: two blocks used to
  // collapse onto one key. Naming them separately is what makes International
  // Business's two non-shared experiential sections both reachable.
  const both = keysAt({
    c1: { typeId: "coop",   semId: "sem1", duration: 4, courseId: "COOP3945" },
    c2: { typeId: "coop",   semId: "sem3", duration: 4, courseId: "COOP3948" },
  });
  assert.deepEqual([...both].sort(), ["COOP3945", "COOP3948"]);
});

test("no work terms grants nothing, and the empty case is safe", () => {
  assert.equal(keysAt({}).size, 0);
  assert.equal(keysAt(undefined).size, 0);
  assert.equal(workTermGrants(coopAt("sem2", "COOP3945"), [], SEM_IDX).planned.size, 0);
});

test("an unplaced or out-of-timeline co-op grants nothing", () => {
  // Same rule computeGrantedAttrs already applies: a co-op parked outside the
  // cohort range stays in state, uncounted.
  assert.equal(keysAt({ c1: { typeId: "coop", courseId: "COOP3945" } }).size, 0);
  assert.equal(keysAt(coopAt("__overflow:1", "COOP3945")).size, 0);
  // …and it is the same rule, not a parallel one.
  assert.equal(computeGrantedAttrs(coopAt("__overflow:1"), TYPES, SEM_IDX).size, 0);
});

test("a block type that registers no course cannot register one", () => {
  // Not reachable through the UI — the field only renders for a type that
  // declares `registersCourse` — but state outlives the UI that wrote it, and
  // a share link carries `courseId` verbatim.
  const fake = [{ id: "study", label: "Study Abroad", durations: [], attributeGrants: [], occupiesSlot: true, creditValue: 0 }];
  const pl   = { s1: { typeId: "study", semId: "sem2", courseId: "COOP3945" } };
  assert.equal(workTermGrants(pl, fake, SEM_IDX).planned.size, 0);
});

// ── the reason the split exists: no phantom credits ─────────────────

test("the granted course satisfies requirements but is NOT a general elective", () => {
  // placedSet gets it; realPlacedSet must not, because realPlacedSet feeds
  // General Electives and the student never dragged a COOP card anywhere.
  const courseMap = { CS2500: { subject: "CS", number: "2500", sh: 4 } };
  const { placedSet, realPlacedSet } = derivePlanSets({
    placements: { CS2500: "sem1" }, courseMap, dynSemIdx: SEM_IDX, curIdx: 2,
    specialTermPl: coopAt("sem2", "COOP3945"), specialTermTypes: TYPES,
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
    specialTermPl: coopAt("sem1", "COOP3945"), specialTermTypes: TYPES,
  });
  assert.ok(past.placedSet.has("COOP3945"));
  assert.ok(past.doneKeys.has("COOP3945"), "a finished co-op still reads as pending");

  const future = derivePlanSets({
    placements: {}, courseMap, dynSemIdx: SEM_IDX, curIdx: 2,
    specialTermPl: coopAt("sem4", "COOP3945"), specialTermTypes: TYPES,
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
