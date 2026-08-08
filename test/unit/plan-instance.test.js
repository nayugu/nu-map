// UNIT · a loaded sample plan, held as a reference and derived.
//
// The properties that matter are the ones the previous design got wrong:
// applying twice changes nothing, deleting a course brings its reservation
// back with no bookkeeping, and no consequential state is keyed by a position
// that drifts between catalog editions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenPlan, positionEntries, resolveAnswers, surplusOf, summarize,
  academicYears, entryId, isReservation,
} from "../../src/core/planInstance.js";

/** Four academic years in NU's shape, matching src/core/semGrid.js output. */
const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029].flatMap(y => [
    { id: `fall${y}`,    semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`, semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",  type: "summer", weight: 0.5 },
  ]),
];

const named = (...codes) => ({ options: [codes], text: codes.join(" and "), sh: 4 });
const choice = (...groups) => ({ options: groups, text: "a or b", sh: 4 });
const slot = (text, targets = []) => ({
  options: [], text, sh: 4, ...(targets.length ? { binding: { targets } } : {}),
});

const GRID = {
  plans: [
    {
      label: "Four Years, Two Co-ops in Spring/Summer First Half",
      years: [
        { label: "Year 1", terms: [
          { term: "Fall", type: "fall", hours: 12, entries: [
            named("CS1200"), named("CS1800", "CS1802"), slot("General Elective", ["~general"]),
          ] },
          { term: "Spring", type: "spring", hours: 8, entries: [
            choice(["CS4530"], ["CS4535"]), slot("Khoury Elective", [1]),
          ] },
        ] },
        { label: "Year 2", terms: [
          { term: "Fall", type: "fall", hours: 8, entries: [
            slot("Khoury Elective", [1]), { coop: true, options: [], text: "Co-op" },
          ] },
        ] },
      ],
    },
    { label: "Five Years, Three Co-ops", years: [
      { label: "Year 1", terms: [{ term: "Fall", type: "fall", hours: 4, entries: [named("CS2500")] }] },
    ] },
  ],
};

const flat = (label) => flattenPlan(GRID, label);
const place = (...ids) => Object.fromEntries(ids.map(i => [i, "fall2026"]));

// ── Flattening ─────────────────────────────────────────────────────

test("a plan flattens in plan order, which is a total order", () => {
  const f = flat();
  assert.deepEqual(f.map(e => e.entry.text),
    ["CS1200", "CS1800 and CS1802", "General Elective", "a or b", "Khoury Elective",
     "Khoury Elective", "Co-op"]);
});

test("the published variant is chosen by label, not by position", () => {
  assert.equal(flat("Five Years, Three Co-ops").length, 1);
  assert.equal(flat("Five Years, Three Co-ops")[0].entry.text, "CS2500");
  // A label that no longer exists falls back to the first plan rather than
  // yielding nothing — the catalog reworded it, the student still has a plan.
  assert.equal(flat("Renamed By The Department").length, flat().length);
});

test("entry ids are positional, and identical across two flattenings", () => {
  assert.deepEqual(flat().map(e => e.id), flat().map(e => e.id));
  assert.equal(flat()[0].id, entryId(0, 0, "fall", 0));
  // Two "Khoury Elective" cells in different terms are distinct entries.
  const khoury = flat().filter(e => e.entry.text === "Khoury Elective");
  assert.equal(new Set(khoury.map(e => e.id)).size, 2);
});

test("a nested grid keeps its children in the term they belong to", () => {
  const grid = { plans: [{ label: "P", years: [{ label: "Year 1", terms: [
    { term: "Fall", type: "fall", entries: [
      { heading: true, options: [], text: "Complete one of:", children: [named("PMST6254"), named("PMCL6250")] },
    ] },
  ] }] }] };
  const f = flattenPlan(grid);
  assert.deepEqual(f.map(e => e.entry.text), ["Complete one of:", "PMST6254", "PMCL6250"]);
  assert.ok(f.every(e => e.termType === "fall"));
});

// ── Positioning ────────────────────────────────────────────────────

test("years map onto the student's timeline, cohort-relative", () => {
  assert.equal(academicYears(SEMESTERS).length, 4);
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  assert.equal(p[0].semId, "fall2026");
  assert.equal(p[3].semId, "spr2027");
  assert.equal(p[5].semId, "fall2027", "Year 2 lands a year later");

  const later = positionEntries(flat(), { semesters: SEMESTERS, startYearIndex: 1 });
  assert.equal(later[0].semId, "fall2027");
});

test("a plan running past the timeline is reported, not truncated", () => {
  const short = SEMESTERS.slice(0, 2);
  const p = positionEntries(flat(), { semesters: short });
  assert.ok(p.some(e => e.outsideTimeline), "a five-year plan on a shorter cohort says so");
  assert.ok(p.every(e => e.id), "and every entry still exists");
});

test("a student's move or deletion beats the published position", () => {
  const f = flat();
  const p = positionEntries(f, {
    semesters: SEMESTERS,
    planEdits: { [f[0].id]: { semId: "spr2027" }, [f[2].id]: { deleted: true } },
  });
  assert.equal(p[0].semId, "spr2027");
  assert.equal(p[2].deleted, true);
});

// ── Answered-ness, derived ─────────────────────────────────────────

test("a named entry is answered when one option GROUP is fully placed", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  const { answered } = resolveAnswers(p, { placements: place("CS1200", "CS1800") });
  assert.ok(answered.has(p[0].id), "CS1200 placed");
  assert.ok(!answered.has(p[1].id), "CS1800 alone does not answer CS1800 AND CS1802");

  const both = resolveAnswers(p, { placements: place("CS1800", "CS1802") });
  assert.ok(both.answered.has(p[1].id));
});

test("a choice is answered by either group, never by half of one", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  assert.ok(resolveAnswers(p, { placements: place("CS4530") }).answered.has(p[3].id));
  assert.ok(resolveAnswers(p, { placements: place("CS4535") }).answered.has(p[3].id));
  assert.ok(!resolveAnswers(p, { placements: {} }).answered.has(p[3].id));
});

test("a repeat instance still counts as holding the course", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  const { answered } = resolveAnswers(p, { placements: { "CS1200#2": "fall2026" } });
  assert.ok(answered.has(p[0].id));
});

test("reservations retire earliest-first, so the plan does not churn", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  const khoury = p.filter(e => e.entry.text === "Khoury Elective");
  // One Khoury course placed: exactly one reservation retires, and always the
  // earlier one. Ambiguity here would make the plan reshuffle between renders.
  const { answered } = resolveAnswers(p, { surplus: new Map([[1, 1]]) });
  assert.ok(answered.has(khoury[0].id));
  assert.ok(!answered.has(khoury[1].id));

  const two = resolveAnswers(p, { surplus: new Map([[1, 2]]) });
  assert.ok(two.answered.has(khoury[0].id) && two.answered.has(khoury[1].id));
});

test("deleting a course brings its reservation back, with no bookkeeping", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  const withCourse = resolveAnswers(p, { surplus: new Map([[1, 1]]) });
  const without = resolveAnswers(p, { surplus: new Map() });
  assert.equal(withCourse.open.length + 1, without.open.length,
    "the reservation returns purely because the derivation changed");
});

test("a deleted entry answers nothing and is never open", () => {
  const f = flat();
  const p = positionEntries(f, { semesters: SEMESTERS, planEdits: { [f[2].id]: { deleted: true } } });
  const { answered, open } = resolveAnswers(p, { surplus: new Map([["~general", 5]]) });
  assert.ok(!answered.has(f[2].id));
  assert.ok(!open.some(e => e.id === f[2].id));
});

test("co-ops and headings are not reservations", () => {
  assert.equal(isReservation({ options: [], text: "Khoury Elective" }), true);
  assert.equal(isReservation({ options: [], coop: true }), false);
  assert.equal(isReservation({ options: [], heading: true }), false);
  assert.equal(isReservation({ options: [], vacation: true }), false);
  assert.equal(isReservation({ options: [], either: ["coop", "vacation"] }), false);
  assert.equal(isReservation(named("CS1200")), false);
});

// ── Idempotency, which the previous design had to engineer ─────────

test("deriving twice from the same reference is identical", () => {
  const once = positionEntries(flat(), { semesters: SEMESTERS });
  const twice = positionEntries(flat(), { semesters: SEMESTERS });
  assert.deepEqual(once.map(e => `${e.id}@${e.semId}`), twice.map(e => `${e.id}@${e.semId}`));
  // Applying a plan sets a reference, so "applying twice" IS this — there is
  // no de-duplication step that could get it wrong.
});

// ── Surplus ────────────────────────────────────────────────────────

test("surplus counts whole courses beyond what the plan itself supplies", () => {
  const now = new Map([[1, 12], ["~general", 4]]);
  const byPlan = new Map([[1, 4], ["~general", 4]]);
  const unit = new Map([[1, 4]]);
  assert.deepEqual([...surplusOf(now, byPlan, unit)], [[1, 2]],
    "8 SH beyond the plan's own = two reservations retire; general gained nothing");
});

test("surplus never goes negative when a course is removed", () => {
  assert.deepEqual([...surplusOf(new Map([[1, 0]]), new Map([[1, 8]]), new Map([[1, 4]]))], []);
});

// ── Summary ────────────────────────────────────────────────────────

test("the summary counts the same derivation the planner would draw", () => {
  const p = positionEntries(flat(), { semesters: SEMESTERS });
  const { answered } = resolveAnswers(p, { placements: place("CS1200") });
  const s = summarize(p, answered);
  assert.equal(s.entries, 7);
  assert.equal(s.reservations, 3);
  assert.equal(s.coops, 1);
  assert.equal(s.answered, 1);
});
