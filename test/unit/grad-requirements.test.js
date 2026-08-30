// UNIT · src/core/gradRequirements.js — the graduation verdict.
//
// Major2 requirement satisfaction, specified in docs/major2-validation-spec.md.
// Wrongness here is the highest-stakes silent lie in the app: it tells a
// student whether they graduate. We
// assert the *semantics* of each Requirement2 type and the allocation rule that
// a course counts once — NOT the shape of the result tree (that would pin
// implementation and break on harmless refactors). Pure; no I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  courseKey, buildPlacedKeySet, checkReq, checkSection,
  allocateMajorWithElectives, allocateMajorSections, allocateSections,
  collectCandidateKeys, calculateGeneralElectives, getTotalPlacedSH,
} from "../../src/core/gradRequirements.js";

// courseMap keyed by canonical id (subject+number). sh drives XOM/RANGE credit math.
const courseMap = {
  CS2000:   { subject: "CS",   number: "2000", sh: 4 },
  CS3000:   { subject: "CS",   number: "3000", sh: 4, coreqs: [{ subject: "CS", number: "3001" }] },
  CS3001:   { subject: "CS",   number: "3001", sh: 1 }, // lab / coreq of CS3000
  CS3500:   { subject: "CS",   number: "3500", sh: 4 },
  CS3800:   { subject: "CS",   number: "3800", sh: 4 },
  MATH2331: { subject: "MATH", number: "2331", sh: 4 },
  FREE1:    { subject: "XX",   number: "1",    sh: 4 }, // referenced by nothing
};
const set = (...keys) => new Set(keys);

// ── COURSE ───────────────────────────────────────────────────────────
test("checkReq › COURSE › satisfied iff the course is in the placed set", () => {
  const req = { type: "COURSE", subject: "CS", classId: "2000" };
  assert.equal(checkReq(req, set("CS2000"), courseMap).sat, true);
  assert.equal(checkReq(req, set(), courseMap).sat, false);
});

// ── AND (all) / OR (any) ──────────────────────────────────────────────
test("checkReq › AND › satisfied only when every child is, with satCount/total", () => {
  const req = { type: "AND", courses: [
    { type: "COURSE", subject: "CS", classId: "2000" },
    { type: "COURSE", subject: "CS", classId: "3000" },
  ] };
  const partial = checkReq(req, set("CS2000"), courseMap);
  assert.equal(partial.sat, false);
  assert.equal(partial.satCount, 1);
  assert.equal(partial.total, 2);
  assert.equal(checkReq(req, set("CS2000", "CS3000"), courseMap).sat, true);
});

test("checkReq › OR › satisfied when any one child is", () => {
  const req = { type: "OR", courses: [
    { type: "COURSE", subject: "CS", classId: "2000" },
    { type: "COURSE", subject: "CS", classId: "3000" },
  ] };
  assert.equal(checkReq(req, set("CS3000"), courseMap).sat, true);
  assert.equal(checkReq(req, set(), courseMap).sat, false);
});

// ── XOM (X-or-more credit hours) ──────────────────────────────────────
test("checkReq › XOM pool › satisfied once summed SH reaches numCreditsMin", () => {
  const req = { type: "XOM", numCreditsMin: 8, courses: [
    { type: "COURSE", subject: "CS", classId: "3000" }, // 4 sh
    { type: "COURSE", subject: "CS", classId: "3500" }, // 4 sh
    { type: "COURSE", subject: "CS", classId: "3800" }, // 4 sh
  ] };
  const partial = checkReq(req, set("CS3000"), courseMap); // 4 SH
  assert.equal(partial.sat, false);
  assert.equal(partial.satSh, 4);
  assert.equal(partial.reqSh, 8);
  assert.equal(checkReq(req, set("CS3000", "CS3500"), courseMap).sat, true); // 8 SH
});

test("checkReq › XOM split-credit single course › reports only the allotted SH, not the full course", () => {
  // A single required course cross-listed into a section for partial credit:
  // satisfaction depends only on taking it, but satSh must be the allotment
  // (numCreditsMin), never the course's full sh — else credits inflate.
  const req = { type: "XOM", numCreditsMin: 2, courses: [
    { type: "COURSE", subject: "CS", classId: "2000" }, // full sh = 4
  ] };
  const r = checkReq(req, set("CS2000"), courseMap);
  assert.equal(r.sat, true);
  assert.equal(r.satSh, 2, "allotted SH, not the course's full 4");
  assert.equal(r.reqSh, 2);
});

// ── RANGE (subject + number bounds, with exceptions) ──────────────────
test("checkReq › RANGE › matches placed courses within the subject/number window", () => {
  const req = { type: "RANGE", subject: "CS", idRangeStart: 3000, idRangeEnd: 3999 };
  const r = checkReq(req, set("CS2000", "CS3500", "CS3800"), courseMap);
  assert.equal(r.sat, true);
  assert.deepEqual(r.matched.sort(), ["CS 3500", "CS 3800"]); // CS2000 below the window
});

test("checkReq › RANGE › excludes exception courses", () => {
  const req = {
    type: "RANGE", subject: "CS", idRangeStart: 3000, idRangeEnd: 3999,
    exceptions: [{ subject: "CS", classId: "3500" }],
  };
  const r = checkReq(req, set("CS3500"), courseMap);
  assert.equal(r.sat, false);
  assert.deepEqual(r.matched, []);
});

// ── SECTION (≥ minRequirementCount children) ──────────────────────────
test("checkSection › satisfied iff satCount ≥ minRequirementCount, with correct shortfall", () => {
  const section = { title: "Core", minRequirementCount: 2, requirements: [
    { type: "COURSE", subject: "CS", classId: "2000" },
    { type: "COURSE", subject: "CS", classId: "3000" },
    { type: "COURSE", subject: "MATH", classId: "2331" },
  ] };
  const short = checkSection(section, set("CS2000"), courseMap);
  assert.equal(short.sat, false);
  assert.equal(short.satCount, 1);
  assert.equal(short.minRequired, 2); // shortfall = 1 more needed
  assert.equal(checkSection(section, set("CS2000", "MATH2331"), courseMap).sat, true);
});

// ── Allocation: each course counted at most once ──────────────────────
test("allocate › a course NAMED by two sections satisfies both, and its credit is still counted once", () => {
  // Satisfaction and credit are different questions. Naming one course in two
  // sections is the catalog saying that course answers both — International
  // Business BSIB requires COOP 3948 outright and also lists it among the seven
  // options of "Business Experiential Learning", so one international co-op
  // genuinely answers both. Counting its CREDIT twice would still be wrong, and
  // is what `used` and General Electives continue to prevent.
  const major = { requirementSections: [
    { title: "A", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
    { title: "B", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  assert.equal(sections.filter(s => s.sat).length, 2, "both sections name it, so both are met");
  assert.equal(generalElectives.placedSH, 0, "and it is not ALSO free elective credit");
});

test("allocate › a credit pool may not spend a course another section already claimed", () => {
  // The limit of the rule above. An XOM accumulating toward numCreditsMin is
  // measuring DISTINCT credit, so letting the same 4 SH answer two thresholds
  // really would be double-counting. Measured: of 155 sections the exclusive
  // rule blocked, 102 match their course only through a range or credit pool
  // and are correctly blocked.
  const major = { requirementSections: [
    { title: "Core", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: "2000" },
    ] },
    { title: "Elective credit", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "COURSE", subject: "CS", classId: "2000" },
        { type: "COURSE", subject: "CS", classId: "3500" },
      ] },
    ] },
  ] };
  const placedSet = set("CS2000");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["Core"].sat, true);
  assert.equal(byTitle["Elective credit"].sat, false,
    "the pool must find its own 4 SH, not re-spend the core course's");
});

test("allocate › a `choose N` section counts slots, not credit, so a named course may still cross-count", () => {
  // A "choose 2 of these 4" section is counting satisfied children, not summing
  // credit toward a threshold, so a course answering one of its slots AND a
  // named requirement elsewhere costs nothing — it still fills a single slot.
  const major = { requirementSections: [
    { title: "Named", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "BIOL", classId: "2500" },
    ] },
    { title: "Choose two", minRequirementCount: 2, requirements: [
      { type: "COURSE", subject: "BIOL", classId: "2500" },
      { type: "COURSE", subject: "BIOL", classId: "2600" },
      { type: "COURSE", subject: "BIOL", classId: "2700" },
      { type: "COURSE", subject: "BIOL", classId: "2800" },
    ] },
  ] };
  const placedSet = set("BIOL2500", "BIOL2600");
  const { sections } = allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
  assert.equal(sections.every(s => s.sat), true, "both met from two courses");
});

test("allocate › a `shared` section cross-counts without starving a normal section", () => {
  const major = { requirementSections: [
    { title: "GPA re-list", shared: true, minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
    { title: "Core", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["GPA re-list"].sat, true, "shared section satisfied");
  assert.equal(byTitle["Core"].sat, true, "normal section still satisfied (not starved)");
});

test("allocate › placed coreq is consumed with its course, not shown as a general elective", () => {
  // CS3000 has coreq CS3001; allocating CS3000 should absorb CS3001 so it does not
  // reappear as free credit.
  const major = { requirementSections: [
    { title: "Core", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "3000" }] },
  ] };
  const placedSet = set("CS3000", "CS3001");
  const { generalElectives } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  const geKeys = generalElectives.children.map(c => c.key);
  assert.ok(!geKeys.includes("CS3001"), "coreq should be absorbed, not a general elective");
});

test("allocate › XOM pool caps consumption at numCreditsMin, so excess named courses overflow to a later overlapping pool", () => {
  // Mirrors the real "Media Arts History Elective" (4 SH from named ARTH courses) +
  // "Electives Option" (a later pool re-listing the same ARTH courses) shape: taking two
  // of the shared courses must satisfy the first pool with only one of them, leaving the
  // other free to satisfy the second pool instead of silently vanishing.
  const major = { requirementSections: [
    { title: "History Elective", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "COURSE", subject: "ARTH", classId: "2210" },
        { type: "COURSE", subject: "ARTH", classId: "2211" },
      ] },
    ] },
    { title: "Electives Option", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "COURSE", subject: "ARTH", classId: "2211" },
        { type: "COURSE", subject: "ARTD", classId: "2000" },
      ] },
    ] },
  ] };
  const cm = {
    ...courseMap,
    ARTH2210: { subject: "ARTH", number: "2210", sh: 4 },
    ARTH2211: { subject: "ARTH", number: "2211", sh: 4 },
    ARTD2000: { subject: "ARTD", number: "2000", sh: 4 },
  };
  const placedSet = set("ARTH2210", "ARTH2211");
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["History Elective"].sat, true, "first pool satisfied by one course");
  assert.equal(byTitle["Electives Option"].sat, true,
    "second pool must be satisfied by the other course spilling over, not starved");
});

test("allocate › a RANGE inside an XOM pool also stops consuming once numCreditsMin is met", () => {
  const major = { requirementSections: [
    { title: "Pool A", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "RANGE", subject: "CS", idRangeStart: 3000, idRangeEnd: 3999 },
      ] },
    ] },
    { title: "Pool B", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: "3800" },
    ] },
  ] };
  // CS3500 and CS3800 both fall in the 3000-3999 range; Pool A only needs 4 SH (one of them).
  const placedSet = set("CS3500", "CS3800");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["Pool A"].sat, true, "range pool satisfied by one match");
  assert.equal(byTitle["Pool B"].sat, true,
    "the other range match must remain free for the section that names it specifically");
});

test("allocate › a released XOM-pool course with nowhere else to go lands in General Electives, not nowhere", () => {
  // Regression for a bug the overflow fix itself introduced: collectCandidateKeys
  // walks every COURSE node in the result tree, including a released (capped)
  // one, and unconditionally treats it as a "candidate pending completion of an
  // incomplete requirement" — excluding it from General Electives even though the
  // pool already let it go. Three courses, only one needed, and NO other section
  // lists the extras: they must show up as general electives, not vanish.
  const major = { requirementSections: [
    { title: "History Elective", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "COURSE", subject: "ARTH", classId: "2210" },
        { type: "COURSE", subject: "ARTH", classId: "2211" },
        { type: "COURSE", subject: "ARTH", classId: "2212" },
      ] },
    ] },
  ] };
  const cm = {
    ...courseMap,
    ARTH2210: { subject: "ARTH", number: "2210", sh: 4 },
    ARTH2211: { subject: "ARTH", number: "2211", sh: 4 },
    ARTH2212: { subject: "ARTH", number: "2212", sh: 4 },
  };
  const placedSet = set("ARTH2210", "ARTH2211", "ARTH2212");
  const { generalElectives } = allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  const geKeys = generalElectives.children.map(c => c.key);
  assert.deepEqual(geKeys.sort(), ["ARTH2211", "ARTH2212"],
    "the two courses the pool didn't need must land in General Electives, not vanish");
});

test("allocate › General Electives computed after a concentration doesn't double-count a released course", () => {
  // A course an XOM pool releases (see the cap in allocateNode) can be claimed by
  // a LATER concentration section. Computing General Electives before that
  // concentration runs — the bug this guards — lets the same course read as both
  // a general elective AND concentration credit. allocateMajorSections +
  // allocateSections + collectCandidateKeys + calculateGeneralElectives, called in
  // that order, is the pattern plannerQueryAdapter.js and GradPanel.jsx now use.
  const major = { requirementSections: [
    { title: "History Elective", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [
        { type: "COURSE", subject: "ARTH", classId: "2210" },
        { type: "COURSE", subject: "ARTH", classId: "2211" },
      ] },
    ] },
  ] };
  const concSection = { title: "Electives Option", minRequirementCount: 1, requirements: [
    { type: "XOM", numCreditsMin: 4, courses: [
      { type: "COURSE", subject: "ARTH", classId: "2211" },
    ] },
  ] };
  const cm = {
    ...courseMap,
    ARTH2210: { subject: "ARTH", number: "2210", sh: 4 },
    ARTH2211: { subject: "ARTH", number: "2211", sh: 4 },
  };
  const placedSet = set("ARTH2210", "ARTH2211");

  const { sections, allocatedSet } = allocateMajorSections(major, placedSet, cm);
  const [concResult] = allocateSections([concSection], placedSet, allocatedSet, cm);
  const candidateKeys = collectCandidateKeys([...sections, concResult], placedSet);
  const generalElectives = calculateGeneralElectives(placedSet, allocatedSet, cm, 0, null, candidateKeys, placedSet);

  assert.equal(concResult.sat, true, "concentration satisfied by the released ARTH2211");
  assert.deepEqual(generalElectives.children.map(c => c.key), [],
    "ARTH2211 must not ALSO show as a general elective once the concentration claims it");
});

// ── XOM accumulate: repeatable-course credit summed across term placements ────
test("allocate › accumulate XOM sums repeatTotalSh across repeat placements, never a single sh", () => {
  // Mirrors Studio Art BFA's "68 SH of SMFA 3000": a repeatable course taken across many
  // terms, whose requirement can only be checked from a real summed total the caller
  // attaches to courseMap — buildPlacedKeySet collapses every repeat instance to one Set
  // entry, so this must NOT fall back to the split-credit "taken once" path.
  const major = { requirementSections: [
    { title: "Studio Art", minRequirementCount: 1, requirements: [
      { type: "XOM", accumulate: true, numCreditsMin: 68, courses: [
        { type: "COURSE", subject: "SMFA", classId: "3000" },
      ] },
    ] },
  ] };
  const cmShort = { SMFA3000: { subject: "SMFA", number: "3000", sh: 4, repeatTotalSh: 40 } };
  const cmEnough = { SMFA3000: { subject: "SMFA", number: "3000", sh: 4, repeatTotalSh: 68 } };
  const placedSet = set("SMFA3000");

  const short = allocateMajorWithElectives(major, placedSet, cmShort, { realPlacedSet: placedSet });
  assert.equal(short.sections[0].sat, false, "40 of 68 SH is not enough");

  const enough = allocateMajorWithElectives(major, placedSet, cmEnough, { realPlacedSet: placedSet });
  assert.equal(enough.sections[0].sat, true, "68 of 68 SH satisfies the requirement");
});

test("allocate › accumulate XOM without repeatTotalSh data reports unsatisfied, never guesses from a single placement", () => {
  const major = { requirementSections: [
    { title: "Studio Art", minRequirementCount: 1, requirements: [
      { type: "XOM", accumulate: true, numCreditsMin: 68, courses: [
        { type: "COURSE", subject: "SMFA", classId: "3000" },
      ] },
    ] },
  ] };
  // No repeatTotalSh attached — the caller hasn't computed it (or the course isn't
  // repeatable). Falling back to "taken at all" would silently claim 68/68 SH from one
  // 4-credit term; the honest answer is unsatisfied.
  const cm = { SMFA3000: { subject: "SMFA", number: "3000", sh: 4 } };
  const placedSet = set("SMFA3000");
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, false);
});

test("allocate › a plain (non-accumulate) single-course XOM keeps its existing split-credit behavior", () => {
  // Regression guard: the accumulate branch must not swallow the pre-existing split-credit
  // pattern (a course's SH divided across sibling sections in one term).
  const major = { requirementSections: [
    { title: "Split", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 2, courses: [
        { type: "COURSE", subject: "CS", classId: "2000" }, // full sh = 4
      ] },
    ] },
  ] };
  const placedSet = set("CS2000");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, true);
});

test("allocate › an unrequired placed course lands in General Electives with its credits", () => {
  const major = { requirementSections: [
    { title: "Core", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000", "FREE1");
  const { generalElectives } = allocateMajorWithElectives(major, placedSet, courseMap, { realPlacedSet: placedSet });
  const geKeys = generalElectives.children.map(c => c.key);
  assert.deepEqual(geKeys, ["FREE1"]);
  assert.equal(generalElectives.placedSH, 4);
});

// ── Consumption caps and contention ───────────────────────────────────
//
// The reported bug: a section that needs three courses counted four, because a
// RANGE claimed every course in its window regardless of what its parent asked
// for. These assert the cap in each shape that can carry one, that the surplus
// reaches General Electives rather than vanishing, and that capping does not
// let a flexible pool strand a requirement with no substitute.

const bioMap = {
  BIOL2500: { subject: "BIOL", number: "2500", sh: 4 },
  BIOL2600: { subject: "BIOL", number: "2600", sh: 4 },
  BIOL2700: { subject: "BIOL", number: "2700", sh: 4 },
  BIOL2800: { subject: "BIOL", number: "2800", sh: 4 },
};

test("allocate › a RANGE with no credit cap claims ONE course, not its whole window", () => {
  // "Intermediate/Advanced Biology Electives" in Computer Science and Biology BS:
  // minRequirementCount 1 over a bare OR of RANGEs, under no XOM at all. It used
  // to claim every placed biology course in range, so the surplus never reached
  // General Electives and no later section could use it.
  const major = { requirementSections: [
    { title: "Bio Elective", minRequirementCount: 1, requirements: [
      { type: "OR", courses: [
        { type: "RANGE", subject: "BIOL", idRangeStart: 2000, idRangeEnd: 4999 },
      ] },
    ] },
  ] };
  const placedSet = set("BIOL2500", "BIOL2600", "BIOL2700");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, true);
  assert.equal(sections[0].allocatedCourses.size, 1, "one course claimed, not three");
  assert.equal(generalElectives.placedSH, 8, "the other two are free credit, not swallowed");
});

test("allocate › a `choose N of M` section stops at N, and the surplus is general-elective credit", () => {
  const major = { requirementSections: [
    { title: "Pick two", minRequirementCount: 2, requirements: [
      { type: "COURSE", subject: "BIOL", classId: "2500" },
      { type: "COURSE", subject: "BIOL", classId: "2600" },
      { type: "COURSE", subject: "BIOL", classId: "2700" },
      { type: "COURSE", subject: "BIOL", classId: "2800" },
    ] },
  ] };
  const placedSet = set("BIOL2500", "BIOL2600", "BIOL2700", "BIOL2800");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
  assert.equal(sections[0].allocatedCourses.size, 2, "claims exactly the two it asked for");
  assert.equal(generalElectives.placedSH, 8,
    "the other two must land in General Electives, not disappear from the audit");
});

test("allocate › every placed course is claimed exactly once, or is general-elective credit — never neither", () => {
  // The partition invariant. A course released by a capped pool that no other
  // section lists must still be accounted for; losing it is worse than
  // over-counting it, because the student's credit total silently drops.
  const major = { requirementSections: [
    { title: "Pick one", minRequirementCount: 1, requirements: [
      { type: "RANGE", subject: "BIOL", idRangeStart: 2000, idRangeEnd: 4999 },
    ] },
  ] };
  const placedSet = set("BIOL2500", "BIOL2600", "BIOL2700", "BIOL2800");
  const { sections, generalElectives, allocatedSet } =
    allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
  const accounted = new Set([...allocatedSet, ...generalElectives.allocatedCourses]);
  assert.deepEqual([...placedSet].filter(k => !accounted.has(k)), [],
    "no placed course may be claimed by nothing");
  assert.equal(sections[0].allocatedCourses.size + generalElectives.children.length, 4);
});

test("allocate › a flexible range does not eat the only course an inflexible section can use", () => {
  // Computer Science and History BS: "Intermediate/Advanced History Course" is a
  // bare RANGE over HIST 2000–2999 and is declared BEFORE "Integrative Course
  // Requirement", which names HIST 2211 and has no alternative. Greedy
  // declaration order gave the range HIST 2211 and told a student who had taken
  // exactly the right course that they had not.
  const cm = {
    HIST2211: { subject: "HIST", number: "2211", sh: 4 },
    HIST2500: { subject: "HIST", number: "2500", sh: 4 },
  };
  const major = { requirementSections: [
    { title: "Any intermediate history", minRequirementCount: 1, requirements: [
      { type: "RANGE", subject: "HIST", idRangeStart: 2000, idRangeEnd: 2999 },
    ] },
    { title: "Integrative", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "HIST", classId: "2211" },
    ] },
  ] };
  const placedSet = set("HIST2211", "HIST2500");
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["Integrative"].sat, true,
    "the course only one section can use must go to that section");
  assert.equal(byTitle["Any intermediate history"].sat, true,
    "and the range takes the substitute it has, so BOTH are met");
});

test("allocate › a course two sections equally cannot do without is not reserved to either", () => {
  // Reservation is only sound when exactly one requirement has no substitute.
  // With two, there is no evidence to prefer one, so it must fall back to the
  // ordinary pass rather than reserve arbitrarily. Both sections NAME the
  // course, so both are met — and the credit is still counted once.
  const cm = { HIST2211: { subject: "HIST", number: "2211", sh: 4 } };
  const major = { requirementSections: [
    { title: "A", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "HIST", classId: "2211" },
    ] },
    { title: "B", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "HIST", classId: "2211" },
    ] },
  ] };
  const placedSet = set("HIST2211");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat && sections[1].sat, true, "both name it, so both are met");
  assert.equal(generalElectives.placedSH, 0, "its credit is not ALSO free elective credit");
});

test("allocate › the verdict does not depend on the order courses were added to the plan", () => {
  // A Set iterates in insertion order, so before the allocation order was made
  // explicit, WHICH three of four equally eligible electives counted — and
  // therefore which one showed under General Electives — changed when the
  // student reordered a term. Same plan, six orderings, one answer.
  const major = { requirementSections: [
    { title: "Electives", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 12, courses: [
        { type: "RANGE", subject: "BIOL", idRangeStart: 2000, idRangeEnd: 4999 },
      ] },
    ] },
  ] };
  const keys = ["BIOL2500", "BIOL2600", "BIOL2700", "BIOL2800"];
  const orderings = [
    keys, [...keys].reverse(),
    ["BIOL2700", "BIOL2500", "BIOL2800", "BIOL2600"],
    ["BIOL2800", "BIOL2700", "BIOL2500", "BIOL2600"],
    ["BIOL2600", "BIOL2800", "BIOL2500", "BIOL2700"],
    ["BIOL2500", "BIOL2800", "BIOL2600", "BIOL2700"],
  ];
  const verdicts = orderings.map(order => {
    const placedSet = new Set(order);
    const { sections, generalElectives } =
      allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
    return JSON.stringify({
      claimed: [...sections[0].allocatedCourses].sort(),
      general: generalElectives.children.map(c => c.key).sort(),
    });
  });
  assert.equal(new Set(verdicts).size, 1, `order changed the verdict: ${verdicts.join(" | ")}`);
  assert.equal(JSON.parse(verdicts[0]).claimed.length, 3, "12 SH is three 4 SH courses");
});

test("allocate › a credit pool overshoots its threshold as little as the courses allow", () => {
  // An 8 SH pool offered {4, 3, 4} took 4+3+4 = 11 under a by-key order, keeping
  // a course out of General Electives that it never needed.
  const cm = {
    CS2502: { subject: "CS", number: "2502", sh: 3 },
    CS2503: { subject: "CS", number: "2503", sh: 4 },
    CS2504: { subject: "CS", number: "2504", sh: 4 },
  };
  const major = { requirementSections: [
    { title: "Khoury Elective", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 8, courses: [
        { type: "RANGE", subject: "CS", idRangeStart: 2500, idRangeEnd: 9999 },
      ] },
    ] },
  ] };
  const placedSet = set("CS2502", "CS2503", "CS2504");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, true);
  assert.deepEqual([...sections[0].allocatedCourses].sort(), ["CS2503", "CS2504"]);
  assert.equal(generalElectives.placedSH, 3, "the 3 SH course was never needed");
});

test("allocate › capping a pool never strands a course a nested SECTION still needs", () => {
  // Sections nest, and a nested one is allocated through the same node walk. A
  // cap applied at the outer level must not consume what the inner one names.
  const cm = {
    PHYS2303: { subject: "PHYS", number: "2303", sh: 4 },
    PHYS2304: { subject: "PHYS", number: "2304", sh: 4 },
  };
  const major = { requirementSections: [
    { title: "Outer", minRequirementCount: 2, requirements: [
      { type: "RANGE", subject: "PHYS", idRangeStart: 2000, idRangeEnd: 2999 },
      { type: "SECTION", title: "Inner", minRequirementCount: 1, requirements: [
        { type: "COURSE", subject: "PHYS", classId: "2304" },
      ] },
    ] },
  ] };
  const placedSet = set("PHYS2303", "PHYS2304");
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, true, "range takes 2303, nested section keeps 2304");
});

test("allocate › a malformed requirement node still allocates the rest of the section", () => {
  // Every input here is scraped. A null child, a scalar, and an unknown type
  // must not take the requirements panel down or swallow a placed course.
  const major = { requirementSections: [
    { title: "Junk", minRequirementCount: 1, requirements: [
      null, 42, { type: "constructor" }, { type: "RANGE", subject: "BIOL", idRangeStart: 2000, idRangeEnd: 4999 },
    ] },
  ] };
  const placedSet = set("BIOL2500", "BIOL2600");
  const { sections, generalElectives } =
    allocateMajorWithElectives(major, placedSet, bioMap, { realPlacedSet: placedSet });
  assert.equal(sections[0].sat, true);
  assert.equal(sections[0].allocatedCourses.size, 1);
  assert.equal(generalElectives.placedSH, 4);
});

// ── Credit totals ─────────────────────────────────────────────────────
test("getTotalPlacedSH › sums each placed course's sh once", () => {
  const placements = { CS2000: "fall", CS3000: "spring", CS3001: "spring" };
  assert.equal(getTotalPlacedSH(placements, courseMap), 4 + 4 + 1);
});

test("buildPlacedKeySet › dedupes to canonical keys and ignores unknown ids", () => {
  const keys = buildPlacedKeySet({ CS2000: "fall", NOPE0000: "fall" }, new Set(["CS3000"]), courseMap);
  assert.deepEqual([...keys].sort(), ["CS2000", "CS3000"]);
});

test("courseKey › joins subject and id with no separator", () => {
  assert.equal(courseKey("CS", "2000"), "CS2000");
});
