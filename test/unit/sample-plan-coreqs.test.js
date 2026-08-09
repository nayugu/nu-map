// UNIT · a sample plan places corequisites with their course.
//
// A corequisite must be taken in the SAME term, so a plan that places CS 3000
// without CS 3001 hands the student a violation the moment it loads — 218 such
// gaps across the corpus, in 19.9% of plans, 85 of them that one pair.
//
// The justification is consistency, not a new rule: BOTH drag handlers already
// build `coreqPartners` and move them together, so loading a plan was the only
// path that dropped them. These tests pin the completion, and pin harder that
// it never relocates something the student placed themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { applySamplePlan } from "../../src/core/applySamplePlan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];

const co = (subject, number) => ({ subject, number });
const MAP = {
  CS3000: { id: "CS3000", sh: 4, coreqs: [co("CS", "3001")] },
  CS3001: { id: "CS3001", sh: 0, coreqs: [co("CS", "3000")] },   // mutual
  MATH1341: { id: "MATH1341", sh: 4, coreqs: [] },
  LONELY:  { id: "LONELY", sh: 4, coreqs: [co("GONE", "9999")] }, // partner renumbered away
};

const planOf = (...codes) => ({
  label: "T", years: [{ label: "Year 1", terms: [
    { term: "Fall", type: "fall", entries: codes.map(c => ({ text: c, sh: 4, options: [[c]] })) },
  ] }],
});

test("a corequisite lands in the same term as its course", () => {
  const r = applySamplePlan(planOf("CS3000"), { semesters: SEMESTERS, courseMap: MAP });
  assert.equal(r.placements.CS3000, "fall2026");
  assert.equal(r.placements.CS3001, "fall2026", "the recitation was not placed");
  assert.ok(r.notes.some(n => n.kind === "coreq-added" && n.code === "CS3001"),
    "the completion was not reported");
});

test("mutual corequisites do not duplicate or loop", () => {
  const r = applySamplePlan(planOf("CS3000", "CS3001"), { semesters: SEMESTERS, courseMap: MAP });
  assert.equal(Object.keys(r.placements).length, 2, `expected 2 placements, got ${JSON.stringify(r.placements)}`);
  assert.equal(r.placed.filter(x => x === "CS3001").length, 1, "placed twice");
});

test("a partner the student ALREADY placed is left where it is", () => {
  // The rule completes the plan; it does not relocate their work.
  const r = applySamplePlan(planOf("CS3000"), {
    semesters: SEMESTERS, courseMap: MAP,
    placements: { CS3001: "spr2029" },
  });
  assert.equal(r.placements.CS3001, "spr2029", "a student's own placement was moved");
  assert.ok(!r.notes.some(n => n.kind === "coreq-added" && n.code === "CS3001"));
});

test("a partner the catalog no longer has is skipped, not invented", () => {
  const r = applySamplePlan(planOf("LONELY"), { semesters: SEMESTERS, courseMap: MAP });
  assert.ok(!("GONE9999" in r.placements), "placed a course the catalog does not have");
  assert.equal(r.placements.LONELY, "fall2026");
});

test("a course with no corequisites is untouched", () => {
  const r = applySamplePlan(planOf("MATH1341"), { semesters: SEMESTERS, courseMap: MAP });
  assert.deepEqual(Object.keys(r.placements), ["MATH1341"]);
});

test("malformed coreq entries do not throw", () => {
  const map = { ...MAP, WEIRD: { id: "WEIRD", sh: 4, coreqs: [null, "text", {}, { subject: "CS" }] } };
  let r;
  assert.doesNotThrow(() => { r = applySamplePlan(planOf("WEIRD"), { semesters: SEMESTERS, courseMap: map }); });
  assert.equal(Object.keys(r.placements).length, 1);
});

test("re-applying adds no second copy", () => {
  const once = applySamplePlan(planOf("CS3000"), { semesters: SEMESTERS, courseMap: MAP });
  const twice = applySamplePlan(planOf("CS3000"), {
    semesters: SEMESTERS, courseMap: MAP,
    placements: once.placements, reservations: once.reservations,
  });
  assert.deepEqual(twice.placements, once.placements, "re-applying moved or duplicated something");
  assert.equal(twice.placed.length, 0);
});

// ── The corpus, which is where the 218 gaps were counted ───────────

test("REAL: loading a shipped plan leaves no corequisite unplaced", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courseMap = {};
  for (const c of raw) {
    const id = `${c.subject}${parseInt(c.number, 10)}`;
    courseMap[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)),
                      sh: c.credits ?? 0, coreqs: c.coreqs ?? [] };
  }
  const partnersOf = (id) => (courseMap[id]?.coreqs ?? [])
    .filter(r => r && typeof r === "object" && r.subject)
    .map(r => `${r.subject}${parseInt(r.number, 10)}`);

  let plans = 0, gaps = 0, added = 0;
  const base = join(ROOT, "data/northeastern/programs/majors/2026");
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs.slice(0, 14)) {
      const f = join(base, college, prog, "plan.json");
      if (!existsSync(f)) continue;
      for (const plan of JSON.parse(readFileSync(f, "utf8")).plans ?? []) {
        const r = applySamplePlan(plan, { semesters: SEMESTERS, courseMap });
        plans += 1;
        added += r.notes.filter(n => n.kind === "coreq-added").length;
        for (const [id, sem] of Object.entries(r.placements)) {
          for (const partner of partnersOf(id)) {
            if (!courseMap[partner]) continue;
            if (r.placements[partner] !== sem) {
              gaps += 1;
              assert.fail(`${prog}: ${id} is in ${sem} but its coreq ${partner} is in ${r.placements[partner] ?? "nowhere"}`);
            }
          }
        }
      }
    }
  }
  assert.ok(plans > 80, `only ${plans} plans exercised`);
  assert.ok(added > 0, "no plan needed a coreq completing — the fixture is not exercising this");
  assert.equal(gaps, 0);
});
