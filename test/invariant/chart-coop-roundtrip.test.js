// INVARIANT · a generated plan's co-ops satisfy the requirements they were
// generated for.
//
// The unit tests beside this pin the two rules on hand-built cells. This runs
// the whole chain on the real program that motivated it:
//
//   requirements.json → deriveCells → withdrawWorkTermCells → emit
//     → applySamplePlan → specialTermPl.courseId → workTermGrants
//       → allocateSections → is the section MET?
//
// Every one of those links can be right on its own and wrong together, and two
// of them were. Before the fix CHART booked COOP 3948 as a Year 4 Fall lecture
// beside four co-op terms. After withdrawing the cell but before carrying the
// registration through, it produced two co-op blocks that registered nothing —
// so the plan no longer told the student to attend a co-op as a class, and also
// no longer satisfied the requirement it was generated to satisfy. Only the end
// of the chain can tell those two apart from a fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
import { generatePlan } from "../../src/engine/index.js";
import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import { workTermGrants } from "../../src/core/specialTermUtils.js";
import { allocateSections } from "../../src/core/gradRequirements.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const IB = join(ROOT, "data/northeastern/programs/undergraduate/2026/business/international_business_bsib_(boston)");

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special", maxSlots: 99 },
  ...Array.from({ length: 7 }, (_, k) => 2026 + k).flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1,   maxSlots: 4 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1,   maxSlots: 4 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5, maxSlots: 2 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5, maxSlots: 2 },
  ]),
];
const SEM_INDEX = Object.fromEntries(SEMESTERS.map((s, i) => [s.id, i]));

const have = existsSync(join(IB, "requirements.json")) && existsSync(join(IB, "plan.json"));
const { courseMap } = have ? loadCatalog() : { courseMap: {} };

function build() {
  const raw = JSON.parse(readFileSync(join(IB, "requirements.json"), "utf8"));
  const program = Array.isArray(raw) ? raw[0] : raw;
  const published = JSON.parse(readFileSync(join(IB, "plan.json"), "utf8")).plans[0];
  const out = generatePlan({
    program, publishedPlan: published, courseMap, ports: enginePorts(courseMap),
    studentType: "undergraduate", timeBudgetMs: 15000,
  });
  assert.ok(!out.refused, `CHART refused International Business: ${JSON.stringify(out.refused)}`);
  const applied = applySamplePlan(out.plan.plans[0], {
    semesters: SEMESTERS, courseMap, programData: program,
  });
  return { program, out, applied };
}

const sectionNamed = (program, needle) =>
  (program.requirementSections ?? []).find(s => (s.title ?? "").includes(needle));

test("chart/coop › the plan never schedules a work-experience course as a class",
  { skip: have ? false : "International Business data not present" }, () => {
  const { out } = build();
  const scheduled = [];
  for (const y of out.plan.plans[0].years) {
    for (const t of y.terms) {
      for (const e of t.entries ?? []) {
        if (e.coop) continue;                       // the marker itself is fine
        const text = String(e.text ?? "");
        // Any cell whose text names a stamped work-experience course. Covers
        // both shapes the defect took: a bare `COOP 3948` cell and a choice
        // cell reading `BUSN 4945 or COOP 3945 or COOP 3946`.
        for (const key of Object.keys(courseMap)) {
          if (!courseMap[key]?.coop) continue;
          const code = `${courseMap[key].subject} ${courseMap[key].number}`;
          if (text.includes(code)) scheduled.push(`${y.label} ${t.term}: ${text}`);
        }
      }
    }
  }
  assert.deepEqual(scheduled.slice(0, 5), [],
    `${scheduled.length} work-experience course(s) scheduled as coursework`);
});

test("chart/coop › the co-op blocks it builds satisfy the forced requirement",
  { skip: have ? false : "International Business data not present" }, () => {
  const { program, applied } = build();

  // Blocks were actually created, or the rest of this proves nothing.
  const blocks = Object.values(applied.specialTermPl);
  assert.ok(blocks.length >= 1, "the applied plan created no work terms at all");

  const registered = blocks.filter(b => b.courseId);
  assert.ok(registered.length >= 1,
    "no co-op registers anything — the plan cannot satisfy the requirement it was built for");
  assert.ok(registered.some(b => b.courseId === "COOP3948"),
    `expected the abroad co-op to be named; got ${registered.map(b => b.courseId).join(", ")}`);

  // The end of the chain: does the audit agree?
  //
  // Allocated ALL SECTIONS AT ONCE, because that is what the Graduation panel
  // does. Both of International Business's experiential sections name COOP
  // 3948 — International requires it, Business lists it among seven — and
  // since `1434dbc5` one course answers every requirement that names it while
  // being credited once. So the single forced registration satisfies both.
  //
  // This test asserted the opposite two hours ago, and was right then: a
  // shared `used` set consumed the key for whichever section was declared
  // first. That rule changed underneath it, deliberately, and IB is the case
  // the change was made for. Worth keeping the history in view — the number
  // that moved was not CHART's.
  const granted = workTermGrants(applied.specialTermPl, specialTerms.getTypes(), SEM_INDEX).planned;
  const sections = program.requirementSections ?? [];
  const results = allocateSections(sections, granted, new Set(), courseMap);
  const satOf = (needle) => {
    const i = sections.findIndex(s => (s.title ?? "").includes(needle));
    assert.ok(i >= 0, `"${needle}" is no longer in the corpus — re-measure`);
    return results[i]?.sat;
  };

  assert.equal(satOf("International Experiential"), true,
    "the generated plan's co-ops do not satisfy International Experiential Learning");
  assert.equal(satOf("Business Experiential"), true,
    "COOP 3948 no longer answers the section that lists it — see gradRequirements' "
    + "one-course-one-requirement rule");

  // What CHART must still NOT do: invent the second registration. Business
  // Experiential accepts four co-op variants differing by abroad and half-time,
  // and choosing one would be deciding the student's term abroad. It is
  // satisfied here as a consequence of the forced COOP 3948, not because
  // anything was picked for them — so exactly ONE block carries a course.
  assert.equal(registered.length, 1,
    `CHART named ${registered.length} registrations; only the forced one is legitimate`);
});

test("chart/coop › reapplying the plan does not add a second registration",
  { skip: have ? false : "International Business data not present" }, () => {
  const { program, applied } = build();
  const raw = JSON.parse(readFileSync(join(IB, "requirements.json"), "utf8"));
  const published = JSON.parse(readFileSync(join(IB, "plan.json"), "utf8")).plans[0];
  const out = generatePlan({
    program: Array.isArray(raw) ? raw[0] : raw, publishedPlan: published, courseMap,
    ports: enginePorts(courseMap), studentType: "undergraduate", timeBudgetMs: 15000,
  });
  const again = applySamplePlan(out.plan.plans[0], {
    semesters: SEMESTERS, courseMap, programData: program,
    placements: applied.placements, reservations: applied.reservations,
    specialTermPl: applied.specialTermPl,
  });
  assert.equal(again.coops.length, 0, "reapplying duplicated the co-ops");
  assert.equal(Object.keys(again.specialTermPl).length,
               Object.keys(applied.specialTermPl).length,
               "reapplying changed the work-term set");
});
