// A requirement naming a course that cannot be taken, attacked.
//
// The decision this implements: a degree whose requirements name a retired course still gets
// a plan for the other 31 courses, with the gap named. That trades away "requirement coverage
// is true by construction", so the ways it can go wrong all end in a plan that is quietly
// missing something — which is worse than a refusal. These tests are aimed at that.
import test from "node:test";
import assert from "node:assert/strict";
import { generatePlan, isStranded, permissivePorts } from "../../src/engine/index.js";

// ── The cut itself ─────────────────────────────────────────────────

test("stranded › a cell whose candidates run in NO season is stranded", () => {
  assert.equal(isStranded({ reason: "never-offered-in-any-term-this-plan-uses", seasons: [] }), true);
});

test("stranded › a cell whose candidates DO run somewhere is a shape problem, not stranded", () => {
  // The distinction the whole design turns on: a fall-only course in a shape with no free
  // fall term looks identical to a dead one, and only one of those is the catalog's fault.
  // Measured, 8 of 89 blocked cells are this case and they must stay refusals, because a
  // different published variant places them.
  assert.equal(
    isStranded({ reason: "never-offered-in-any-term-this-plan-uses", seasons: ["fall"] }), false);
});

test("stranded › a requirement naming nothing in the catalog is stranded", () => {
  assert.equal(isStranded({ reason: "no-catalog-course-answers-it", seasons: null }), true);
});

test("stranded › a chain longer than the plan is NOT stranded", () => {
  // Dropping it would hide a problem that stretching the shape solves.
  assert.equal(isStranded({ reason: "prereq-chain-longer-than-plan", seasons: [] }), false);
  assert.equal(isStranded({ reason: "coop-prep-cannot-precede-the-coop", seasons: [] }), false);
});

test("stranded › junk does not throw and is not stranded", () => {
  for (const x of [undefined, null, {}, { reason: null }, { seasons: [] }, { reason: 42 }]) {
    assert.equal(isStranded(x), false);
  }
});

// ── End to end ─────────────────────────────────────────────────────

const course = (id, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh, prereqs: [], coreqs: [],
});
const CM = Object.fromEntries(
  ["CS1800", "CS2000", "CS2800", "CS3000", "DEAD9999"].map(id => [id, course(id)]));

const C = (subject, classId) => ({ type: "COURSE", subject, classId });
const SECTION = (title, minRequirementCount, ...requirements) =>
  ({ type: "SECTION", title, minRequirementCount, requirements });

/** Ports where `dead` runs in no season and everything else is unknown, hence allowed. */
const portsWithDead = (dead) => permissivePorts({
  offeringProbability: (id) => (dead.includes(id) ? 0 : null),
  offered: (id) => !dead.includes(id),
  creditMax: () => 19,
  creditMin: () => 12,
});

const run = (sections, dead, extra = {}) => generatePlan({
  program: { totalCreditsRequired: 16, requirementSections: sections, ...extra },
  courseMap: CM, ports: portsWithDead(dead), studentType: "undergraduate",
});

test("stranded › a degree with one dead course still gets a plan", () => {
  const out = run([SECTION("Core", 4,
    C("CS", "1800"), C("CS", "2000"), C("CS", "2800"), C("DEAD", "9999"))], ["DEAD9999"]);
  assert.ok(!out.refused, `refused: ${out.refused?.reason} — ${out.refused?.detail}`);
  assert.ok(out.plan, "a plan was emitted");
});

test("stranded › the dead course is REPORTED, naming the course", () => {
  const out = run([SECTION("Core", 4,
    C("CS", "1800"), C("CS", "2000"), C("CS", "2800"), C("DEAD", "9999"))], ["DEAD9999"]);
  const un = out.report?.unschedulable ?? [];
  assert.equal(un.length, 1, "exactly one requirement could not be scheduled");
  // "a requirement is unavailable" and "DEAD 9999 is no longer offered" are the same fact,
  // and only the second can be acted on.
  assert.deepEqual(un[0].courses, ["DEAD9999"]);
  assert.match(un[0].reason, /never-offered|no-catalog/);
});

test("stranded › the dead course appears NOWHERE in the grid", () => {
  // The failure that matters: a cell dropped from the search but still emitted would be
  // placed in a term whose season does not offer it — a hard availability violation.
  const out = run([SECTION("Core", 4,
    C("CS", "1800"), C("CS", "2000"), C("CS", "2800"), C("DEAD", "9999"))], ["DEAD9999"]);
  const text = JSON.stringify(out.plan);
  assert.ok(!text.includes("DEAD9999"), "the retired course is not in the emitted plan");
});

test("stranded › the surviving courses are all still placed", () => {
  // Dropping one cell must not cost any other. The point of the change is 31 of 32, not 3.
  const out = run([SECTION("Core", 4,
    C("CS", "1800"), C("CS", "2000"), C("CS", "2800"), C("DEAD", "9999"))], ["DEAD9999"]);
  const text = JSON.stringify(out.plan);
  for (const id of ["CS1800", "CS2000", "CS2800"]) {
    assert.ok(text.includes(id), `${id} is still placed`);
  }
});

// ── The edge the change creates ────────────────────────────────────

test("stranded › a degree whose EVERY course is dead REFUSES, not an empty plan", () => {
  // The hole this change opens. `preflight` checks `cells.length`, which counts the cells
  // DERIVED, not the cells that survived stranding — so with every cell dropped the search
  // trivially succeeds on nothing and emits a grid with no courses in it. A plan that
  // silently contains nothing is the worst possible output: it looks authoritative, it
  // passes every hard rule vacuously, and it tells the student their degree is four empty
  // years.
  const out = run([SECTION("Core", 1, C("DEAD", "9999"))], ["DEAD9999"]);
  assert.ok(out.refused, `should refuse, got: ${String(JSON.stringify(out.plan)).slice(0, 200)}`);
});

test("stranded › no dead courses leaves the report's gap list empty", () => {
  // The common path must not acquire a spurious warning.
  const out = run([SECTION("Core", 3,
    C("CS", "1800"), C("CS", "2000"), C("CS", "2800"))], []);
  assert.ok(!out.refused, `refused: ${out.refused?.reason}`);
  assert.deepEqual(out.report.unschedulable, []);
});
