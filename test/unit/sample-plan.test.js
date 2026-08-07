// UNIT · mapping a department's sample plan onto planner state.
//
// Two properties carry the weight here, and they pull against each other:
//
//   ADDITIVE   applying a plan must never undo a decision the student made,
//              so it can only ever add, and applying it twice is a no-op
//   HONEST     everything it cannot place comes back as a note, because a
//              plan that quietly loses a third of itself looks like it worked
//
// The rest is arithmetic about co-op runs, which the catalog writes one column
// at a time and NU registers in four- and six-month blocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSamplePlan, academicYears, summarizeSamplePlan } from "../../src/core/samplePlan.js";

/** Four academic years in NU's shape, matching src/core/semGrid.js output. */
const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029].flatMap(y => [
    { id: `fall${y}`,     label: `Fall ${y}`,       semTypeId: "fall",   type: "fall",   weight: 1.0 },
    { id: `spr${y + 1}`,  label: `Spring ${y + 1}`, semTypeId: "spring", type: "spring", weight: 1.0 },
    { id: `sumA${y + 1}`, label: `Summer 1 ${y+1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, label: `Summer 2 ${y+1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];

const COURSES = ["CS1200", "CS1800", "CS1802", "CS2500", "CS2510", "MATH1341", "MATH1365", "MATH1465", "ENGW1111"];
const courseMap = Object.fromEntries(COURSES.map(id => [id, { id, sh: 4 }]));

const term = (type, name, entries, extra = {}) => ({ term: name, type, hours: null, entries, ...extra });
const plan = (...years) => ({ label: "Test Plan", years });
const year = (label, ...terms) => ({ label, terms });

const course = (...codes) => ({ kind: codes.length > 1 ? "courses" : "course", codes, text: codes.join(" and ") });
const choice = (...codes) => ({ kind: "choice", codes, text: codes.join(" or ") });
const coop = () => ({ kind: "coop", text: "Co-op" });
const filler = (text = "General Elective") => ({ kind: "placeholder", text });

const apply = (p, ctx = {}) => mapSamplePlan(p, { semesters: SEMESTERS, courseMap, ...ctx });

// ── Timeline mapping ─────────────────────────────────────────────────────────

test("sample plan › academic years are split by the calendar, not by id", () => {
  const years = academicYears(SEMESTERS);
  assert.equal(years.length, 4);
  assert.deepEqual(years[0].map(s => s.id), ["fall2026", "spr2027", "sumA2027", "sumB2027"]);
  // "incoming" is not part of any academic year and must not open one.
  assert.ok(!years.flat().some(s => s.id === "incoming"));
});

test("sample plan › Year N lands on the Nth academic year", () => {
  const r = apply(plan(
    year("Year 1", term("fall", "Fall", [course("CS1200")])),
    year("Year 2", term("spring", "Spring", [course("CS2500")])),
  ));
  assert.equal(r.placements.CS1200, "fall2026");
  assert.equal(r.placements.CS2500, "spr2028");
});

test("sample plan › the year LABEL is cosmetic; position is what places it", () => {
  // The catalog labels years inconsistently, and a combined-degree page can
  // open its grid at "Year 2". Reading the number out of the label would file
  // those wrongly; the array position is the fact.
  const r = apply({ label: "x", years: [
    { label: "Year 3", terms: [term("fall", "Fall", [course("CS1200")])] },
  ] });
  assert.equal(r.placements.CS1200, "fall2026");
});

test("sample plan › a start offset shifts the whole plan", () => {
  // A student half-way through does not want Year 1 on their first semester.
  const r = apply(plan(year("Year 1", term("fall", "Fall", [course("CS1200")]))), { startYearIndex: 2 });
  assert.equal(r.placements.CS1200, "fall2028");
});

test("sample plan › a plan longer than the timeline reports, never truncates", () => {
  // A five-year plan on a four-year cohort. Silently dropping year 5 would
  // show the student a complete-looking plan missing a year of courses.
  const r = apply(plan(
    ...[1, 2, 3, 4].map(n => year(`Year ${n}`, term("fall", "Fall", [filler()]))),
    year("Year 5", term("fall", "Fall", [course("CS2510")])),
  ));
  assert.equal(r.placements.CS2510, undefined);
  const outside = r.notes.filter(n => n.kind === "outside-timeline");
  assert.equal(outside.length, 1);
  assert.equal(outside[0].year, "Year 5");
});

// ── Additive, never destructive ──────────────────────────────────────────────

test("sample plan › a course the student already placed does not move", () => {
  const r = apply(plan(year("Year 1", term("fall", "Fall", [course("CS1200")]))),
    { placements: { CS1200: "spr2029" } });
  assert.equal(r.placements.CS1200, "spr2029", "the student's own placement must win");
  assert.deepEqual(r.placed, []);
  assert.equal(r.notes.filter(n => n.kind === "already-placed").length, 1);
});

test("sample plan › a repeat instance still counts as having the course", () => {
  // "CS2500#2" is a second take of CS2500; placing a third copy from the plan
  // would be the tool inventing a retake.
  const r = apply(plan(year("Year 1", term("fall", "Fall", [course("CS2500")]))),
    { placements: { "CS2500#2": "spr2029" } });
  assert.equal(r.placements.CS2500, undefined);
  assert.equal(r.notes.filter(n => n.kind === "already-placed").length, 1);
});

test("sample plan › applying twice changes nothing the second time", () => {
  const p = plan(year("Year 1",
    term("fall", "Fall", [course("CS1200"), coop()]),
    term("spring", "Spring", [course("CS2500")]),
  ));
  const first  = apply(p);
  const second = mapSamplePlan(p, {
    semesters: SEMESTERS, courseMap,
    placements: first.placements, specialTermPl: first.specialTermPl,
  });
  assert.deepEqual(second.placements, first.placements);
  assert.deepEqual(second.specialTermPl, first.specialTermPl);
  assert.deepEqual(second.placed, []);
  assert.deepEqual(second.coops, []);
});

test("sample plan › the inputs are never mutated", () => {
  const placements = { CS1200: "fall2026" };
  const specialTermPl = {};
  apply(plan(year("Year 1", term("spring", "Spring", [course("CS2500"), coop()]))),
    { placements, specialTermPl });
  assert.deepEqual(placements, { CS1200: "fall2026" });
  assert.deepEqual(specialTermPl, {});
});

// ── What it refuses to decide ────────────────────────────────────────────────

test("sample plan › a choice is reported, never chosen", () => {
  // "MATH 1365 or 1465". Picking one silently would be the planner making the
  // student's decision and then checking its own work.
  const r = apply(plan(year("Year 1", term("fall", "Fall", [choice("MATH1365", "MATH1465")]))));
  assert.equal(r.placements.MATH1365, undefined);
  assert.equal(r.placements.MATH1465, undefined);
  const [note] = r.notes.filter(n => n.kind === "choice");
  assert.deepEqual(note.codes, ["MATH1365", "MATH1465"]);
  assert.equal(note.semId, "fall2026");
});

test("sample plan › a corequisite pair is both courses, not a choice", () => {
  const r = apply(plan(year("Year 1", term("fall", "Fall", [course("CS1800", "CS1802")]))));
  assert.equal(r.placements.CS1800, "fall2026");
  assert.equal(r.placements.CS1802, "fall2026");
});

test("sample plan › an unnamed slot is reported with its wording", () => {
  const r = apply(plan(year("Year 1", term("fall", "Fall", [filler("Science Requirement")]))));
  const [note] = r.notes.filter(n => n.kind === "placeholder");
  assert.equal(note.text, "Science Requirement");
  assert.equal(note.semId, "fall2026");
});

test("sample plan › a course we do not have is reported, not fatal", () => {
  // The catalog retires and renumbers courses; an old plan naming one is
  // information about the plan, not a reason to refuse the rest of it.
  const r = apply(plan(year("Year 1", term("fall", "Fall", [course("CS1200"), course("PHIL9999")]))));
  assert.equal(r.placements.CS1200, "fall2026");
  assert.equal(r.notes.filter(n => n.kind === "unknown-course")[0].code, "PHIL9999");
});

// ── Co-ops are runs ──────────────────────────────────────────────────────────

test("sample plan › consecutive co-op cells are ONE co-op", () => {
  // The grid writes a six-month co-op as Spring "Co-op" + Summer 1 "Co-op"
  // because it has one column per term. Two blocks would give the student
  // twice the co-ops their program requires.
  const r = apply(plan(year("Year 2",
    term("spring", "Spring", [coop()]),
    term("sumA", "Summer 1", [coop()]),
  )));
  assert.equal(r.coops.length, 1);
  assert.equal(r.coops[0].semId, "spr2027");
  assert.equal(r.coops[0].duration, 6, "spring (4mo) + summer half (2mo)");
});

test("sample plan › a single full term is a four-month co-op", () => {
  const r = apply(plan(year("Year 2", term("fall", "Fall", [coop()]))));
  assert.equal(r.coops.length, 1);
  assert.equal(r.coops[0].duration, 4);
});

test("sample plan › co-ops in different years stay separate", () => {
  const r = apply(plan(
    year("Year 2", term("fall", "Fall", [coop()])),
    year("Year 3", term("fall", "Fall", [coop()])),
  ));
  assert.equal(r.coops.length, 2);
  assert.deepEqual(r.coops.map(c => c.semId), ["fall2026", "fall2027"]);
});

test("sample plan › a length nobody offers snaps to one that exists", () => {
  // Summer 1 + Summer 2 is four months, which is a real co-op. But a lone
  // summer half is two, and NU sells 4 and 6 — the block has to be something
  // a student can actually register for.
  const pair = apply(plan(year("Year 2",
    term("sumA", "Summer 1", [coop()]), term("sumB", "Summer 2", [coop()]))));
  assert.equal(pair.coops[0].duration, 4);

  const half = apply(plan(year("Year 2", term("sumA", "Summer 1", [coop()]))));
  assert.equal(half.coops[0].duration, 4, "2 months snaps up to the nearest offered");
});

test("sample plan › an existing co-op anywhere in the run is left alone", () => {
  // The student already planned this stretch. Replacing it would drop the
  // company and role they typed in.
  const r = apply(plan(year("Year 2",
    term("spring", "Spring", [coop()]), term("sumA", "Summer 1", [coop()]))),
    { specialTermPl: { "coop-abc": { typeId: "coop", semId: "sumA2027", duration: 4, company: "Acme" } } });
  assert.deepEqual(r.coops, []);
  assert.deepEqual(r.specialTermPl, { "coop-abc": { typeId: "coop", semId: "sumA2027", duration: 4, company: "Acme" } });
  assert.equal(r.notes.filter(n => n.kind === "coop-kept").length, 1);
});

// ── Full summer ──────────────────────────────────────────────────────────────

test("sample plan › a full-summer term places into sumA and says so", () => {
  // Graduate programs write one "Summer Full Semester" column. The planner
  // splits summer in two, so the course lands where it starts and the student
  // is told the term spans both halves rather than being left to notice.
  const r = apply(plan(year("Year 1",
    term("sumA", "Summer Full Semester", [course("CS2510")], { fullSummer: true }))));
  assert.equal(r.placements.CS2510, "sumA2027");
  assert.equal(r.notes.filter(n => n.kind === "full-summer").length, 1);
});

// ── Summary ──────────────────────────────────────────────────────────────────

test("sample plan › the summary counts every category it reports", () => {
  const r = apply(plan(year("Year 1",
    term("fall", "Fall", [course("CS1200"), choice("MATH1365", "MATH1465"), filler()]),
    term("spring", "Spring", [coop()]),
  )));
  assert.deepEqual(summarizeSamplePlan(r), {
    placed: 1, coops: 1, choices: 1, placeholders: 1,
    alreadyPlaced: 0, unknown: 0, outsideRange: 0, coopsKept: 0,
  });
});

test("sample plan › an empty or missing plan is safe", () => {
  for (const p of [null, undefined, {}, { years: [] }]) {
    const r = apply(p);
    assert.deepEqual(r.placed, []);
    assert.deepEqual(r.coops, []);
  }
});
