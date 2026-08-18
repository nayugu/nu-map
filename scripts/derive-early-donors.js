/**
 * derive-early-donors.js — a first-four-semesters plan for programs that publish none.
 *
 *   node scripts/derive-early-donors.js [--write]
 *
 * Dry run by default. Writes `public/northeastern/early-donors.json`, keyed by
 * `programIdentity`, which the engine reads as though the department had published it
 * — see `scripts/lib/early-donors.js` for the method and `src/engine/seed.js` for
 * what is then done with it.
 *
 * ## Why this is offline
 *
 * Picking a donor compares one program against every other, and the engine holds
 * one program. So the comparison happens here and ships as data, the same
 * arrangement as `plan-order.json`: derived evidence with a confidence attached,
 * injected rather than imported, so a caller can always plan without it.
 *
 * ## The validation is part of the tool
 *
 * Every program that publishes a plan is also a test case: hide it, borrow from
 * the others, and compare. That is printed on every run, per level, because the
 * method's worth is not a fact about the algorithm — it is a fact about how much
 * structure this corpus actually repeats, and only measurement knows that. The
 * graduate figure is the one to watch: 358 of the 365 unplanned shapes are
 * graduate, and only ~36 graduate programs publish a plan to learn from, so the
 * donor pool there is thin and the numbers are not the undergraduate ones.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedFromPlan } from "../src/engine/seed.js";
import { programIdentity } from "../src/core/programIdentity.js";
import {
  requiredBySubject, pickDonors, borrowEarlyPlan, clustersOf,
  EARLY_TERMS, MIN_CLUSTER, MIN_SIMILARITY,
} from "./lib/early-donors.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(ROOT, "public/northeastern/early-donors.json");

/** Strip the campus, so a program's own twin is identifiable when validating. */
const baseOf = (name) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();

/**
 * The courses a published variant names in each of its first study terms.
 *
 * An array of `EARLY_TERMS` sets, so index 0 is the first semester a student
 * studies in. Inverted out of `seedFromPlan`'s course→term map, which is the
 * engine's own reading of the same question.
 */
function earlyTermsOf(variant) {
  const out = Array.from({ length: EARLY_TERMS }, () => new Set());
  for (const [course, ti] of seedFromPlan(variant).courseTerm) {
    if (ti >= 0 && ti < EARLY_TERMS) out[ti].add(course);
  }
  return out;
}

function load() {
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
        // The same two filters CHART's own corpus runner applies, so this file
        // describes exactly the population that will ask for it.
        if (!(data.requirementSections ?? []).length) continue;
        if (!(data.totalCreditsRequired > 0)) continue;
        const pf = join(cd, key, "plan.json");
        const plan = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null;
        const variant = plan?.plans?.[0] ?? null;
        out.push({
          lvl, key, name: data.name, base: baseOf(data.name ?? ""),
          // Name AND url together, because neither alone is unique — see
          // `programIdentity`. Computed by the same function the adapter uses, so a
          // lookup cannot miss by disagreeing about the key.
          id: programIdentity(data),
          bySubject: requiredBySubject(data),
          // A donor teaches from ONE variant: they are alternative routes through
          // the same degree, and averaging them would invent a fifth route.
          //
          // Read through the ENGINE's own traversal rather than a second one here.
          // `seedFromPlan` already answers "which study term did the department put
          // this course in", skipping work terms and counting only the rows that name
          // a single course — which is exactly what may be borrowed. A private copy
          // of that walk is how the two would drift.
          early: variant ? earlyTermsOf(variant) : null,
        });
      }
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const programs = load();
const donorsFor = (lvl) => programs.filter(p => p.lvl === lvl && p.early?.length);

// ── Validation: hold out every program that publishes a plan ─────────
//
// Recall over the courses the program requires, in a cluster subject, in its own
// first term — the population a donor could possibly have got right. The control
// is the corpus's commonest first-term courses, which is what "no donor" would
// amount to if one were forced to guess.
/**
 * Recall AND precision, because recall alone is gameable.
 *
 * A looser similarity floor admits more donors, which places more courses, which
 * raises recall mechanically — predicting everything would score 100%. So the
 * measure that decides the thresholds is precision: of the placements a donor
 * proposes, how many land in the term the program itself chose.
 */
function validate(lvl) {
  const pool = donorsFor(lvl);
  const freq = new Map();
  for (const p of pool) for (const k of (p.early[0] ?? [])) freq.set(k, (freq.get(k) ?? 0) + 1);
  const commonest = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);

  let donorHit = 0, priorHit = 0, total = 0, covered = 0;
  let exact = 0, near = 0, proposed = 0;
  for (const target of pool) {
    const subjects = new Set(clustersOf(target.bySubject));
    const truth = [...(target.early[0] ?? [])].filter(k => {
      const s = /^([A-Z]+)/.exec(k)?.[1];
      return subjects.has(s) && target.bySubject.get(s)?.has(k);
    });
    const borrowed = borrowEarlyPlan(target, pickDonors(target, pool, { excludeSameBase: true }));
    if (borrowed) covered += 1;

    // Where the program itself first places each course.
    const actual = new Map();
    (target.early ?? []).forEach((named, i) => {
      for (const k of named) if (!actual.has(k)) actual.set(k, i);
    });
    // Every placement proposed, with the term proposed for it.
    let termIndex = 0;
    const first = new Set();
    for (const year of (borrowed?.years ?? [])) {
      for (const term of (year.terms ?? [])) {
        for (const e of (term.entries ?? [])) {
          const key = e.options[0][0];
          if (termIndex === 0) first.add(key);
          proposed += 1;
          const real = actual.get(key);
          if (real === termIndex) exact += 1;
          if (real != null && Math.abs(real - termIndex) <= 1) near += 1;
        }
        termIndex += 1;
      }
    }

    if (!truth.length) continue;
    const prior = new Set(commonest.slice(0, truth.length));
    for (const k of truth) {
      total += 1;
      if (first.has(k)) donorHit += 1;
      if (prior.has(k)) priorHit += 1;
    }
  }
  return { pool: pool.length, covered, total, proposed,
           donor: total ? donorHit / total : 0, prior: total ? priorHit / total : 0,
           exact: proposed ? exact / proposed : 0, near: proposed ? near / proposed : 0 };
}

console.log(`\nsimilarity floor ${MIN_SIMILARITY}, clusters of >=${MIN_CLUSTER} courses, `
  + `${EARLY_TERMS} terms\n`);
console.log("── held out every program that publishes a plan, and borrowed for it ──");
for (const lvl of ["undergraduate", "graduate"]) {
  const v = validate(lvl);
  console.log(`  ${lvl}  (${v.pool} donors available)`);
  console.log(`    first-term recall   ${(100 * v.donor).toFixed(1)}%   `
    + `against ${(100 * v.prior).toFixed(1)}% for "just use the commonest first-term courses"`);
  console.log(`    precision           ${(100 * v.exact).toFixed(1)}% land in the exact term `
    + `the program chose, ${(100 * v.near).toFixed(1)}% within one term `
    + `(${v.proposed} placements)`);
}

// ── The artifact ────────────────────────────────────────────────────
const need = programs.filter(p => !p.early);
const entries = {};
let borrowed = 0;
const perLevel = {};
for (const target of need) {
  const picked = pickDonors(target, donorsFor(target.lvl));
  const plan = borrowEarlyPlan(target, picked);
  if (!plan) continue;
  borrowed += 1;
  perLevel[target.lvl] = (perLevel[target.lvl] ?? 0) + 1;
  entries[target.id] = {
    program: target.name,
    donors: picked.map(d => ({ subject: d.subject, from: d.donor.name,
                               similarity: Number(d.similarity.toFixed(3)) })),
    plan,
  };
}

console.log(`\n── coverage ──`);
console.log(`  programs publishing no plan       ${need.length}`);
console.log(`  ...for which a donor was found    ${borrowed}  ${JSON.stringify(perLevel)}`);
console.log(`  ...left to the search, as today    ${need.length - borrowed}`);

// The key has to be unique, or one program silently inherits another's plan. This rail
// has already earned itself twice: program NAMES collide five ways, and sourceUrls
// collide 34 ways since one catalog page became able to carry several programs.
const ids = new Set(programs.map(p => p.id));
if (ids.size !== programs.length || ids.has("")) {
  console.error(`\nrefusing to write: ${programs.length - ids.size} programs share an identity`
    + `${ids.has("") ? ", and at least one has none" : ""}`);
  process.exit(1);
}
// Upstream breakage guard, the same principle as `fetch-nupath`'s 5% rule: a
// scrape that lost the plans would silently empty this file.
if (donorsFor("undergraduate").length < 200) {
  console.error(`\nrefusing to write: only ${donorsFor("undergraduate").length} undergraduate `
    + `donors, expected ~349. The plans did not load.`);
  process.exit(1);
}

if (!process.argv.includes("--write")) {
  console.log(`\ndry run — pass --write to update ${OUT.replace(ROOT + "/", "")}`);
  process.exit(0);
}
const doc = {
  generated: new Date().toISOString().slice(0, 10),
  source: "per-cluster nearest neighbour among programs that publish a Sample Plan of Study",
  method: "the target's OWN required courses, timed by the donor's first terms",
  filters: { minSimilarity: MIN_SIMILARITY, minCluster: MIN_CLUSTER, terms: EARLY_TERMS },
  programs: entries,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`\nwrote ${OUT.replace(ROOT + "/", "")} — ${borrowed} programs`);
