#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// CHART DRIFT — is a course where a department would recognise it?
//
// Every number `verify-chart` reports is HYGIENE: empty terms, clumping, unguided cells, thin
// terms, placeholder position. None of them is SEQUENCING. Measured this session, a change that
// walked `MATH 1341` from Year 2 to Year 4 moved not one of them — and three separate
// regressions in one day were caught by a human reading a plan rather than by the gate.
//
// So this scores the axis the engine exists to get right, and it uses the corpus the way this
// repo already licenses: **as a witness, never as a source.** The published plans do not decide
// where a course goes — they are the record of where 616 departments actually put it, so a
// generated plan that puts it two years away has something to answer for.
//
// ── Why the per-course corpus position, and not the level table ─────
//
// Measured over 11,325 held-out placements, leave-one-PROGRAM-out:
//
//     MAE, per-course corpus median   0.071
//     MAE, LEVEL_POSITION table       0.128     <- what the engine steers by
//
// The corpus is nearly twice as good at saying where a course belongs. That makes it the better
// JUDGE, and it is still not usable as a target: the same plans violate prereq order in 7.7% of
// cases and season in 31.9%, which is what CHART exists to beat. Judging and copying are
// different acts, and the distinction is the one CLAUDE.md already draws about the Sample Plan
// of Study — a witness can prove we got something wrong and can never tell us what to do.
//
// ── The support bar ─────────────────────────────────────────────────
//
// Five distinct programs, the same bar `derive-plan-order.js` uses, and for the same reason: one
// department's habit is not evidence. 333 courses clear it, and departments agree with each
// other far more than expected — median MADN 0.000, and 304 of 333 under 0.10.
//
// Usage:  node scripts/chart-drift.js [--json out.json]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/engine/index.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;

// ── `--no-positions`: measure what the corpus FLOOR is worth ────────
//
// The floor in `reclaimFromFiller` is fed from the same `plan-order.json` this script judges
// against, which makes "did the floor help" a question the script cannot answer by default —
// both runs would have it. This turns it off for the engine while leaving the WITNESS intact,
// so a before/after is one flag rather than two checkouts.
const noPositions = argv.includes("--no-positions");

/** Distinct programs that must place a course before its position is believed. */
const MIN_PROGRAMS = 5;
/** How far from the corpus a placement may sit before it is a DRIFT, as a share of the plan. */
const DRIFT = 0.25;

const { courseMap } = loadCatalog();
const ports = enginePorts(courseMap);
const depthIndex = buildDepthIndex(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };

const degrees = [];
for (const lvl of ["undergraduate", "graduate"]) {
  const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);
  if (!existsSync(base)) continue;
  for (const col of readdirSync(base)) {
    const cd = join(base, col);
    if (!statSync(cd).isDirectory()) continue;
    for (const key of readdirSync(cd)) {
      const rf = join(cd, key, "requirements.json"), pf = join(cd, key, "plan.json");
      if (!existsSync(rf)) continue;
      let data, plan = null;
      try { data = JSON.parse(readFileSync(rf, "utf8")); } catch { continue; }
      if (existsSync(pf)) { try { plan = JSON.parse(readFileSync(pf, "utf8")); } catch {} }
      degrees.push({ lvl, key, data, plan });
    }
  }
}

// ── The witness: where each course actually sits, across published plans ──
const obs = new Map();
for (const d of degrees) {
  if (d.lvl !== "undergraduate") continue;
  for (const plan of d.plan?.plans ?? []) {
    const terms = [];
    for (const y of plan.years ?? []) for (const t of y.terms ?? []) {
      const named = [];
      const walk = (es) => { for (const e of es ?? []) {
        if (e.vacation || e.heading || e.either || e.coop) { walk(e.children); continue; }
        if (e.options?.length === 1) named.push(...e.options[0]);
        walk(e.children); } };
      walk(t.entries); terms.push(named);
    }
    if (terms.length < 2) continue;
    const seen = new Set();
    terms.forEach((named, i) => { for (const id of named) {
      if (seen.has(id)) continue; seen.add(id);
      if (!obs.has(id)) obs.set(id, []);
      obs.get(id).push({ pos: i / (terms.length - 1), program: d.key });
    }});
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const home = new Map();
for (const [id, xs] of obs) {
  if (new Set(xs.map(x => x.program)).size < MIN_PROGRAMS) continue;
  home.set(id, med(xs.map(x => x.pos)));
}

// ── Score every generated plan against it ──────────────────────────
let plans = 0, scored = 0, sumAbs = 0, late = 0, early = 0;
const worst = [];
for (const d of degrees) {
  const variants = d.plan?.plans?.length ? d.plan.plans : [null];
  variants.forEach((variant, vi) => {
    const studentType = d.lvl === "graduate" ? "graduate" : "undergraduate";
    const label = `${d.lvl === "graduate" ? "grad" : "ug"}/${d.key}`
      + (variants.length > 1 ? `#${vi}` : "");
    let out;
    try {
      out = generatePlan({
        program: d.data, publishedPlan: variant, courseMap, ports, depthIndex,
        observedOrder: observed.edges,
        positions: noPositions ? null : (observed.positions ?? null),
        coopPrep: (observed.coopPrep ?? []).map(x => x.course),
        studentType, calibration: chartCalibration, timeBudgetMs: 5000,
      });
    } catch { return; }
    if (out.refused) return;
    plans++;
    const doc = out.plan.plans[0];
    const terms = [];
    for (const y of doc.years ?? []) for (const t of y.terms ?? []) terms.push(t);
    const span = Math.max(1, terms.length - 1);
    terms.forEach((t, ti) => {
      const walk = (es) => { for (const e of es ?? []) {
        if (e.coop || e.vacation || e.heading) { walk(e.children); continue; }
        // Only cells the plan DECIDES: a reservation names no course, so the corpus has
        // nothing to say about it and scoring it would be scoring our own label.
        if (e.options?.length === 1) {
          for (const id of e.options[0]) {
            const want = home.get(id);
            if (want == null) continue;
            const got = ti / span;
            scored++;
            const delta = got - want;
            sumAbs += Math.abs(delta);
            if (delta > DRIFT) { late++; worst.push({ label, id, want, got, delta }); }
            else if (delta < -DRIFT) early++;
          }
        }
        walk(e.children);
      } };
      walk(t.entries);
    });
  });
}
worst.sort((a, b) => b.delta - a.delta);
const result = {
  plans, scored,
  meanAbsDrift: +(sumAbs / Math.max(1, scored)).toFixed(4),
  lateShare: +(100 * late / Math.max(1, scored)).toFixed(2),
  earlyShare: +(100 * early / Math.max(1, scored)).toFixed(2),
  late, early,
  worst: worst.slice(0, 12).map(w => ({ ...w, want: +w.want.toFixed(2), got: +w.got.toFixed(2), delta: +w.delta.toFixed(2) })),
  // ── EVERY drifted placement, keyed so two runs can be diffed ────────
  //
  // The printed list is the top twelve by delta, and delta SATURATES at 1.0 — a course whose
  // corpus home is term one, placed in the last term, scores exactly 1.0, and so do dozens of
  // others. Which twelve appear is then decided by sort stability, not by severity.
  //
  // That cost real time today. `CS 1800` appeared at 1.0 in the changed run's top twelve and not
  // in the baseline's, which reads as a new regression and is not evidence of one: both lists
  // were saturated. It WAS a regression — `tradeFoundations` had pushed it from Year 2 to Year 4
  // — but establishing that needed a separate generation of that one program, because the
  // artifact could not answer it.
  //
  // So the full set travels, keyed by plan and course. A diff of two runs then names exactly
  // which placements got worse, which is the question anyone comparing runs is actually asking.
  all: Object.fromEntries(worst.map(w => [`${w.label}|${w.id}`, +w.delta.toFixed(3)])),
};
console.log(`CHART drift — ${plans} plans, ${scored} placements judged against ${home.size} courses`);
console.log(`  mean |position - corpus|   ${result.meanAbsDrift}`);
console.log(`  more than ${DRIFT} LATE      ${late} (${result.lateShare}%)`);
console.log(`  more than ${DRIFT} EARLY     ${early} (${result.earlyShare}%)`);
console.log("  worst late placements:");
for (const w of result.worst) console.log(`    ${w.label.slice(0, 52).padEnd(53)} ${w.id.padEnd(10)} corpus ${w.want}  ours ${w.got}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2));
