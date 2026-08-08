// UNIT · working out which requirement a plan's placeholder stands for.
//
// The case that defines the module is Computer Science and Mathematics, BS:
// the plan writes "Computing and social issues" and the requirement tables
// title the very same requirement "Supporting Course". No amount of reading
// the words connects them. It is identified because the Khoury, Mathematics
// and general-elective requirements fill up with slots that DO name them, and
// the Supporting Course is the only thing left it could be.
//
// So the properties under test are: wording never decides; a hint that
// disagrees with the arithmetic loses; and the answer does not depend on the
// order slots are visited in.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  obligationsOf, bindSlots, suggestedSpec, isSuggested,
  GENERAL_ELECTIVE_KEY, specAdmitsSubject,
} from "../../src/core/slotBinding.js";
import { createSlotHints } from "../../src/adapters/northeastern/slotHints.js";
import { courseEligible } from "../../src/core/programEligibility.js";
import { hasAttributes } from "../../src/core/courseAttributes.js";

// ── Fixtures, cut to the real shape of CS and Math ─────────────────

const COURSE = (subject, classId) => ({ type: "COURSE", subject, classId });
const RANGE  = (subject, a, b) => ({ type: "RANGE", subject, idRangeStart: a, idRangeEnd: b, exceptions: [] });
const XOM    = (numCreditsMin, ...courses) => ({ type: "XOM", numCreditsMin, courses });
const OR     = (...courses) => ({ type: "OR", courses });
const SECTION = (title, requirements, minRequirementCount) => ({
  type: "SECTION", title, requirements,
  minRequirementCount: minRequirementCount ?? requirements.length,
});

const PROGRAM = {
  name: "Computer Science and Mathematics, BS (Boston)",
  totalCreditsRequired: 132,
  generalElectiveSH: 28,
  requirementSections: [
    SECTION("Computer Science Required Courses", [COURSE("CS", 3000), COURSE("CS", 3800)]),
    SECTION("Khoury Approved Electives", [
      XOM(8, RANGE("CS", 2500, 9999), RANGE("CY", 2000, 9999), RANGE("DS", 2500, 9999), COURSE("MKTG", 4606)),
    ], 1),
    SECTION("Mathematics Electives", [XOM(12, RANGE("MATH", 3001, 4999))], 1),
    SECTION("Supporting Course", [
      OR(COURSE("AFCS", 2600), COURSE("CY", 4170), COURSE("HIST", 2220),
         COURSE("PHIL", 1145), COURSE("SOCL", 1280)),
    ], 1),
  ],
};

/** Every course the fixtures mention, all 4 SH as NEU's standard. */
const courseMap = Object.fromEntries(
  ["CS3000", "CS3800", "CS4500", "CY4170", "DS3000", "MKTG4606",
   "MATH3081", "MATH3175", "MATH4025", "AFCS2600", "HIST2220", "PHIL1145", "SOCL1280"]
    .map(id => [id, { id, subject: id.replace(/\d.*$/, ""), number: id.replace(/^\D+/, ""), sh: 4 }]),
);

const SUBJECTS = ["CS", "CY", "DS", "MATH", "MKTG", "AFCS", "HIST", "PHIL", "SOCL", "ENGW"];
const NUPATH = ["ND","EI","IC","FQ","SI","AD","DD","ER","WF","WD","WI","EX","CE"];
const hints = createSlotHints(SUBJECTS, NUPATH);

let seq = 0;
const slot = (label, sh = 4) => ({
  id: `~slot:s${seq++}`, semId: "fall2026", label, sh, filledBy: null, constraint: "inferred",
});
const asMap = (list) => Object.fromEntries(list.map(s => [s.id, s]));

/** The plan's own named courses — what the student would have after applying it. */
const PLACED = new Set(["CS3000", "CS3800"]);

/** The 13 placeholders CS and Math's first plan actually contains. */
function csMathSlots() {
  seq = 0;
  return [
    ...Array.from({ length: 2 }, () => slot("Khoury Elective")),
    slot("MATH elective"), slot("MATH elective"), slot("Math elective"),
    slot("Computing and social issues"),
    ...Array.from({ length: 7 }, () => slot("General Elective")),
  ];
}

// ── Obligations ────────────────────────────────────────────────────

test("obligations · a requirement the plan already names is not left over", () => {
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const titles = obs.map(o => o.title);
  assert.ok(!titles.includes("Computer Science Required Courses"),
    "CS 3000 and CS 3800 are placed, so that section has nothing outstanding");
});

test("obligations · shortfall is stated in credit hours, from the audit's own numbers", () => {
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const by = Object.fromEntries(obs.map(o => [o.title || o.key, o.shortfallSH]));
  assert.equal(by["Khoury Approved Electives"], 8);
  assert.equal(by["Mathematics Electives"], 12);
  assert.equal(by["Supporting Course"], 4, "one course, valued at what its candidates carry");
  assert.equal(by[GENERAL_ELECTIVE_KEY], 28);
});

test("obligations · a partly-satisfied pool reports only what is left", () => {
  const obs = obligationsOf(PROGRAM, { placedSet: new Set([...PLACED, "MATH3081"]), courseMap });
  const math = obs.find(o => o.title === "Mathematics Electives");
  assert.equal(math.shortfallSH, 8, "12 required, one 4 SH elective placed");
});

// ── The headline case ──────────────────────────────────────────────

test("binding · a placeholder that resembles nothing is identified by elimination", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });

  const csi = slots.find(s => s.label === "Computing and social issues");
  assert.deepEqual(bound[csi.id].obligations, ["Supporting Course#0"]);
  assert.equal(bound[csi.id].basis, "elimination",
    "nothing about the phrase was recognised — it is what was left");
});

test("binding · the hinted slots land on their own requirements", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });
  const of = (label) => bound[slots.find(s => s.label === label).id];

  assert.deepEqual(of("Khoury Elective").obligations, ["Khoury Approved Electives#0"]);
  assert.equal(of("Khoury Elective").basis, "title");

  // "MATH elective" and "Math elective" are the same requirement written twice.
  assert.deepEqual(of("MATH elective").obligations, ["Mathematics Electives#0"]);
  assert.deepEqual(of("Math elective").obligations, ["Mathematics Electives#0"]);
  assert.equal(of("MATH elective").basis, "subject");

  assert.deepEqual(of("General Elective").obligations, [GENERAL_ELECTIVE_KEY]);
});

test("binding · every slot is accounted for, and the credit closes", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });

  assert.equal(Object.keys(bound).length, slots.length, "no slot left unbound");
  const demand = obs.reduce((n, o) => n + o.shortfallSH, 0);
  const supply = slots.reduce((n, s) => n + s.sh, 0);
  assert.equal(supply, demand, "52 SH of placeholders against 52 SH of requirement");
});

// ── The properties that make elimination safe ──────────────────────

test("order · the fixpoint does not depend on the order slots are visited", () => {
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const forward = csMathSlots();
  const reverse = [...csMathSlots()].reverse();

  const a = bindSlots(asMap(forward), obs, { courseMap, hints });
  const b = bindSlots(asMap(reverse), obs, { courseMap, hints });

  const label = (list, id) => list.find(s => s.id === id).label;
  const norm = (bound, list) => Object.entries(bound)
    .map(([id, v]) => `${label(list, id)}=${v.obligations.join(",")}`).sort();

  assert.deepEqual(norm(a, forward), norm(b, reverse));
});

test("hints · a hint that contradicts the arithmetic is dropped, not obeyed", () => {
  // A plan naming a MATH elective for a program with no MATH requirement at
  // all. The subject hint has nothing to select, so it must not strand the
  // slot with an empty domain.
  const program = {
    totalCreditsRequired: 8, generalElectiveSH: 4,
    requirementSections: [SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1)],
  };
  const s = slot("MATH elective");
  const obs = obligationsOf(program, { placedSet: new Set(), courseMap });
  const bound = bindSlots(asMap([s]), obs, { courseMap, hints });

  assert.ok(bound[s.id].obligations.length >= 1, "still bound to something");
  assert.notEqual(bound[s.id].basis, "subject", "the subject hint selected nothing, so it did not decide");
});

test("hints · wording alone never binds when the arithmetic disagrees", () => {
  // Two Khoury slots for a requirement that only has room for one. The second
  // cannot be ruled in, but neither is wrongly forced elsewhere.
  const program = {
    totalCreditsRequired: 12, generalElectiveSH: 4,
    requirementSections: [SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1)],
  };
  const slots = [slot("Khoury Elective"), slot("Khoury Elective")];
  const obs = obligationsOf(program, { placedSet: new Set(), courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });
  for (const s of slots) assert.ok(bound[s.id].obligations.length >= 1);
});

test("binding · a stated slot binds from its codes, and consumes the requirement", () => {
  // The catalog printing "CS 4530 or 4535" means that requirement is answered.
  // Leaving such a slot out of the accounting is what made CS and Math report
  // two phantom shortfalls and put three candidates on the one slot this
  // module exists to identify.
  const exact = {
    id: "~slot:x", semId: "fall2026", label: "CS 4530 or 4535", sh: 4,
    filledBy: null, constraint: "exact", candidates: ["CS4500"],
  };
  const csi = slot("Computing and social issues");
  const program = {
    totalCreditsRequired: 8,
    requirementSections: [
      SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1),
      SECTION("Supporting Course", [OR(COURSE("PHIL", 1145), COURSE("SOCL", 1280))], 1),
    ],
  };
  const obs = obligationsOf(program, { placedSet: new Set(), courseMap });
  const bound = bindSlots(asMap([exact, csi]), obs, { courseMap, hints });

  assert.equal(bound[exact.id].basis, "stated", "read from the printed codes, never the wording");
  assert.deepEqual(bound[exact.id].obligations, ["Khoury Approved Electives#0"]);
  assert.deepEqual(bound[csi.id].obligations, ["Supporting Course#0"],
    "and by consuming Khoury it forces the slot that resembles nothing");
});

test("binding · a filled slot is not bound again", () => {
  const filled = { ...slot("Khoury Elective"), filledBy: "CS4500" };
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  assert.equal(bindSlots(asMap([filled]), obs, { courseMap, hints })[filled.id], undefined);
});

test("binding · no requirements at all yields no bindings, not a crash", () => {
  assert.deepEqual(bindSlots(asMap([slot("Elective")]), [], { courseMap, hints }), {});
  assert.deepEqual(obligationsOf(null, { courseMap }), []);
});

// ── What may fill the slot ─────────────────────────────────────────

test("suggestions · a bound slot offers its requirement's courses, ranges intact", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });
  const math = bound[slots.find(s => s.label === "MATH elective").id];

  const spec = suggestedSpec(math, obs);
  assert.deepEqual(spec.ranges, [{ subject: "MATH", start: 3001, end: 4999, exceptions: new Set() }],
    "a 2,000-number span is carried as a range, never expanded into ids");
  assert.ok(courseEligible(courseMap.MATH3175, spec));
  assert.ok(!courseEligible(courseMap.CS4500, spec));
});

test("suggestions · the elimination-bound slot offers the Supporting Course list", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });
  const csi = bound[slots.find(s => s.label === "Computing and social issues").id];

  assert.ok(isSuggested(courseMap.PHIL1145, csi, obs));
  assert.ok(isSuggested(courseMap.SOCL1280, csi, obs));
  assert.ok(!isSuggested(courseMap.MATH3175, csi, obs), "not one of the ten the catalog lists");
});

test("suggestions · a general elective suggests nothing, which is not the same as no binding", () => {
  const slots = csMathSlots();
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap(slots), obs, { courseMap, hints });
  const ge = bound[slots.find(s => s.label === "General Elective").id];

  assert.deepEqual(ge.obligations, [GENERAL_ELECTIVE_KEY], "it IS bound");
  assert.equal(isSuggested(courseMap.MATH3175, ge, obs), false, "but it recommends nothing in particular");
});

test("capacity · a requirement claimed beyond its size gives back the weakest evidence", () => {
  // One 4 SH Capstone, contested by a slot that names it and one whose stated
  // range merely overlaps it. The named one is the weaker evidence, so it is
  // what steps back — and the printed rule is never given up.
  const program = {
    totalCreditsRequired: 8,
    requirementSections: [
      SECTION("Capstone", [OR(COURSE("MATH", 4025), COURSE("PHIL", 1145))], 1),
      SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1),
    ],
  };
  const named = slot("Capstone in PHIL or MATH");
  const ranged = slot("Course in the following range: MATH 3001 to MATH 4999");
  const obs = obligationsOf(program, { placedSet: new Set(), courseMap });
  const bound = bindSlots(asMap([named, ranged]), obs, { courseMap, hints });

  assert.equal(bound[ranged.id].basis, "range", "a rule the catalog printed is not relaxable");
  assert.notEqual(bound[named.id].basis, "title", "the weaker claim is the one given back");
});

test("suggestions · a cell that prints its own rule suggests from that rule", () => {
  // Even when it was matched to the wrong requirement — which happens wherever
  // a program's requirement parse is missing the section the cell was for.
  const program = {
    totalCreditsRequired: 4,
    requirementSections: [SECTION("Capstone", [OR(COURSE("MATH", 4025))], 1)],
  };
  const ranged = slot("Course in the following range: MATH 3001 to MATH 4999");
  const obs = obligationsOf(program, { placedSet: new Set(), courseMap });
  const bound = bindSlots(asMap([ranged]), obs, { courseMap, hints });

  const spec = suggestedSpec(bound[ranged.id], obs);
  assert.ok(courseEligible(courseMap.MATH3175, spec), "inside the printed range");
  assert.ok(!courseEligible(courseMap.PHIL1145, spec), "not the matched requirement's list");
});

// ── Hint readers ───────────────────────────────────────────────────

test("hints · reads subject, free-elective and self-stated range wording", () => {
  assert.equal(hints.subjectOf("MATH elective"), "MATH");
  assert.equal(hints.subjectOf("Math elective"), "MATH");
  assert.equal(hints.subjectOf("Khoury Elective"), null, "not a subject code");
  assert.equal(hints.subjectOf("Computing and social issues"), null);

  assert.ok(hints.isFreeElective("General Elective"));
  assert.ok(hints.isFreeElective("General elective"));
  assert.ok(hints.isFreeElective("Elective"));
  assert.ok(hints.isFreeElective("Open elective"));
  assert.ok(hints.isFreeElective("Elective (Dialogue of Civilizations possible)"));
  assert.ok(!hints.isFreeElective("Khoury Elective"));
  assert.ok(!hints.isFreeElective("Technical Elective"));

  // Math and Philosophy writes both cases inside one sentence.
  assert.deepEqual(hints.rangeOf("Course in the following range: MATH 3001 to Math 4999"),
    { subject: "MATH", start: 3001, end: 4999 });
  assert.equal(hints.rangeOf("General Elective"), null);
});

test("hints · title matching ignores the words every requirement shares", () => {
  assert.ok(hints.titleMatches("Khoury Elective", "Khoury Approved Electives"));
  assert.ok(hints.titleMatches("Security Course", "Security Required Course"));
  assert.ok(!hints.titleMatches("Computing and social issues", "Supporting Course"));
  assert.ok(!hints.titleMatches("Concentration course", "Supporting Course"),
    "sharing only the word 'course' is not a match");
});

// ── Attributes (NUpath) ────────────────────────────────────────────

test("attributes · a cell naming NUpath codes carries them, whatever it binds to", () => {
  const s = slot("General elective (NUpath DD)");
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const bound = bindSlots(asMap([s]), obs, { courseMap, hints });

  assert.deepEqual(bound[s.id].attributes, ["DD"]);
  assert.deepEqual(bound[s.id].obligations, [GENERAL_ELECTIVE_KEY],
    "the codes say WHICH course, not which requirement — it is still a free elective");
});

test("attributes · CE is not read as NUpath when it means Computer Engineering", () => {
  // ~90 cells read "EE or CE fundamentals" / "CE Fundamentals". A bare
  // two-letter search is wrong on about four in five of its CE hits.
  assert.deepEqual(hints.attributesOf("EE or CE fundamentals"), []);
  assert.deepEqual(hints.attributesOf("CE Fundamentals"), []);
  assert.deepEqual(hints.attributesOf("EE/CE Fundamental"), []);
  // …but it IS read when the cell says so.
  assert.deepEqual(hints.attributesOf("Senior design elective (EI, WI, CE)"), ["EI", "WI", "CE"]);
});

test("attributes · a parenthetical of prose yields nothing", () => {
  assert.deepEqual(hints.attributesOf("Elective (Dialogue of Civilizations possible)"), []);
  assert.deepEqual(hints.attributesOf("General Elective"), []);
  assert.deepEqual(hints.attributesOf("Science elective (SI)"), ["SI"]);
  assert.deepEqual(hints.attributesOf("NUpath ER"), ["ER"]);
  assert.deepEqual(hints.attributesOf("DD NUpath"), ["DD"]);
});

test("attributes · suggestion filters on the attribute even with no course set", () => {
  const s = slot("General elective (NUpath DD)");
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const b = bindSlots(asMap([s]), obs, { courseMap, hints })[s.id];

  assert.ok(isSuggested({ ...courseMap.PHIL1145, attributes: ["DD", "SI"] }, b, obs));
  assert.ok(!isSuggested({ ...courseMap.PHIL1145, attributes: ["SI"] }, b, obs));
  assert.ok(!isSuggested({ ...courseMap.PHIL1145, attributes: [] }, b, obs));
});

test("attributes · every requested attribute must be present, not just one", () => {
  assert.ok(hasAttributes({ attributes: ["IC", "DD"] }, ["IC", "DD"]));
  assert.ok(!hasAttributes({ attributes: ["IC"] }, ["IC", "DD"]));
  assert.ok(hasAttributes({ attributes: [] }, []), "asking for nothing matches everything");
  assert.ok(!hasAttributes(null, ["DD"]));
});

test("specs · subject admission is checked against courses, not titles", () => {
  const obs = obligationsOf(PROGRAM, { placedSet: PLACED, courseMap });
  const khoury = obs.find(o => o.title === "Khoury Approved Electives");
  assert.ok(specAdmitsSubject(khoury.spec, "CS"));
  assert.ok(!specAdmitsSubject(khoury.spec, "MATH"),
    "which is what excludes a MATH slot from Khoury as a fact rather than a guess");
});
