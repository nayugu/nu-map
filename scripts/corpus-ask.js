#!/usr/bin/env node
/**
 * corpus-ask.js — one question against the corpus, in about a second.
 *
 * ── What this replaces ──────────────────────────────────────────────
 *
 * The scripts that actually cost this project time were never the committed ones. They were
 * written inline to answer a single question and deleted afterwards: `verify-attr` for the
 * designation change, and three separate corpus sweeps chasing one empty-term regression.
 * Each swept everything, each took minutes to tens of minutes, and none of them survived to
 * make the next question cheaper.
 *
 * The reason is not that they were ad-hoc. It is that every one of them regenerated the corpus
 * in order to have something to ask a five-line question of. So:
 *
 *   DATA questions need no plans at all, and run in about a second flat:
 *
 *     node scripts/corpus-ask.js --js 'courses.filter(c => c.nuPath?.includes("WD")).length'
 *     node scripts/corpus-ask.js --js 'programs.filter(p => p.data.totalCreditsRequired > 150)
 *                                              .map(p => p.key)'
 *
 *   PLAN questions read a snapshot taken once, and also run in about a second:
 *
 *     node scripts/verify-chart.js --snapshot .cache/corpus.json          # once
 *     node scripts/corpus-ask.js --snapshot .cache/corpus.json \
 *          --js 'positionsOf(plans, "ENGW3302").map(x => x.at)'
 *
 *   AND the before/after that used to need two full sweeps is a file comparison:
 *
 *     node scripts/corpus-ask.js --diff before.json after.json
 *
 * ── The rule this enforces by being convenient ──────────────────────
 *
 * Write the question here, not in a heredoc. If the vocabulary is missing something, add it to
 * `corpus-snapshot.js` — that is the "extend the instrument, do not write another script" rule
 * with somewhere to actually put the extension. Six `*probe*` scripts exist because there
 * wasn't one.
 *
 * ── Staleness is shouted, not whispered ─────────────────────────────
 *
 * A snapshot that predates your change answers confidently about code you no longer have. That
 * is the expensive failure here, so a mismatch in the engine hash, the data hash, or a snapshot
 * taken with a dirty tree prints a banner. It still runs: a stale snapshot is the correct
 * BASELINE for a before/after, and refusing would break the main use.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readSnapshot, planList, plansWith, positionsOf, termsWhere, cellsWhere, diffSnapshots,
} from "./lib/corpus-snapshot.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };

const JS = flag("--js");
const SNAP = flag("--snapshot");
const DIFF = argv.indexOf("--diff");

if (DIFF > -1) {
  const [a, b] = [argv[DIFF + 1], argv[DIFF + 2]];
  if (!a || !b) { console.error("usage: --diff <before.json> <after.json>"); process.exit(2); }
  const d = diffSnapshots(readSnapshot(a, ROOT), readSnapshot(b, ROOT));
  console.log(`unchanged ${d.same}   MOVED ${d.moved.length}   `
    + `gained ${d.gained.length}   lost ${d.lost.length}`);
  for (const m of d.moved.slice(0, 25)) {
    console.log(`\n  ${m.label}`);
    if (m.appeared.length) console.log(`    appeared: ${m.appeared.join(", ")}`);
    if (m.vanished.length) console.log(`    vanished: ${m.vanished.join(", ")}`);
    if (!m.appeared.length && !m.vanished.length) {
      console.log(`    same courses, different ARRANGEMENT`);
    }
  }
  if (d.moved.length > 25) console.log(`\n  … and ${d.moved.length - 25} more`);
  process.exit(0);
}

if (!JS) {
  console.error(`usage: corpus-ask.js --js '<expression>' [--snapshot <file>]
                 corpus-ask.js --diff <before.json> <after.json>

In scope for --js:
  courses    array of catalog courses (id, subject, number, title, nuPath, prereqs, …)
  courseMap  the same, keyed by id
  programs   [{ lvl, college, key, data }] — every program with requirements
  plans      structured plans, [] unless --snapshot is given
  plansWith(plans, id) · positionsOf(plans, id) · termsWhere(plans, fn) · cellsWhere(plans, fn)

The expression's value is printed. Arrays print with a count; long ones are truncated.`);
  process.exit(2);
}

// ── Load only what the question needs ───────────────────────────────
//
// The catalog is 364 ms and the programs about the same, so both are loaded unconditionally —
// the cost is beneath noticing and gating them would only add a flag nobody remembers. Plans
// are the expensive thing and come from a file or not at all.
const { loadCatalog } = await import("../src/adapters/northeastern/courseCatalog.node.js");
const { courseMap } = loadCatalog();
const courses = Object.values(courseMap);

const programs = [];
for (const lvl of ["undergraduate", "graduate"]) {
  const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
  if (!existsSync(base)) continue;
  const { readdirSync, statSync } = await import("node:fs");
  for (const college of readdirSync(base)) {
    const cd = join(base, college);
    if (!statSync(cd).isDirectory()) continue;
    for (const key of readdirSync(cd)) {
      const rf = join(cd, key, "requirements.json");
      if (!existsSync(rf)) continue;
      programs.push({ lvl, college, key, data: JSON.parse(readFileSync(rf, "utf8")) });
    }
  }
}

let plans = [];
if (SNAP) {
  const snap = readSnapshot(SNAP, ROOT);
  plans = planList(snap);
  if (snap.stale) {
    console.error(`\n⚠  STALE SNAPSHOT — ${SNAP}`);
    for (const w of snap.why) console.error(`   • ${w}`);
    console.error(`   taken ${snap.meta?.at} at ${snap.meta?.sha}. Numbers from it describe `
      + `THAT tree, not this one. Fine as a baseline; not fine as a current measurement.\n`);
  }
}

// The expression is evaluated with the vocabulary in scope. This is a developer tool run on a
// developer's own checkout against committed data — the input is the operator's own keystrokes,
// so there is nothing here to sandbox against.
const fn = new Function(
  "courses", "courseMap", "programs", "plans",
  "plansWith", "positionsOf", "termsWhere", "cellsWhere",
  `return (${JS});`);
const value = fn(courses, courseMap, programs, plans,
  plansWith, positionsOf, termsWhere, cellsWhere);

/** Print a count beside an array, because "how many" is the question underneath most of these. */
function show(v) {
  if (Array.isArray(v)) {
    console.log(`${v.length} result${v.length === 1 ? "" : "s"}`);
    for (const x of v.slice(0, 40)) {
      console.log(`  ${typeof x === "object" ? JSON.stringify(x) : x}`);
    }
    if (v.length > 40) console.log(`  … and ${v.length - 40} more`);
    return;
  }
  console.log(typeof v === "object" ? JSON.stringify(v, null, 1) : v);
}
show(value);
