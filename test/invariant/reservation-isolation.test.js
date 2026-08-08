// INVARIANT · a reservation must never reach the maps that decide the degree.
//
// This exists because grepping for consumers kept missing them. Reservations
// were unhandled in five of six drag paths, and in SummerRow, and each was
// found only when something visibly broke. The rule is simple enough to
// assert directly, so it is asserted directly:
//
//   `placements`    course ids ONLY — the audit, GPA, prereq chains read this
//   `reservations`  reservation ids ONLY
//
// The one that actually hurt: a reservation dropped on a term's empty space
// ran the course path and wrote its id into `placements`. The card then
// existed in both maps and the grid did something incoherent with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  createReservation, moveReservation, removeReservation, fillReservation,
  semesterOccupants, occupantCards, isReservationId, RESERVATION_PREFIX,
} from "../../src/core/reservations.js";
import { applySamplePlan } from "../../src/core/applySamplePlan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PLAN = join(ROOT, "src/data/majors/2026/computer-information-science",
  "computer_science_and_mathematics_bs_(boston)/plan.json");

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];
const SUMMER_IDS = SEMESTERS.filter(s => s.type === "summer").map(s => s.id);

const courseMap = new Proxy({}, { get: (_, k) => ({ id: String(k), sh: 4 }), has: () => true });

/** The two maps must stay disjoint by KIND, whatever has been done to them. */
function assertIsolated(placements, reservations, what) {
  for (const id of Object.keys(placements)) {
    assert.ok(!isReservationId(id), `${what}: reservation id ${id} reached placements`);
  }
  for (const id of Object.keys(reservations)) {
    assert.ok(isReservationId(id), `${what}: non-reservation id ${id} reached reservations`);
  }
}

const load = () => {
  const grid = JSON.parse(readFileSync(PLAN, "utf8"));
  return applySamplePlan(grid.plans[0], { semesters: SEMESTERS, courseMap });
};

test("a real plan loads with the two maps disjoint", () => {
  const r = load();
  assertIsolated(r.placements, r.reservations, "load");
  assert.ok(Object.keys(r.reservations).length > 0, "the plan does reserve cells");
});

test("summers get reservations too", () => {
  // Summers render through a DIFFERENT component than fall/spring, which is how
  // this went unnoticed the first time: SemRow was taught and SummerRow was not,
  // so every summer reservation was invisible.
  const r = load();
  const inSummer = Object.values(r.reservations).filter(x => SUMMER_IDS.includes(x.semId));
  assert.ok(inSummer.length > 0,
    "CS and Mathematics reserves summer cells; none of them appeared");
});

test("every drag path leaves the maps disjoint", () => {
  const r = load();
  const ids = Object.keys(r.reservations);
  let res = r.reservations;
  const pl = { ...r.placements };

  // move within a term, across terms, and into a summer
  res = moveReservation(res, ids[0], "spr2028");
  res = moveReservation(res, ids[1], "sumA2029");
  assertIsolated(pl, res, "after moves");

  // drag to the bank == delete
  res = removeReservation(res, ids[2]);
  assert.ok(!res[ids[2]], "removed");
  assertIsolated(pl, res, "after bank drop");

  // fill: the card goes, the course is placed in ITS term
  const filled = fillReservation(res, ids[3], "CS4999");
  Object.assign(pl, { CS4999: filled.semId });
  assertIsolated(pl, filled.reservations, "after fill");
  assert.ok(!filled.reservations[ids[3]], "the filled card is gone");
});

test("the grid view mixes them, and the audit's map never does", () => {
  const r = load();
  const view = semesterOccupants(r.placements, r.reservations);
  const cards = occupantCards(courseMap, r.reservations);

  // The grid sees both…
  const reservedInView = Object.keys(view).filter(isReservationId);
  assert.equal(reservedInView.length, Object.keys(r.reservations).length);
  for (const id of reservedInView) assert.ok(cards[id], `no card for ${id}`);

  // …and building it left the source map alone.
  assertIsolated(r.placements, r.reservations, "after deriving the view");
});

test("a reservation id can never be mistaken for a course id", () => {
  // The prefix is what makes every guard above a cheap, total test.
  assert.ok(RESERVATION_PREFIX.length > 0);
  const r = createReservation({ semId: "fall2026", label: "Khoury Elective", sh: 4 });
  assert.ok(isReservationId(r.id));
  for (const id of ["CS2500", "CS2500#2", "MATH1341", "coop-plan-spr2027", ""]) {
    assert.ok(!isReservationId(id), `${id} must not read as a reservation`);
  }
});

test("no UI file re-derives a semester's contents for itself", () => {
  // The rule that replaces the old one. Three bugs came from twelve call sites
  // each choosing between the raw maps and a combined view, and the wrong
  // answer looking right. There is now one way to ask — semesterCards /
  // semesterCardIds / semesterLoad — and this fails if a file goes back to
  // deriving it, which is the only way the choice can return.
  const OFFENDERS = /getOrderedCourses\(|getSemStudySH\(|gridPlacements\s*\?\?|gridCourseMap\s*\?\?/;
  const files = ["src/ui/SemRow.jsx", "src/ui/SummerRow.jsx", "src/ui/Header.jsx",
                 "src/ui/StatsPanel.jsx"];
  const bad = [];
  for (const rel of files) {
    for (const line of readFileSync(join(ROOT, rel), "utf8").split("\n")) {
      if (line.trim().startsWith("//") || line.includes("import")) continue;
      if (OFFENDERS.test(line)) bad.push(`${rel}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], "a UI file deriving term contents instead of asking for them");
});

test("the grid's view follows the Claude preview, like every other surface", () => {
  // While a proposal is previewed, `pvPlacements` is the simulated plan and
  // the header, grad panel and totals all render it. Building the semester
  // view from the REAL `placements` — which is what I did first — left the
  // grid showing the student's actual courses while everything around it
  // showed the proposal.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  const build = /const semView = useMemo\([\s\S]*?\]\);/.exec(src)?.[0];
  assert.ok(build, "semView is gone — the grid view has been restructured");
  assert.match(build, /placements:\s*pvPlacements/,
    "the semester view ignores the Claude preview");
  assert.ok(!/buildSemesterView\(\{\s*placements,/.test(build),
    "the semester view is built from real placements, not the previewed ones");
});

test("the printed report gets layout and degree maps SEPARATELY", () => {
  // exportReport computes the requirement audit, credit totals and the NUPath
  // grid from `placements`/`courseMap`, and lays out semesters from `view`.
  // Passing the combined view for both — which is what I did first — puts
  // reservation ids into buildPlacedKeySet and their credit into the general
  // elective calculation, crediting a printed plan for courses nobody chose.
  const header = readFileSync(join(ROOT, "src/ui/Header.jsx"), "utf8");
  const call = /exportReport\([^;]*\);/.exec(header)?.[0];
  assert.ok(call, "exportReport is no longer called from Header");
  assert.ok(!/exportReport\(\s*semView\./.test(call),
    "the combined view is being passed as the DEGREE input");
  assert.match(call, /semView\s*\)/, "the combined view is not being passed for layout at all");

  const model = readFileSync(join(ROOT, "src/core/planModel.js"), "utf8");
  assert.match(model, /const layoutPlacements = view\?\.occupants \?\? placements;/,
    "exportReport no longer separates its two inputs");
});

test("undo captures and restores reservations", () => {
  // The undo snapshot shape existed three times — pushUndo, and the
  // counter-push inside each of doUndo and doRedo — and reservations were in
  // none of them. Loading a plan and pressing undo removed its courses and
  // left every reserved card behind; moving or deleting one could not be
  // undone at all.
  //
  // Now one snapshotPlan / restoreSnapshot pair. This asserts both mention
  // reservations, and that no fourth copy of the shape has appeared.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");

  const snap = /const snapshotPlan = \(\) => \(\{[\s\S]*?\}\);/.exec(src)?.[0];
  assert.ok(snap, "snapshotPlan is gone — undo has been restructured");
  assert.match(snap, /reservations:/, "the undo snapshot does not capture reservations");

  const restore = /const restoreSnapshot = \(snap\) => \{[\s\S]*?\n  \};/.exec(src)?.[0];
  assert.ok(restore, "restoreSnapshot is gone");
  assert.match(restore, /setReservations\(/, "undo does not put reservations back");

  // A hand-rolled snapshot is how the shape got out of step before.
  const copies = src.split("\n").filter(l =>
    /placements:\s*stateRef\.current\.placements/.test(l)).length;
  assert.equal(copies, 1, "a second hand-built undo snapshot has appeared");
});

test("anything that CLEARS a plan clears reservations too", () => {
  // Reset cleared placements, special terms, orders, grades and the palette,
  // and left every reserved card behind — a term full of "Khoury Elective" in
  // a plan with no courses and no major, which reads as the reset having
  // failed. The restore direction had already been fixed; the clear direction
  // is the mirror of it and was missed for the same reason.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  const lines = src.split("\n");
  const missing = [];
  lines.forEach((line, i) => {
    if (!/setPlacements\(\{\}\)/.test(line)) return;
    const near = lines.slice(Math.max(0, i - 4), i + 12).join("\n");
    if (!/setReservations\(\{\}\)/.test(near)) missing.push(`line ${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(missing, [], "a clear path that leaves reservations behind");
});

test("every door a plan comes through carries reservations", () => {
  // There are two restore functions — restorePlan for slots and applyPlanData
  // for share links and imported files — and reservations were added to one.
  // So a shared plan arrived with its named courses and none of its reserved
  // cards, which for a later year is most of the plan. Same defect as the
  // `substitutions` note beside captureCurrentPlan, one door along.
  //
  // Asserted as source: every function that restores `placements` must restore
  // `reservations` in the same breath.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  const lines = src.split("\n");
  const missing = [];
  lines.forEach((line, i) => {
    if (!/setPlacements\(d\.placements/.test(line)) return;
    const near = lines.slice(i, i + 12).join("\n");
    if (!/setReservations\(/.test(near)) missing.push(`line ${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(missing, [], "a restore path that forgets reservations");
});

test("only ONE place decides where a dropped card lands", () => {
  // Every hole in this feature came from the same shape: two implementations
  // of one rule. SemRow and SummerRow. planDrop and the course path. And then
  // the same-semester reorder, which kept its own copy of "which side of the
  // target" long enough for a forward drag to be a no-op in one of them.
  //
  // splice-based reordering is that copy's signature, so its absence is what is
  // asserted. planDrop.js is the one place allowed to answer the question.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  const bad = src.split("\n").filter(line =>
    !line.trim().startsWith("//") &&
    /\.splice\([^)]*,\s*0\s*,\s*dragId/.test(line));
  assert.deepEqual(bad, [], "a second implementation of where a dropped card lands");
});

test("ordering is computed over the combined view everywhere, without exception", () => {
  // Ordering is a LAYOUT question, so every call must see reservations. Six of
  // the nine call sites did not, which meant any course drop into a term
  // holding reservations rewrote that term's order with them missing — and
  // getOrderedCourses then re-appended them at the end. That is the "it added
  // it alongside instead of swapping" report.
  //
  // Asserted as source, because the failure is a call site nobody updated
  // rather than a value anyone can observe from outside.
  const files = [
    "src/context/PlannerContext.jsx",
    "src/ui/SemRow.jsx",
    "src/ui/SummerRow.jsx",
    "src/ui/Header.jsx",
  ];
  const offenders = [];
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const line of src.split("\n")) {
      if (!line.includes("getOrderedCourses(")) continue;
      if (line.trim().startsWith("//")) continue;
      if (line.includes("import")) continue;
      if (!line.includes("gridPlacements")) offenders.push(`${rel}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "ordering computed without the combined view");
});
