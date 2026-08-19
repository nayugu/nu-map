#!/usr/bin/env node
/**
 * early-terms-probe.js — does the generator actually FOLLOW the department for terms 1–4?
 *
 * ── Why this is separate from verify-chart ──────────────────────────
 *
 * `verify-chart` proves every generated plan is LEGAL: nothing over the cap, no broken
 * prerequisite, no empty term. It cannot prove the early terms are the department's, because
 * a plan we arranged entirely ourselves passes every one of those rules. Legality and
 * fidelity are different claims and only one of them was measured.
 *
 * Worse, the one number that touches this is circular in the gate: `chart-gate` checks term 0
 * against `max(cap, firstTermOverload)` where `firstTermOverload` is the figure the ENGINE
 * disclosed. So the engine declaring a 21 SH first term makes 21 SH legal. That check catches
 * an UNDISCLOSED overload and is blind, by construction, to an unjustified one. This probe is
 * the outside check: it compares the disclosure against what the department actually printed.
 *
 * ── What it measures ────────────────────────────────────────────────
 *
 *   FIDELITY   of the courses a department names in its first four terms and that we place
 *              definitely, how many sit in the term it named. Reported per term, because the
 *              window is not uniform — term 4 has always been the weak one.
 *
 *   FIRST TERM published SH vs generated SH vs the registration cap, per program. Three
 *              distinct failures, counted apart:
 *                over-published  we put MORE in term 0 than the department did and went over
 *                                the cap doing it — an overload of our own invention
 *                over-headroom   term 0 exceeds cap + FIRST_TERM_OVERLOAD_SH, the hard limit
 *                undisclosed     term 0 is over the cap and the report does not say so
 *
 *   MOVES      every course shifted out of its published term, by reason. A correction is the
 *              feature; a correction with no reason attached is a bug.
 *
 * Comparison is by (year, season) IDENTITY, never by term index. The index is exactly the
 * thing that drifts — `studySlots` exists because a work term consumes a domain index but not
 * a calendar slot — so a probe that recomputed the index could agree with a bug by sharing it.
 * "Year 1 Fall" is also the sentence a student would check, which is the point.
 *
 *   node scripts/early-terms-probe.js                 whole corpus
 *   node scripts/early-terms-probe.js --limit 120     smoke test, exits 3
 *   node scripts/early-terms-probe.js --json out.json  per-shape rows, for diffing two runs
 *   CHART_NO_DEPARTMENT=1 node scripts/early-terms-probe.js   the rule OFF, as a control
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/engine/index.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { FIRST_TERM_OVERLOAD_SH, EARLY_TERMS } from "../src/engine/earlyTerms.js";
import { programIdentity } from "../src/core/programIdentity.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const argAt = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const LIMIT = Number(argAt("--limit") ?? Infinity);
const JSON_OUT = argAt("--json");

function degreePrograms() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const key of readdirSync(cd)) {
        const rf = join(cd, key, "requirements.json");
        if (!existsSync(rf)) continue;
        const data = JSON.parse(readFileSync(rf, "utf8"));
        if (!(data.requirementSections ?? []).length) continue;
        if (!(data.totalCreditsRequired > 0)) continue;
        const pf = join(cd, key, "plan.json");
        out.push({ lvl, key, data,
                   plan: existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null });
      }
    }
  }
  return out;
}

/** Every entry in a term, `either` children included — the same flatten the engine uses. */
function flatten(entries, out = []) {
  for (const e of entries ?? []) {
    if (!e || typeof e !== "object") continue;
    out.push(e);
    flatten(e.children, out);
  }
  return out;
}

/**
 * A plan's STUDY terms in order, each as `{ key, sh, offers, definite }`.
 *
 * `key` is `"<yearIndex>|<season>"`, the calendar identity both plans share.
 *
 * A term that is nothing but co-op is dropped, matching `earlyTermsOf` — a co-op term that
 * also carries a class is a study term, which is why this counts course cells rather than
 * testing for the co-op marker.
 */
function studyTermsOf(plan) {
  const out = [];
  let yearIndex = -1;
  for (const year of plan?.years ?? []) {
    yearIndex += 1;
    for (const term of (year?.terms ?? [])) {
      if (!term || typeof term !== "object") continue;
      const entries = flatten(term.entries);
      const coop = entries.filter(e => e.coop).length;
      const courses = entries.filter(e =>
        !e.coop && !e.vacation && !e.heading && !e.either).length;
      if (coop > 0 && courses === 0) continue;

      let sh = 0;
      const offers = new Set();     // every course any option of any row names
      const definite = new Set();   // rows resolved to exactly one course — a real placement
      for (const e of entries) {
        if (e.coop || e.vacation || e.heading) continue;
        sh += e.sh ?? 0;
        for (const group of (e.options ?? [])) for (const id of group) offers.add(id);
        if (e.options?.length === 1 && e.options[0].length === 1) definite.add(e.options[0][0]);
      }
      out.push({
        key: `${yearIndex}|${term.type ?? ""}`,
        label: `${year.label ?? `Year ${yearIndex + 1}`} ${term.term ?? term.type ?? ""}`.trim(),
        sh, offers, definite,
        half: /summer\s*(1|2|a|b)/i.test(`${term.term ?? ""}`),
      });
    }
  }
  return out;
}

const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };
const donorFile = join(ROOT, "public/northeastern/early-donors.json");
const earlyDonors = existsSync(donorFile)
  ? (JSON.parse(readFileSync(donorFile, "utf8")).programs ?? {}) : {};

const all = degreePrograms();
const degrees = Number.isFinite(LIMIT) ? all.slice(0, LIMIT) : all;

// Fidelity per early term: how many published courses we placed, and how many in the term
// the department named. Indexed by position in the published plan's study-term list.
const fid = Array.from({ length: EARLY_TERMS }, () => ({ placed: 0, same: 0 }));
const moveReasons = new Map();
const rows = [];
const overPublished = [], overHeadroom = [], undisclosed = [];
let shapes = 0, made = 0, refused = 0, threw = 0, withPublished = 0, sourceCount = new Map();

for (const d of degrees) {
  const variants = d.plan?.plans?.length ? d.plan.plans : [null];
  variants.forEach((variant, vi) => {
    shapes += 1;
    const studentType = d.lvl === "graduate" ? "graduate" : "undergraduate";
    const label = `${d.lvl === "graduate" ? "grad" : "ug"}/${d.key}`
      + (variants.length > 1 ? `#${vi}` : "");
    let out;
    try {
      out = generatePlan({
        program: d.data, publishedPlan: variant, courseMap, ports, depthIndex,
        observedOrder: observed.edges,
        positions: observed.positions ?? null,
        coopPrep: (observed.coopPrep ?? []).map(x => x.course),
        donorPlan: variant ? null : (earlyDonors[programIdentity(d.data)]?.plan ?? null),
        studentType, calibration: chartCalibration, timeBudgetMs: 5000,
        ...(process.env.CHART_NO_DEPARTMENT ? { followDepartment: false } : {}),
      });
    } catch { threw += 1; return; }
    if (out.refused) { refused += 1; return; }
    made += 1;

    const rep = out.report?.earlyTerms ?? {};
    sourceCount.set(rep.source ?? "?", (sourceCount.get(rep.source ?? "?") ?? 0) + 1);
    for (const m of rep.moves ?? []) {
      const why = m.why ?? "(no reason recorded)";
      moveReasons.set(why, (moveReasons.get(why) ?? 0) + 1);
    }

    const gen = studyTermsOf(out.plan?.plans?.[0]);
    const genAt = new Map();
    for (const t of gen) for (const id of t.definite) if (!genAt.has(id)) genAt.set(id, t.key);

    // ── The first term ────────────────────────────────────────────────
    //
    // The cap is read through the same port the engine uses, halved for a half term exactly
    // as `chart-gate` does, so this is the registrar's limit and not a second opinion.
    const t0 = gen[0];
    const cap = ports.creditMax(studentType) * (t0?.half ? 0.5 : 1);
    const headroom = FIRST_TERM_OVERLOAD_SH * (t0?.half ? 0.5 : 1);
    const pub = variant ? studyTermsOf(variant) : [];
    const pub0 = pub[0]?.sh ?? null;
    const gen0 = t0?.sh ?? 0;
    const disclosed = rep.overload?.sh ?? null;

    const row = { label, studentType, source: rep.source ?? null,
                  pub0, gen0, cap, disclosed, moves: (rep.moves ?? []).length };
    rows.push(row);

    if (gen0 > cap + 0.01) {
      // Over the cap AND over what the department published there. `pub0 == null` means no
      // published plan at all, so any overload is ours by definition.
      if (pub0 == null || gen0 > pub0 + 0.01) overPublished.push(row);
      if (gen0 > cap + headroom + 0.01) overHeadroom.push(row);
      if (disclosed == null) undisclosed.push(row);
    }

    // ── Fidelity ──────────────────────────────────────────────────────
    if (variant) {
      withPublished += 1;
      pub.slice(0, EARLY_TERMS).forEach((pt, i) => {
        for (const id of pt.offers) {
          const at = genAt.get(id);
          if (at == null) continue;          // not definitely placed — nothing to compare
          fid[i].placed += 1;
          if (at === pt.key) fid[i].same += 1;
        }
      });
    }
  });
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

console.log(`\nEARLY-TERMS PROBE — ${shapes} shapes, ${made} generated, ${refused} refused, ${threw} threw`);
if (process.env.CHART_NO_DEPARTMENT) console.log("  ⚠ CHART_NO_DEPARTMENT=1 — the department rule is OFF (control run)");
console.log(`  early-terms source: ${[...sourceCount].map(([k, v]) => `${k} ${v}`).join(", ")}`);

console.log(`\n  ── fidelity to the published plan (${withPublished} shapes with one) ──`);
fid.forEach((f, i) => {
  console.log(`    term ${i + 1}   ${String(f.same).padStart(5)} / ${String(f.placed).padStart(5)} placed   ${pct(f.same, f.placed)}`);
});
const tot = fid.reduce((a, f) => ({ same: a.same + f.same, placed: a.placed + f.placed }), { same: 0, placed: 0 });
console.log(`    ALL 1–4  ${String(tot.same).padStart(5)} / ${String(tot.placed).padStart(5)} placed   ${pct(tot.same, tot.placed)}`);

console.log(`\n  ── corrections applied (why a course left its published term) ──`);
if (!moveReasons.size) console.log("    none");
for (const [why, n] of [...moveReasons].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${why}`);
}

console.log(`\n  ── the first semester ──`);
const over = rows.filter(r => r.gen0 > r.cap + 0.01);
console.log(`    over the ordinary cap        ${over.length} of ${made}`);
console.log(`    …and MORE than published     ${overPublished.length}   ← an overload we invented`);
console.log(`    …and over cap + ${FIRST_TERM_OVERLOAD_SH} hard limit  ${overHeadroom.length}   ← breaks the stated bound`);
console.log(`    …and NOT disclosed           ${undisclosed.length}   ← the panel would not say so`);
for (const r of overPublished.slice(0, 12)) {
  console.log(`      ${r.label}  published ${r.pub0 ?? "(none)"} SH → generated ${r.gen0} SH (cap ${r.cap})`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ fid, rows }, null, 1));
  console.log(`\n  wrote ${JSON_OUT}`);
}

const bad = overPublished.length + overHeadroom.length + undisclosed.length;
if (Number.isFinite(LIMIT)) {
  console.log("\n⚠ partial run (--limit) — proves the plumbing, not the corpus");
  process.exit(3);
}
console.log(bad === 0
  ? "\n✓ no first semester exceeds the cap beyond what its department published"
  : `\n✗ ${bad} first-semester findings above`);
process.exit(bad === 0 ? 0 : 1);
