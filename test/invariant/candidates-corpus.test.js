// INVARIANT · candidates built from the real corpus, for every shipped plan.
//
// The unit suites exercise the algebra and the framework on fixtures. This runs
// the actual path — plan.json → applySamplePlan → reservations →
// candidatesForReservation — across every program that ships a plan, and
// asserts the properties a UI would rely on.
//
// The one that matters most: a card must never read as "nothing can go here"
// unless that is provable. 44% of cells admit any course and 1.2% bind to a
// requirement the plan already satisfied, so the failure mode is a false
// warning on a card the student can answer freely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import { specForNode } from "../../src/core/programEligibility.js";
import {
  candidatesForReservation, courseIds, courseSpec, answerGroups,
  isUnbounded, isSpare, isImpossible, forcedRequirement, narrow,
} from "../../src/core/candidates.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSE_MAP = {};
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)), sh: c.credits ?? 0 };
}

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029, 2030].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];

/** Every program shipping both a plan and parsed requirements. */
function corpus(limit = Infinity) {
  const out = [];
  for (const root of ["data/northeastern/programs/majors/2026", "data/northeastern/programs/grad-majors/2026"]) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const college of readdirSync(base)) {
      let progs = [];
      try { progs = readdirSync(join(base, college)); } catch { continue; }
      for (const prog of progs) {
        const planFile = join(base, college, prog, "plan.json");
        const reqFile = join(base, college, prog, "parsed.initial.json");
        if (!existsSync(planFile) || !existsSync(reqFile)) continue;
        try {
          out.push({
            name: prog,
            grid: JSON.parse(readFileSync(planFile, "utf8")),
            program: JSON.parse(readFileSync(reqFile, "utf8")),
          });
        } catch { /* a malformed file is the scrape's problem, not this test's */ }
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
const CORPUS = corpus();

test("the corpus is present", () => {
  assert.ok(CORPUS.length > 300, `only ${CORPUS.length} programs with a plan AND requirements`);
});

test("every reservation in every shipped plan yields usable candidates", () => {
  let cards = 0, unbounded = 0, bounded = 0, grouped = 0, forced = 0, impossible = 0;
  const impossibleEx = [];

  for (const { name, grid, program } of CORPUS) {
    const sections = program.requirementSections ?? [];
    const specOf = (t) => (typeof t === "number" ? specForNode(sections[t]) : null);
    const ctx = { specOf, courseMap: COURSE_MAP };

    for (const plan of grid.plans ?? []) {
      const applied = applySamplePlan(plan, {
        semesters: SEMESTERS, courseMap: COURSE_MAP, programData: program,
      });
      for (const r of Object.values(applied.reservations)) {
        cards += 1;
        const c = candidatesForReservation(r, { programData: program });

        // Nothing may throw, and every accessor must agree with the others.
        const ids = courseIds(c, ctx);
        const spec = courseSpec(c, ctx);
        const groups = answerGroups(c, ctx);

        if (isUnbounded(c, ctx)) {
          unbounded += 1;
          assert.equal(spec, null, `${name}: an unbounded card returned a spec`);
          assert.ok(ids.size > 7000, `${name}: an unbounded card offered only ${ids.size} courses`);
        } else {
          bounded += 1;
          assert.ok(spec, `${name}: a bounded card returned no spec`);
        }

        if (groups) {
          grouped += 1;
          // Every offered course belongs to some surviving group, and no group
          // names a course we do not have.
          const fromGroups = new Set(groups.flat());
          for (const id of ids) {
            assert.ok(fromGroups.has(id), `${name}: ${id} offered but in no surviving group`);
          }
          for (const g of groups) {
            for (const id of g) assert.ok(COURSE_MAP[id], `${name}: group names unknown ${id}`);
          }
        }

        if (forcedRequirement(c) != null) forced += 1;

        // A fresh card has ruled nothing out, so it can never be spare.
        assert.ok(!isSpare(c), `${name}: a freshly built card reported spare`);

        if (isImpossible(c, ctx)) {
          impossible += 1;
          if (impossibleEx.length < 10) {
            impossibleEx.push(`${name}: "${r.label}" opts=${JSON.stringify(r.options ?? null)} req=${JSON.stringify(r.requirement ?? null)}`);
          }
        }
      }
    }
  }

  assert.ok(cards > 5000, `only ${cards} reservations built across the corpus`);
  assert.ok(unbounded > 0 && bounded > 0, `degenerate split: ${unbounded} unbounded / ${bounded} bounded`);
  assert.ok(grouped > 500, `only ${grouped} grouped cards — options are not reaching candidates`);

  // A card that can never be answered is a data problem, and it must be RARE
  // and explainable. A false "nothing fits" on a card the student can answer
  // freely is the worst outcome this module can produce.
  const rate = impossible / cards;
  assert.ok(rate < 0.01,
    `${impossible} of ${cards} cards (${(rate * 100).toFixed(2)}%) are impossible:\n  ${impossibleEx.join("\n  ")}`);
});

test("narrowing a real card never grows it, and never empties a grouped one silently", () => {
  let checked = 0;
  for (const { name, grid, program } of CORPUS.slice(0, 80)) {
    const sections = program.requirementSections ?? [];
    const specOf = (t) => (typeof t === "number" ? specForNode(sections[t]) : null);
    const ctx = { specOf, courseMap: COURSE_MAP };

    for (const plan of (grid.plans ?? []).slice(0, 1)) {
      const applied = applySamplePlan(plan, {
        semesters: SEMESTERS, courseMap: COURSE_MAP, programData: program,
      });
      for (const r of Object.values(applied.reservations)) {
        const c = candidatesForReservation(r, { programData: program });
        const before = courseIds(c, ctx);
        if (before.size === 0 || before.size > 400) continue;   // skip unbounded/empty
        checked += 1;

        // Remove one real candidate; nothing else may change.
        const [victim] = [...before];
        const after = narrow(c, { courses: [victim], reason: "test" });
        const now = courseIds(after, ctx);
        for (const id of now) assert.ok(before.has(id), `${name}: ${id} appeared after a removal`);
        assert.ok(!now.has(victim), `${name}: ${victim} survived its own removal`);

        // For a grouped card, killing a course kills exactly the groups
        // containing it — never more, never fewer.
        const gBefore = answerGroups(c, ctx);
        if (gBefore) {
          const gAfter = answerGroups(after, ctx);
          const expected = gBefore.filter(g => !g.includes(victim));
          assert.deepEqual(gAfter, expected, `${name}: group survival is wrong after removing ${victim}`);
        }
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} cards exercised`);
});
