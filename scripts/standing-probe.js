#!/usr/bin/env node
/**
 * standing-probe.js — does CHART place class-standing-gated courses where the
 * student will actually have the credits?
 *
 * The gate is Banner's: "Must be enrolled in one of the following Classes: Junior
 * (JR), Senior(SR)". The registrar sets standing by EARNED semester hours —
 * 32 sophomore, 64 junior, 96 senior — and "earned" excludes the term being
 * registered for. So this asks the only question that matters end to end: for
 * every gated course in a generated plan, had the plan accumulated enough credit
 * BEFORE that course's term?
 *
 * ── Why a probe and not a unit test ─────────────────────────────────
 *
 * The unit tests pin the arithmetic. They cannot tell us whether the generator's
 * ORDERING preference is strong enough to actually satisfy the rule on real
 * degrees, because that depends on capacity pressure from every other constraint.
 * Measured, not assumed — and the answer decides whether the preference needs
 * promoting to a constraint.
 *
 * Usage:
 *   node scripts/standing-probe.js                    # a default spread of degrees
 *   node scripts/standing-probe.js --all              # every undergraduate degree (slow)
 *   node scripts/standing-probe.js ug/computer_science_bscs_'(boston)'
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/engine/index.js";
import { buildDepthIndex, cellStanding } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { earnedSHBefore, meetsStanding, requiredSHFor, standingAtSH, STANDING_LADDER }
  from "../src/core/classStanding.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const named = args.filter(a => !a.startsWith("--"));

const DEFAULTS = [
  "computer_science_bscs_(boston)",
  "mechanical_engineering_bsme_(boston)",
  "biology_bs_(boston)",
  "english_ba_(boston)",
  "business_administration_bsba_(boston)",
  "electrical_engineering_bsee_(boston)",
  "psychology_bs_(boston)",
  "civil_engineering_bsce_(boston)",
];

const { courseMap } = await loadCatalog();
const ports = enginePorts(courseMap);
const depthIndex = buildDepthIndex(courseMap);

// Which courses carry a gate at all, so the summary can say what share of the
// gated catalog each run actually exercised.
const gatedCatalog = Object.values(courseMap)
  .filter(c => STANDING_LADDER.includes(c?.offering?.std)).length;

const base = join(ROOT, "data/northeastern/programs/undergraduate/2026");
const targets = [];
for (const col of readdirSync(base)) {
  for (const key of readdirSync(join(base, col))) {
    if (!existsSync(join(base, col, key, "requirements.json"))) continue;
    if (!wantAll && !(named.length ? named : DEFAULTS).some(n => key === n || `ug/${key}` === n)) continue;
    targets.push([col, key]);
  }
}

let plans = 0, refused = 0, gatedCells = 0, violations = 0;
const perCourse = new Map();          // courseId → worst shortfall seen
const rows = [];

for (const [col, key] of targets) {
  const data = JSON.parse(readFileSync(join(base, col, key, "requirements.json"), "utf8"));
  const pf = join(base, col, key, "plan.json");
  const doc = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null;
  const pub = (doc?.plans ?? [])[0] ?? null;

  let r;
  try {
    r = generatePlan({
      program: data, publishedPlan: pub, courseMap, ports, depthIndex,
      calibration: chartCalibration, timeBudgetMs: 8000,
    });
  } catch (e) { refused++; continue; }
  if (r.refused) { refused++; continue; }
  plans++;

  // Flatten the emitted plan into ordered terms, then credits per term index.
  // `entries[].sh` is the emitted credit for the cell — authoritative even for an
  // undecided cell, where no single courseId exists to look up.
  const terms = [];
  for (const y of r.plan.plans[0].years ?? []) for (const t of y.terms ?? []) terms.push(t);
  const shByTerm = terms.map(t =>
    (t.entries ?? []).reduce((s, e) => s + (Number.isFinite(e.sh) ? e.sh : 0), 0));

  let localViol = 0, localGated = 0;
  terms.forEach((t, ti) => {
    for (const e of t.entries ?? []) {
      // Same combination the generator uses: an entry's `options` is an OR of
      // AND-groups, so an undecided cell counts as gated only when EVERY option
      // is gated. Reusing cellStanding rather than restating it is the point —
      // a probe that computes the requirement differently from the engine would
      // measure its own opinion.
      const req = cellStanding({ cell: { groups: e.options ?? [] } }, courseMap);
      if (!STANDING_LADDER.includes(req)) continue;
      localGated++;
      const earned = earnedSHBefore(ti, shByTerm, 0);
      if (!meetsStanding(earned, req)) {
        localViol++;
        const short = requiredSHFor(req) - earned;
        const label = e.text ?? (e.options?.[0]?.join("+") ?? "?");
        const prev = perCourse.get(label);
        if (!prev || short > prev.short) perCourse.set(label, { req, earned, short, term: ti, key });
      }
    }
  });
  gatedCells += localGated;
  violations += localViol;
  rows.push({ key, terms: terms.length, gated: localGated, viol: localViol,
              totalSH: shByTerm.reduce((a, b) => a + b, 0) });
}

console.log(`\ncatalog: ${gatedCatalog} courses carry a class-standing gate`);
console.log(`plans generated ${plans}   refused ${refused}\n`);
console.log(`${"program".padEnd(42)} terms  totalSH  gated  early`);
for (const r of rows.sort((a, b) => b.viol - a.viol || b.gated - a.gated)) {
  console.log(`${r.key.slice(0, 42).padEnd(42)} ${String(r.terms).padStart(5)} ${String(r.totalSH).padStart(8)} ${String(r.gated).padStart(6)} ${String(r.viol).padStart(6)}`);
}
console.log(`\ngated placements ${gatedCells}   placed too early ${violations}` +
  (gatedCells ? `  (${(100 * violations / gatedCells).toFixed(1)}%)` : ""));

if (perCourse.size) {
  console.log(`\nworst offenders (shortfall in SH at the term they were placed):`);
  for (const [id, v] of [...perCourse.entries()].sort((a, b) => b[1].short - a[1].short).slice(0, 15)) {
    console.log(`  ${id.padEnd(10)} needs ${requiredSHFor(v.req)} (${v.req}) · plan has ${v.earned} ` +
      `(${standingAtSH(v.earned)}) at term ${v.term} · short ${v.short}  [${v.key.slice(0, 28)}]`);
  }
}
process.exit(0);
