// INVARIANT · a generated plan survives the round trip into a real planner.
//
// CHART's central design claim is that it emits the SAME artifact the catalog
// publishes, so `applySamplePlan` consumes it unchanged and reservations, candidates,
// the grid, PDF export and share links all work with no new downstream code.
//
// That claim was never tested. Everything else in the suite checks the GRID CHART
// emits; nothing checked what the planner makes of it — and a grid can be perfectly
// well formed and still load as the wrong plan.
//
// So this loads every generated plan the way the app does and asserts what a student
// would then see: every course placed, every reservation created, co-ops rebuilt as
// runs rather than counted twice, requirement bindings resolving to the sections they
// were constructed from, and credit totals surviving the trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { generatePlan } from "../../src/engine/index.js";
import { applySamplePlan, academicYears } from "../../src/core/applySamplePlan.js";
import { resolveRequirement, semesterOccupants } from "../../src/core/reservations.js";
import { candidatesForReservation, courseIds, isUnbounded } from "../../src/core/candidates.js";
import { specForNode } from "../../src/core/programEligibility.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);
const observedOrder = JSON.parse(
  readFileSync(join(ROOT, "public/northeastern/plan-order.json"), "utf8")).edges;

/**
 * The semester grid a cohort has, SIZED TO THE PLAN.
 *
 * Sized rather than fixed, because a five-year grid silently drops a six-year plan's
 * last year: `applySamplePlan` finds no semester for it and reports
 * `outside-timeline`. PharmD is six years, and against a fixed grid it lost two
 * reservations, a named course and 9 credits — which read as four separate engine
 * bugs and was one wrong fixture.
 *
 * The real integration constraint this stands for: whoever calls CHART must supply a
 * grid at least as long as the shape it generates.
 */
const semestersFor = (years) => [
  { id: "incoming", semTypeId: "incoming", type: "special", maxSlots: 99 },
  ...Array.from({ length: Math.max(5, years + 1) }, (_, k) => 2026 + k).flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1,   maxSlots: 4 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1,   maxSlots: 4 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5, maxSlots: 2 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5, maxSlots: 2 },
  ]),
];

function degreePrograms() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const p of readdirSync(cd)) {
        const f = join(cd, p, "requirements.json");
        if (!existsSync(f)) continue;
        const data = JSON.parse(readFileSync(f, "utf8"));
        if (!(data.requirementSections ?? []).length || !(data.totalCreditsRequired > 0)) continue;
        const pf = join(cd, p, "plan.json");
        out.push({ lvl, key: p, data,
                   plan: existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null });
      }
    }
  }
  return out;
}

function sample(list, n) {
  let seed = 0x5eed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const N = process.env.CHART_CORPUS === "all" ? Infinity : 150;
const PROGRAMS = sample(degreePrograms(), N);

/** Generate, then load, exactly as the app would. */
const loaded = [];
for (const p of PROGRAMS) {
  const out = generatePlan({
    program: p.data, publishedPlan: p.plan?.plans?.[0] ?? null,
    courseMap, ports, depthIndex, observedOrder,
    studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
    timeBudgetMs: 2500,
  });
  if (out.refused) continue;
  const SEMESTERS = semestersFor(out.plan.plans[0].years.length);
  const applied = applySamplePlan(out.plan.plans[0], {
    semesters: SEMESTERS, courseMap, programData: p.data,
  });
  loaded.push({ p, out, applied, SEMESTERS });
}

test("roundtrip › there is something to check", () => {
  assert.ok(loaded.length > 80, `only ${loaded.length} plans loaded`);
});

test("roundtrip › every cell becomes a card — nothing is silently dropped", () => {
  // The failure this catches is the quiet one: a cell shape `applySamplePlan` does
  // not recognise vanishes, and the student gets a plan missing a requirement with
  // no error anywhere.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded) {
    const cells = out.plan.plans[0].years
      .flatMap(y => y.terms)
      .flatMap(t => (t.entries ?? []).filter(e => !e.coop));
    const placedGroups = cells.filter(e => e.options?.length === 1).length;
    const reservations = cells.length - placedGroups;
    // A named cell may place several courses; count CELLS on both sides.
    const gotReserved = applied.reserved.length;
    if (gotReserved !== reservations) {
      bad.push(`${p.key}: ${reservations} undecided cells emitted, ${gotReserved} reservations created`);
    }
    for (const e of cells.filter(x => x.options?.length === 1)) {
      for (const id of e.options[0]) {
        if (applied.placements[id] === undefined) {
          bad.push(`${p.key}: ${id} was named in the grid and is not in the plan`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans lost a cell in the round trip`);
});

test("roundtrip › a course lands in the term the grid put it in", () => {
  // The off-by-one that shifted every cell by one term produced plans that were
  // internally consistent and wrong. Checked here against the SEMESTER a course
  // actually occupies after loading, which is the only thing the student sees.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded) {
    const years = academicYears(SEMESTERS);
    out.plan.plans[0].years.forEach((gy, yi) => {
      for (const t of gy.terms ?? []) {
        const sem = years[yi]?.find(s => s.semTypeId === t.type);
        for (const e of (t.entries ?? []).filter(x => !x.coop)) {
          if (e.options?.length !== 1) continue;
          for (const id of e.options[0]) {
            if (sem && applied.placements[id] !== sem.id) {
              bad.push(`${p.key}: ${id} emitted in ${gy.label} ${t.term} (${sem.id}) but loaded into ${applied.placements[id]}`);
            }
          }
        }
      }
    });
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} courses loaded into the wrong term`);
});

test("roundtrip › co-ops rebuild as runs, never as one block per column", () => {
  // The catalog writes a six-month co-op as TWO cells, one per term column, and
  // `applySamplePlan` merges consecutive ones. A generated plan that emitted them
  // wrongly would give a student twice the co-ops their program requires.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded) {
    const coopTerms = out.plan.plans[0].years
      .flatMap(y => y.terms).filter(t => (t.entries ?? []).some(e => e.coop)).length;
    if (!coopTerms) {
      if (applied.coops.length) bad.push(`${p.key}: invented ${applied.coops.length} co-ops`);
      continue;
    }
    if (!applied.coops.length) { bad.push(`${p.key}: ${coopTerms} co-op terms became no co-op`); continue; }
    const spanned = applied.coops.reduce((n, c) => n + c.spans.length, 0);
    if (spanned !== coopTerms) {
      bad.push(`${p.key}: ${coopTerms} co-op terms emitted, ${spanned} spanned by ${applied.coops.length} blocks`);
    }
    // Every block must be a length the institution actually sells.
    for (const c of applied.coops) {
      if (![4, 6].includes(c.duration)) bad.push(`${p.key}: co-op of ${c.duration} months`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans mishandled a co-op`);
});

test("roundtrip › every reservation resolves to the requirement it was built from", () => {
  // The inversion's whole claim: a generated cell's binding is CONSTRUCTED, so it
  // cannot be wrong. `resolveRequirement` re-checks the stored index against the
  // stored title, which is what would catch it if the emitter mislabelled anything.
  const bad = [];
  for (const { p, applied, SEMESTERS } of loaded) {
    for (const r of applied.reserved) {
      if (!r.requirement) continue;                 // a sentinel-bound cell, correctly
      const resolved = resolveRequirement(r, p.data);
      if (!resolved) {
        bad.push(`${p.key}: reservation "${r.label}" claims §${r.requirement.index} ` +
                 `"${r.requirement.title}" which does not resolve`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} reservations with an unresolvable binding`);
});

test("roundtrip › a reservation's candidates can actually answer its requirement", () => {
  // Loaded through the real runtime path, so this exercises `candidatesForReservation`
  // over CHART's output rather than the catalog's.
  const bad = [];
  for (const { p, applied, SEMESTERS } of loaded) {
    const sections = p.data.requirementSections;
    for (const r of applied.reserved) {
      const resolved = resolveRequirement(r, p.data);
      if (!resolved) continue;
      const cands = candidatesForReservation(r, { programData: p.data });
      const specOf = (t) => (typeof t === "number" ? specForNode(sections[t]) : null);
      if (isUnbounded(cands, { specOf })) continue;
      const ids = courseIds(cands, { specOf, courseMap });
      if (!ids.size) {
        bad.push(`${p.key}: reservation "${r.label}" (§${resolved.index}) has no candidate at all`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} reservations nothing can answer`);
});

test("roundtrip › credit survives the trip", () => {
  // Reservations carry `sh` for term load; placements carry real course credit. The
  // two together must still add up to what CHART reported, or a term reads light.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded) {
    const placedSH = Object.keys(applied.placements)
      .reduce((n, id) => n + (courseMap[id]?.sh ?? 0), 0);
    const reservedSH = applied.reserved.reduce((n, r) => n + (r.sh ?? 0), 0);
    const got = placedSH + reservedSH;
    // Coreq partners `applySamplePlan` adds on its own can only ADD credit, and
    // CHART now pre-empts them, so any gap should be small and upward.
    if (got < out.report.cellsSH - 1) {
      bad.push(`${p.key}: CHART planned ${out.report.cellsSH} SH, the plan holds ${got}`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans lost credit on load`);
});

test("roundtrip › no term is over the cap once the plan is actually loaded", () => {
  // The check that matters, because `applySamplePlan` adds corequisite partners of
  // its own accord. CHART sizing a term at 18 SH is irrelevant if it arrives at 20.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded) {
    const occupants = semesterOccupants(applied.placements, applied.reservations);
    const max = ports.creditMax(p.lvl === "graduate" ? "graduate" : "undergraduate");
    const bySem = new Map();
    for (const [key, semId] of Object.entries(occupants)) {
      const sh = key.startsWith("~res:")
        ? (applied.reservations[key]?.sh ?? 0)
        : (courseMap[String(key).split("#")[0]]?.sh ?? 0);
      bySem.set(semId, (bySem.get(semId) ?? 0) + sh);
    }
    for (const [semId, sh] of bySem) {
      const sem = SEMESTERS.find(s => s.id === semId);
      if (!sem || sem.semTypeId === "incoming") continue;
      const cap = max * (sem.weight ?? 1);
      if (sh > cap) bad.push(`${p.key} ${semId}: ${sh} SH > ${cap} after loading`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} terms over the cap after loading`);
});

test("roundtrip › re-applying the same plan adds nothing a second time", () => {
  // `origin` is provenance, not identity, and the guarantee is that loading twice is
  // idempotent. A generated plan has to honour it like any other.
  const bad = [];
  for (const { p, out, applied, SEMESTERS } of loaded.slice(0, 40)) {
    const again = applySamplePlan(out.plan.plans[0], {
      semesters: SEMESTERS, courseMap, programData: p.data,
      placements: applied.placements, reservations: applied.reservations,
      specialTermPl: applied.specialTermPl,
    });
    if (again.reserved.length) bad.push(`${p.key}: ${again.reserved.length} duplicate reservations`);
    if (again.placed.length)   bad.push(`${p.key}: ${again.placed.length} duplicate placements`);
    if (again.coops.length)    bad.push(`${p.key}: ${again.coops.length} duplicate co-ops`);
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans were not idempotent on reload`);
});

test("roundtrip › loading reports no unknown course and no outside-timeline cell", () => {
  const bad = [];
  for (const { p, applied, SEMESTERS } of loaded) {
    for (const n of applied.notes) {
      if (n.kind === "unknown-course") bad.push(`${p.key}: emitted unknown course ${n.code}`);
      if (n.kind === "outside-timeline") bad.push(`${p.key}: emitted a term outside the grid — ${n.text}`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans produced load-time complaints`);
});
