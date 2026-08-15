#!/usr/bin/env node
/**
 * coop-chart-probe.js — how CHART treats work-experience requirements.
 *
 * The question this answers, in one run over the whole corpus: a work-experience
 * course is RECORDED BY a co-op block, not taken as a class, but `deriveCells`
 * has no idea and emits it as a cell to schedule. So CHART puts `COOP 3948` in a
 * Fall term as coursework, beside the co-op terms the shape already carries.
 *
 *   node scripts/coop-chart-probe.js            # corpus summary
 *   node scripts/coop-chart-probe.js --list     # every affected program
 *
 * Reports, per program:
 *   coopCells  cells whose every option is a work-experience registration
 *   mixedCells cells offering BOTH a registration and a real course
 *   workTerms  co-op terms the published shape already carries
 *
 * A program with coopCells > 0 and workTerms > 0 is the clean defect: the plan
 * both employs the student and schedules the registration as a class.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import { deriveCells, withdrawWorkTermCells } from "../src/engine/demand.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import { shapeFromPlan } from "../src/engine/shape.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LIST = process.argv.includes("--list");

const { courseMap } = await loadCatalog();

/** Every requirements.json under the program tree, with its sibling plan.json. */
function programs() {
  const out = [];
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (e !== "requirements.json") continue;
      let req; try { req = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      const planPath = join(dir, "plan.json");
      let plan = null;
      if (existsSync(planPath)) { try { plan = JSON.parse(readFileSync(planPath, "utf8")); } catch {} }
      for (const prog of (Array.isArray(req) ? req : [req])) {
        if (prog?.name) out.push({ prog, plan, dir: p.replace(ROOT + "/", "") });
      }
    }
  };
  walk(join(ROOT, "data/northeastern/programs"));
  return out;
}

// The real port, from the NU adapter — not a local re-reading of the stamp.
const { workExperience } = enginePorts(courseMap);
const isWorkCourse = (key) => !!workExperience(key);
/** A cell's option groups, flattened to course keys. */
const keysOf = (cell) => (cell.groups ?? []).flat().filter(Boolean);

let allCoop = 0, mixed = 0, affected = 0, affectedWithWork = 0, scanned = 0;
// Which treatment each affected program needs. A program with no published plan
// has a DERIVED shape carrying no co-op at all — there is no evidence it has
// one — so "satisfied by the work term" has nothing to point at, and the answer
// there is a different one from the clean case.
const buckets = { "plan+coop": 0, "plan, no coop": 0, "no published plan": 0 };
const rows = [];
let withdrawnSH = 0;
const overCharged = [];

for (const { prog, plan } of programs()) {
  let cells;
  try { ({ cells } = deriveCells(prog, { courseMap })); } catch { continue; }
  scanned++;
  let a = 0, m = 0;
  const examples = [];
  for (const c of cells) {
    const keys = keysOf(c);
    if (!keys.length) continue;
    const work = keys.filter(isWorkCourse).length;
    if (work === 0) continue;
    if (work === keys.length) { a++; examples.push(`ALL:${keys.slice(0, 3).join("/")}`); }
    else { m++; examples.push(`MIX:${keys.slice(0, 4).join("/")}`); }
  }
  if (!a && !m) continue;
  // Work terms the department's own plan carries, across every variant.
  const workTerms = (plan?.plans ?? []).reduce((n, v) => {
    const s = shapeFromPlan(v);
    return Math.max(n, s.terms.filter(t => t.coop || t.work).length);
  }, 0);
  const published = !!(plan?.plans ?? []).length;
  // Run the real withdrawal, so the numbers below come from the shipped
  // function rather than from this script's own idea of it.
  // Through the same port the engine uses, so this probe cannot answer a
  // question the engine would answer differently.
  const { withdrawn } = withdrawWorkTermCells(cells, workExperience, workTerms > 0);
  for (const w of withdrawn) {
    if (w.sh > 0) { withdrawnSH += w.sh; overCharged.push(`${prog.name}:${w.keys[0]}=${w.sh}SH`); }
  }
  allCoop += a; mixed += m; affected++;
  if (workTerms > 0) affectedWithWork++;
  buckets[published ? (workTerms > 0 ? "plan+coop" : "plan, no coop") : "no published plan"]++;
  rows.push({ name: prog.name, a, m, workTerms, published, examples });
}

rows.sort((x, y) => (y.a + y.m) - (x.a + x.m) || x.name.localeCompare(y.name));

console.log(`scanned ${scanned} programs\n`);
console.log(`programs emitting a work-experience cell : ${affected}`);
console.log(`  …whose own plan ALSO carries co-op terms: ${affectedWithWork}  ← the clean defect`);
console.log(`cells whose every option is a registration: ${allCoop}`);
console.log(`cells mixing a registration with a course : ${mixed}`);
// The claim withdrawal rests on: these cells are charged 0 SH, so taking them
// out of the schedule moves no credit and the general electives do not shift.
// If this is ever non-zero the fix is under-crediting degrees, which is the one
// failure `demand.js`'s cheapest-option rule exists to prevent.
console.log(`\ncredit carried by withdrawn cells (MUST be 0): ${withdrawnSH} SH`
  + (withdrawnSH ? `  ← ${overCharged.join(", ")}` : ""));
console.log(`\nby what the department publishes:`);
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}`);

if (LIST) {
  console.log(`\n${"program".padEnd(58)} all mix work  examples`);
  for (const r of rows) {
    console.log(`${r.name.slice(0, 57).padEnd(58)} ${String(r.a).padStart(3)} ${String(r.m).padStart(3)} ${String(r.workTerms).padStart(4)}  ${r.examples.slice(0, 2).join("  ")}`);
  }
} else {
  console.log(`\ntop 12 by cell count (--list for all ${rows.length}):`);
  console.log(`${"program".padEnd(58)} all mix work`);
  for (const r of rows.slice(0, 12)) {
    console.log(`${r.name.slice(0, 57).padEnd(58)} ${String(r.a).padStart(3)} ${String(r.m).padStart(3)} ${String(r.workTerms).padStart(4)}`);
  }
}
