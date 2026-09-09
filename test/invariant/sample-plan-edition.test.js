// INVARIANT · a sample plan is never shown for requirements that are not on screen.
//
// `test/unit/plan-key.test.js` proves the RULE on hand-built maps. This proves
// the CONSEQUENCE on the real tree — every program, every edition, every saved
// path a student could still be holding — because "the rule is right" and "no
// program in the corpus is served the wrong year" are different claims, and only
// the second is the one that matters to a student.
//
// It reads the directories rather than importing the loader, for the reason that
// keeps coming up in this repo: `samplePlanLoader` is a Vite `import.meta.glob`
// module and cannot be imported under Node at all. The maps built here are the
// same key space those globs produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planKeyFor, resolveInMap, parseMajorPathParts } from "../../src/data/programPaths.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PREFIX = "../../data/northeastern/programs";

/** The key space of the two globs, per tree, as {programs, plans}. */
function mapsFor(tree) {
  const programs = {}, plans = {};
  const base = join(ROOT, "data/northeastern/programs", tree);
  if (!existsSync(base)) return { programs, plans, years: [] };
  const years = readdirSync(base).filter(d => /^\d{4}$/.test(d)).sort();
  for (const y of years) {
    for (const col of readdirSync(join(base, y))) {
      const cd = join(base, y, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const f of readdirSync(cd)) {
        if (!existsSync(join(cd, f, "requirements.json"))) continue;
        programs[`${PREFIX}/${tree}/${y}/${col}/${f}/requirements.json`] = () => {};
        if (existsSync(join(cd, f, "plan.json"))) {
          plans[`${PREFIX}/${tree}/${y}/${col}/${f}/plan.json`] = () => {};
        }
      }
    }
  }
  return { programs, plans, years: years.map(Number) };
}

const TREES = ["undergraduate", "graduate"];
const yearOf = (p) => Number(String(p).match(/\/(\d{4})\//)?.[1]);

test("no program in the corpus is served another edition's sample plan", () => {
  let checked = 0, withPlan = 0;
  for (const tree of TREES) {
    const { programs, plans } = mapsFor(tree);
    for (const path of Object.keys(programs)) {
      const key = planKeyFor(plans, programs, path);
      checked++;
      if (key === null) continue;
      withPlan++;
      // The plan we answer with must sit beside the requirements that would
      // actually load — which for an exact path is that path's own year.
      const resolved = resolveInMap(programs, path, parseMajorPathParts);
      assert.equal(yearOf(key), yearOf(resolved),
        `${path}\n  → plan ${yearOf(key)} but requirements ${yearOf(resolved)}`);
      assert.ok(key in plans, `${key} is not a real plan`);
      // ...and it must be the SAME PROGRAM, not a namesake in another college.
      const a = parseMajorPathParts(key), b = parseMajorPathParts(resolved);
      assert.equal(a.college, b.college, `${path} borrowed a plan from another college`);
      assert.equal(a.folder,  b.folder,  `${path} borrowed another program's plan`);
    }
  }
  // A corpus test that silently stopped reading the tree would pass with zero
  // assertions, so both counts are pinned as facts rather than left implicit.
  assert.ok(checked > 1500, `only ${checked} programs read — the tree did not load`);
  assert.ok(withPlan > 300, `only ${withPlan} plans found — the plan glob did not load`);
});

test("a saved path from an edition we no longer hold follows its requirements", () => {
  // The returning student, over the whole corpus rather than one program. Their
  // path names a year that is gone; whatever `loadMajor` resolves it to, the
  // plan must be that record's own or nothing. This is the case the old code got
  // wrong in the other direction, and it is unreachable from the option lists —
  // only a saved plan or a share link can produce it.
  const GONE = 2019;
  for (const tree of TREES) {
    const { programs, plans } = mapsFor(tree);
    let seen = 0;
    for (const path of Object.keys(programs)) {
      const stale = path.replace(/\/\d{4}\//, `/${GONE}/`);
      const key = planKeyFor(plans, programs, stale);
      if (key === null) continue;
      seen++;
      const resolved = resolveInMap(programs, stale, parseMajorPathParts);
      assert.equal(yearOf(key), yearOf(resolved),
        `${stale}\n  → plan ${yearOf(key)} but requirements ${yearOf(resolved)}`);
    }
    // Not asserted as a count: whether ANY stale path lands on a year that holds
    // a plan depends on which editions are held, and pinning it would make this
    // test fail on the next roll for no defect. `seen` is reported by the
    // assertions above or not at all.
    void seen;
  }
});

test("every plan we hold is reachable by its own program's path", () => {
  // The other direction, and the one a one-way check cannot see: a plan that no
  // path resolves to is a plan we ship and never show. It would be invisible in
  // every test above, all of which start from programs.
  for (const tree of TREES) {
    const { programs, plans } = mapsFor(tree);
    for (const planPath of Object.keys(plans)) {
      const progPath = planPath.replace(/plan\.json$/, "requirements.json");
      assert.ok(progPath in programs, `${planPath} has no requirements beside it`);
      assert.equal(planKeyFor(plans, programs, progPath), planPath,
        `${planPath} is shipped but unreachable from its own program`);
    }
  }
});
