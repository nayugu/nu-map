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
 * ── Two paths, and only one of them goes through the engine ─────────
 *
 * `--sample` checks the DEPARTMENTS' OWN published plans instead of generated ones.
 * That path never touches `buildDomains`, so the standing constraint cannot help
 * it: a student who loads a sample plan gets whatever the department published,
 * and the only thing standing between them and an unregisterable term is the
 * planner badge. So this mode is really a test of two things at once — whether
 * `standingViolationsOf` (the exact function the panel calls) fires on real data,
 * and whether NEU's own plans satisfy NEU's own registration rule.
 *
 * Usage:
 *   node scripts/standing-probe.js                    # a default spread of degrees
 *   node scripts/standing-probe.js --all              # every undergraduate degree (slow)
 *   node scripts/standing-probe.js --sample           # published sample plans, all degrees
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
import { earnedSHBefore, meetsStanding, requiredSHFor, standingAtSH, STANDING_LADDER, standingViolationsOf }
  from "../src/core/classStanding.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const sampleMode = args.includes("--sample");
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

/**
 * The prerequisites and position floors recovered from the published plans.
 *
 * Loaded because the ADAPTER loads them: `planGenerator.js` fetches `plan-order.json`
 * and passes `observedOrder`, `positions` and `coopPrep` on every generate. Measuring
 * without them measures an engine configuration no student is ever served.
 */
const observed = (() => {
  const f = join(ROOT, "public/northeastern/plan-order.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { edges: [], coopPrep: [], positions: null };
})();

// Which courses carry a gate at all, so the summary can say what share of the
// gated catalog each run actually exercised.
const gatedCatalog = Object.values(courseMap)
  .filter(c => STANDING_LADDER.includes(c?.offering?.std)).length;

const base = join(ROOT, "data/northeastern/programs/undergraduate/2026");
const targets = [];
for (const col of readdirSync(base)) {
  for (const key of readdirSync(join(base, col))) {
    if (!existsSync(join(base, col, key, "requirements.json"))) continue;
    if (!wantAll && !sampleMode
        && !(named.length ? named : DEFAULTS).some(n => key === n || `ug/${key}` === n)) continue;
    targets.push([col, key]);
  }
}

/**
 * Sample-plan mode: run the PANEL's own function over the departments' published
 * plans. `standingViolationsOf` is imported rather than reimplemented — a probe
 * that recomputed the rule would be measuring its own opinion of it.
 */
if (sampleMode) {
  let plansSeen = 0, gated = 0, viol = 0, noPlan = 0;
  const rows = [], worst = new Map();
  for (const [col, key] of targets) {
    const pf = join(base, col, key, "plan.json");
    if (!existsSync(pf)) { noPlan++; continue; }
    const doc = JSON.parse(readFileSync(pf, "utf8"));
    for (const pl of doc.plans ?? []) {
      const terms = [];
      for (const y of pl.years ?? []) for (const t of y.terms ?? []) terms.push(t);
      if (!terms.length) continue;
      plansSeen++;

      // Rebuild the planner's inputs from the published plan: a synthetic semId per
      // term, one placement per DECIDED entry, and a reservation for every undecided
      // one so its credit still counts toward standing (the panel's rule 1).
      const semIndex = {}, placements = {}, reservations = [];
      const localMap = {};
      terms.forEach((t, ti) => {
        const sid = `s${ti}`;
        semIndex[sid] = ti;
        (t.entries ?? []).forEach((e, ei) => {
          const opts = e.options ?? [];
          const decided = opts.length === 1 && opts[0].length >= 1;
          if (decided) {
            // An AND group is several courses in one entry; each is placed.
            opts[0].forEach((cid, ci) => {
              const pid = `${cid}`;
              placements[pid] = sid;
              localMap[pid] = { ...(courseMap[cid] ?? {}), id: pid,
                                sh: ci === 0 ? (e.sh ?? courseMap[cid]?.sh ?? 0) : 0,
                                offering: courseMap[cid]?.offering };
            });
          } else {
            reservations.push({ semId: sid, sh: e.sh ?? 0 });
          }
        });
      });

      const v = standingViolationsOf({
        placements, semIndex, courseMap: localMap, reservations,
        bonusSH: 0, studentType: "undergraduate",
      });
      const localGated = Object.keys(placements)
        .filter(id => STANDING_LADDER.includes(localMap[id]?.offering?.std)).length;
      gated += localGated;
      viol  += v.size;
      if (v.size) {
        for (const [id, info] of v) {
          const short = requiredSHFor(info.required) - info.earned;
          const prev = worst.get(id);
          if (!prev || short > prev.short) worst.set(id, { ...info, short, key });
        }
        rows.push({ key: `${key}${(doc.plans ?? []).length > 1 ? ` [${pl.label ?? "?"}]` : ""}`,
                    gated: localGated, viol: v.size });
      }
    }
  }
  console.log(`\nSAMPLE-PLAN MODE — the departments' own published plans`);
  console.log(`(this path never reaches buildDomains, so the planner badge is the only guard)\n`);
  console.log(`published plans checked ${plansSeen}   programs with no plan ${noPlan}`);
  console.log(`gated placements ${gated}   flagged as too early ${viol}` +
    (gated ? `  (${(100 * viol / gated).toFixed(1)}%)` : ""));
  if (rows.length) {
    console.log(`\nplans containing at least one flagged course (${rows.length}):`);
    for (const r of rows.sort((a, b) => b.viol - a.viol).slice(0, 20)) {
      console.log(`  ${String(r.viol).padStart(3)} of ${String(r.gated).padStart(3)} gated  ${r.key.slice(0, 56)}`);
    }
  }
  if (worst.size) {
    console.log(`\nworst shortfalls:`);
    for (const [id, v] of [...worst.entries()].sort((a, b) => b[1].short - a[1].short).slice(0, 15)) {
      console.log(`  ${id.padEnd(10)} needs ${requiredSHFor(v.required)} (${v.required}) · plan has ${v.earned} ` +
        `(${standingAtSH(v.earned)}) · short ${v.short}  [${v.key.slice(0, 30)}]`);
    }
  }
  process.exit(0);
}

let plans = 0, refused = 0, gatedCells = 0, violations = 0;
const perCourse = new Map();          // courseId → worst shortfall seen
const rows = [];

for (const [col, key] of targets) {
  const data = JSON.parse(readFileSync(join(base, col, key, "requirements.json"), "utf8"));
  const pf = join(base, col, key, "plan.json");
  const doc = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null;
  // ── EVERY published variant, not just the first ──────────────────────
  //
  // This probe planned `plans[0]` and reported 690 gated placements with zero too
  // early, over all 278 degrees — while Mechanical Engineering and Bioengineering
  // variant 2 seated BIOE 5640 twenty-nine credits short. The app plans
  // `catalogVariants[variantIdx]`, whichever the student picked in the picker, so a
  // verdict on variant 0 is a verdict on a plan most students are never served.
  //
  // The variants are not near-duplicates: co-ops in Summer-2/Fall consume every later
  // fall, so a fall-only gated course has nowhere legal to go, while the SAME five-year,
  // three-co-op degree with co-ops in Spring/Summer-1 places it with 104 credits in hand.
  // One label apart, and only one of them is schedulable.
  for (const [vi, pub] of ((doc?.plans ?? [null]).entries())) {
  const variantLabel = pub?.label ? ` [${pub.label}]` : "";

  let r;
  try {
    r = generatePlan({
      program: data, publishedPlan: pub, courseMap, ports, depthIndex,
      calibration: chartCalibration, timeBudgetMs: 8000,
      // The arguments the ADAPTER passes. Omitting them measured an argument set no
      // user is ever given: `planGenerator.js` and `verify-chart.js` both supply the
      // recovered order and position floors, which move where cells land.
      observedOrder: observed.edges,
      positions: observed.positions ?? null,
      coopPrep: (observed.coopPrep ?? []).map(x => x.course),
      repeatable: (id) => !!courseMap[id]?.repeatable,
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
        if (!prev || short > prev.short) {
          perCourse.set(label, { req, earned, short, term: ti, key: `${key}${variantLabel}` });
        }
      }
    }
  });
  gatedCells += localGated;
  violations += localViol;
  // The engine's own verdict, alongside ours. They should agree: `standingUnmet` is
  // what `repairStanding` could not fix, and a violation the probe sees that the report
  // does not is a hole in the reporting rather than in the plan — which is the whole
  // defect this probe was extended for.
  const reported = (r.report?.standingUnmet ?? []).length;
  rows.push({ key: `${key}${variantLabel}`, variant: vi, terms: terms.length,
              gated: localGated, viol: localViol, reported,
              totalSH: shByTerm.reduce((a, b) => a + b, 0) });
  }
}

console.log(`\ncatalog: ${gatedCatalog} courses carry a class-standing gate`);
console.log(`plans generated ${plans}   refused ${refused}\n`);
console.log(`${"program".padEnd(42)} terms  totalSH  gated  early  said`);
for (const r of rows.sort((a, b) => b.viol - a.viol || b.gated - a.gated)) {
  console.log(`${r.key.slice(0, 42).padEnd(42)} ${String(r.terms).padStart(5)} ${String(r.totalSH).padStart(8)} ${String(r.gated).padStart(6)} ${String(r.viol).padStart(6)} ${String(r.reported).padStart(5)}`);
}
console.log(`\ngated placements ${gatedCells}   placed too early ${violations}` +
  (gatedCells ? `  (${(100 * violations / gatedCells).toFixed(1)}%)` : ""));

// ── Silence is the defect, so count it separately ────────────────────
//
// A violation the plan does not mention is worse than one it does: the student cannot
// ask an advisor about a problem nobody told them about. So the number to drive to zero
// is not `too early` — some gates are genuinely unreachable and the plan is still the
// best available — it is UNREPORTED.
const unreported = rows.filter(r => r.viol > r.reported);
console.log(`plans stating their shortfall ${rows.filter(r => r.viol && r.reported).length}` +
  `   silently violating ${unreported.length}`);
for (const r of unreported.slice(0, 10)) {
  console.log(`  UNREPORTED  ${r.key.slice(0, 56)}  ${r.viol} violation(s), report named ${r.reported}`);
}

if (perCourse.size) {
  console.log(`\nworst offenders (shortfall in SH at the term they were placed):`);
  for (const [id, v] of [...perCourse.entries()].sort((a, b) => b[1].short - a[1].short).slice(0, 15)) {
    console.log(`  ${id.padEnd(10)} needs ${requiredSHFor(v.req)} (${v.req}) · plan has ${v.earned} ` +
      `(${standingAtSH(v.earned)}) at term ${v.term} · short ${v.short}  [${v.key.slice(0, 28)}]`);
  }
}
process.exit(0);
