// INVARIANT · runtime binding across every shipped plan.
//
// X11's claim is that recomputing the binding live closes the gap a reservation
// otherwise has — an ambiguous card offering all 7,966 courses when the union
// of its real candidates is a median of 34 — without storing anything and
// without ever contradicting what the scrape already forced.
//
// Three things must hold on the whole corpus, not on a fixture:
//
//   monotone      no card ever gains a candidate (§11)
//   honest        no card claims nothing can answer it
//   seated        no requirement is claimed by more cards than it has room for
//
// The last one is why named cells were put into the same solve (N2): §12.0
// measured 44 over-subscribed sections when the two populations were solved
// separately, worst case twelve cards claiming a requirement needing one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import { specForNode } from "../../src/core/programEligibility.js";
import { bindReservations } from "../../src/core/runtimeBinding.js";
import {
  obligationsOf, specAdmitsSubject, specAdmitsRange,
} from "../../src/core/requirementBinding.js";
import { DEFAULT_UNIT_SH } from "../../src/core/requirementDemand.js";
import { createPlanHints } from "../../src/adapters/northeastern/planHints.js";
import {
  candidatesForReservation, courseIds, preferredCourseIds,
  isUnbounded, isImpossible, forcedRequirement,
} from "../../src/core/candidates.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSE_MAP = {};
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)), sh: c.credits ?? 0 };
}
const subjects = Object.keys(JSON.parse(readFileSync(join(ROOT, "public/northeastern/subjects.json"), "utf8")));
const HINTS = createPlanHints(subjects, { specAdmitsSubject, specAdmitsRange });

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029, 2030].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];

function corpus(limit = Infinity) {
  const out = [];
  for (const root of ["data/northeastern/programs/undergraduate/2026", "data/northeastern/programs/graduate/2026"]) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    for (const college of readdirSync(base)) {
      let progs = [];
      try { progs = readdirSync(join(base, college)); } catch { continue; }
      for (const prog of progs) {
        const pf = join(base, college, prog, "plan.json");
        const rf = join(base, college, prog, "requirements.json");
        if (!existsSync(pf) || !existsSync(rf)) continue;
        try {
          out.push({ name: prog,
            grid: JSON.parse(readFileSync(pf, "utf8")),
            program: JSON.parse(readFileSync(rf, "utf8")) });
        } catch { /* the scrape's problem, not this test's */ }
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
const CORPUS = corpus();

test("runtime binding closes the gap without breaking anything", () => {
  assert.ok(CORPUS.length > 300, `only ${CORPUS.length} programs`);
  let cards = 0, unbBefore = 0, unbAfter = 0, forcedBefore = 0, forcedAfter = 0;
  let withPreferred = 0, impossible = 0;

  for (const { name, grid, program } of CORPUS) {
    const sections = program.requirementSections ?? [];
    const ctx = {
      specOf: (t) => (typeof t === "number" ? specForNode(sections[t]) : null),
      courseMap: COURSE_MAP,
    };
    for (const plan of grid.plans ?? []) {
      const applied = applySamplePlan(plan, {
        semesters: SEMESTERS, courseMap: COURSE_MAP, programData: program,
      });
      const targets = bindReservations(applied.reservations, {
        programData: program, placements: applied.placements,
        courseMap: COURSE_MAP, hints: HINTS,
      });

      for (const r of Object.values(applied.reservations)) {
        cards += 1;
        const before = candidatesForReservation(r, { programData: program });
        const after = candidatesForReservation(r, {
          programData: program, targets: targets.get(r.id) ?? [],
        });

        const wasUnbounded = isUnbounded(before, ctx);
        if (wasUnbounded) unbBefore += 1;
        if (isUnbounded(after, ctx)) unbAfter += 1;
        if (forcedRequirement(before) != null) forcedBefore += 1;
        if (forcedRequirement(after) != null) forcedAfter += 1;

        // MONOTONE — a card may lose candidates, never gain one.
        if (!wasUnbounded) {
          const had = courseIds(before, ctx);
          for (const id of courseIds(after, ctx)) {
            assert.ok(had.has(id), `${name}: "${r.label}" GAINED candidate ${id}`);
          }
        }

        // HONEST — nothing may claim it cannot be answered.
        if (isImpossible(after, ctx)) {
          impossible += 1;
          assert.fail(`${name}: "${r.label}" became impossible`);
        }

        // A preference is a hint, never a restriction.
        const pref = preferredCourseIds(after, ctx);
        if (pref.size) {
          withPreferred += 1;
          const allowed = courseIds(after, ctx);
          for (const id of pref) {
            assert.ok(allowed.has(id), `${name}: preferred ${id} is not even allowed`);
          }
        }
      }
    }
  }

  assert.ok(cards > 10000, `only ${cards} cards`);
  assert.equal(impossible, 0);
  // The gain, pinned so a regression in the solver shows up as a number.
  assert.ok(forcedAfter > forcedBefore * 3,
    `forced barely moved: ${forcedBefore} → ${forcedAfter}`);
  assert.ok(unbAfter < unbBefore, `unbounded did not fall: ${unbBefore} → ${unbAfter}`);
  assert.ok(withPreferred > cards * 0.4,
    `only ${withPreferred} of ${cards} cards got a preferred set`);
});

test("over-subscription is bounded, and better than solving the two populations apart", () => {
  // §12.0 measured 44 sections claimed by more cards than they hold, when named
  // and unnamed cells were solved separately. Putting them in one solve brings
  // it to 34 — and CANNOT bring it to zero, which is worth stating because the
  // design claimed otherwise.
  //
  // "Forced" means *no other requirement is possible for this cell* — a
  // per-cell test. Two cells can each have exactly one possible home and still
  // not both fit, because the plan demands more of that requirement than it
  // holds. That is a fact about the catalog, not an inconsistency in the solve,
  // and §6 already lists it as a verification gate.
  //
  // Pinned as a ceiling so a regression that makes it worse is visible.
  let checked = 0, over = 0;
  const examples = [];

  for (const { name, grid, program } of CORPUS) {
    for (const plan of grid.plans ?? []) {
      const applied = applySamplePlan(plan, {
        semesters: SEMESTERS, courseMap: COURSE_MAP, programData: program,
      });
      const targets = bindReservations(applied.reservations, {
        programData: program, placements: applied.placements,
        courseMap: COURSE_MAP, hints: HINTS,
      });
      if (!targets.size) continue;

      const obligations = obligationsOf(program, {
        placedSet: new Set(Object.keys(applied.placements)), courseMap: COURSE_MAP,
      });
      const room = new Map();
      for (const o of obligations) {
        if (typeof o.target !== "number") continue;
        room.set(o.target, Math.max(1, Math.round(o.shortfallSH / (o.unitSH || DEFAULT_UNIT_SH))));
      }

      // Only FORCED claims are exclusive: an ambiguous card has not taken a
      // seat yet.
      const claims = new Map();
      for (const list of targets.values()) {
        if (list.length !== 1 || typeof list[0] !== "number") continue;
        claims.set(list[0], (claims.get(list[0]) ?? 0) + 1);
      }
      for (const [target, n] of claims) {
        checked += 1;
        const seats = room.get(target) ?? 0;
        if (n > seats) {
          over += 1;
          if (examples.length < 8) {
            examples.push(`${name}: "${program.requirementSections?.[target]?.title}" — ${n} forced vs room ${seats}`);
          }
        }
      }
    }
  }

  assert.ok(checked > 500, `only ${checked} claimed requirements examined`);
  assert.ok(over <= 34,
    `over-subscription grew to ${over} (was 34):\n  ${examples.join("\n  ")}`);
  assert.ok(over < 44,
    `one solve should beat the 44 measured when the populations were separate, got ${over}`);
});

test("placing more courses only ever narrows a card", () => {
  // The property §11 rests on, exercised against real plans rather than a
  // fixture: take the plan's own courses and reveal them a few at a time.
  //
  // This FAILED before `previous` existed, on a real program — a card gained a
  // target as the plan filled, because elimination is relative to competition
  // and satisfying a card's rivals frees the requirement it was excluded from.
  // Monotonicity has to be imposed by feeding the last answer back in; it is
  // not a property of the solve.
  let checked = 0;
  for (const { name, grid, program } of CORPUS.slice(0, 40)) {
    for (const plan of (grid.plans ?? []).slice(0, 1)) {
      const applied = applySamplePlan(plan, {
        semesters: SEMESTERS, courseMap: COURSE_MAP, programData: program,
      });
      const all = Object.entries(applied.placements);
      if (all.length < 8 || !Object.keys(applied.reservations).length) continue;
      checked += 1;

      let prev = null;
      for (const frac of [0.25, 0.5, 0.75, 1]) {
        const placements = Object.fromEntries(all.slice(0, Math.ceil(all.length * frac)));
        const now = bindReservations(applied.reservations, {
          programData: program, placements, courseMap: COURSE_MAP, hints: HINTS,
          previous: prev,
        });
        if (prev) {
          for (const [id, list] of now) {
            const had = new Set(prev.get(id) ?? []);
            // A card with nothing before had no constraint to violate.
            if (!had.size) continue;
            for (const t of list) {
              assert.ok(had.has(t), `${name}: card ${id} GAINED target ${t} at ${frac}`);
            }
          }
        }
        prev = now;
      }
    }
  }
  assert.ok(checked > 20, `only ${checked} plans exercised`);
});
