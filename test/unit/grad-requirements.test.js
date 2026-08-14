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
  allocateMajorWithElectives, getTotalPlacedSH,
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
test("allocate › a course cannot satisfy two separate (non-shared) sections", () => {
  const major = { requirementSections: [
    { title: "A", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
    { title: "B", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
  assert.equal(sections.filter(s => s.sat).length, 1, "only one section may consume the single CS2000");
});

test("allocate › a `shared` section cross-counts without starving a normal section", () => {
  const major = { requirementSections: [
    { title: "GPA re-list", shared: true, minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
    { title: "Core", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000");
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
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
  const { generalElectives } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
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
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, null, placedSet);
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
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
  const byTitle = Object.fromEntries(sections.map(s => [s.title, s]));
  assert.equal(byTitle["Pool A"].sat, true, "range pool satisfied by one match");
  assert.equal(byTitle["Pool B"].sat, true,
    "the other range match must remain free for the section that names it specifically");
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

  const short = allocateMajorWithElectives(major, placedSet, cmShort, null, placedSet);
  assert.equal(short.sections[0].sat, false, "40 of 68 SH is not enough");

  const enough = allocateMajorWithElectives(major, placedSet, cmEnough, null, placedSet);
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
  const { sections } = allocateMajorWithElectives(major, placedSet, cm, null, placedSet);
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
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
  assert.equal(sections[0].sat, true);
});

test("allocate › an unrequired placed course lands in General Electives with its credits", () => {
  const major = { requirementSections: [
    { title: "Core", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
  ] };
  const placedSet = set("CS2000", "FREE1");
  const { generalElectives } = allocateMajorWithElectives(major, placedSet, courseMap, null, placedSet);
  const geKeys = generalElectives.children.map(c => c.key);
  assert.deepEqual(geKeys, ["FREE1"]);
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
