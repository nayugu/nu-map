// ═══════════════════════════════════════════════════════════════════
// INVARIANT: the measured constants still match the corpus
//
// ── The risk this covers ────────────────────────────────────────────
//
// CHART's sequencing rests on four numbers that were MEASURED over the published plans and
// then written into source:
//
//   LEVEL_POSITION        where a course of each level sits, as a fraction through the plan
//   SAME_REQ_PER_TERM     how many cells of one requirement a term carries
//   FULL_TERM_MIN_COURSES four real courses in every full fall and spring
//   POOL_REACH_MIN        how much of an elective pool is open where a department places it
//
// Every one of them is a fact about a corpus that is re-scraped MONTHLY. A constant derived
// from data and then frozen beside it is the precise failure `CLAUDE.md` records for term
// windows — "never re-freeze any of this as constants: NU moved Spring to a Wednesday start
// in 2026, and only the rolling derivation noticed."
//
// ── Why a drift alarm and not a generated artifact ──────────────────
//
// The thorough fix is to emit these from `derive-plan-order.js` alongside the order edges
// and inject them, the way `observedOrder` already is. That is the right end state and it
// is a real change: the constants are read in three modules, so a calibration object has to
// be threaded through `generatePlan` into `prereqDepth` and `domains`.
//
// The RISK, though, is not that the numbers are wrong today — they were measured. It is
// that a shift goes unnoticed. So this makes a shift loud, which is the whole of the harm,
// at a fraction of the cost. If it ever fires, threading the calibration is the answer, and
// this test is what will say so.
//
// ── Tolerances are wide on purpose ──────────────────────────────────
//
// This re-derives from the shipped plans with slightly different filters than the original
// measurements used, so it must not demand exact reproduction — that would fail on a
// difference in method rather than a difference in the world. The bands below are set to
// catch a MOVE, not a rounding: a level target off by 0.15 is a different convention, and
// off by 0.02 is the same one counted differently.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVEL_POSITION, courseLevel } from "../../src/engine/prereqDepth.js";
import {
  SAME_REQ_PER_TERM, FULL_TERM_MIN_COURSES, REAL_COURSE_SH,
} from "../../src/engine/domains.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";

// fileURLToPath, not .pathname: the latter is percent-encoded and breaks on a
// checkout whose path contains a space.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { courseMap } = loadCatalog();

/** Every published plan variant, flattened to study terms. */
function publishedTerms() {
  const out = [];
  for (const lvl of ["undergraduate"]) {
    const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const p of readdirSync(cd)) {
        const f = join(cd, p, "plan.json");
        if (!existsSync(f)) continue;
        for (const v of JSON.parse(readFileSync(f, "utf8")).plans ?? []) {
          const terms = [];
          for (const y of v.years ?? []) for (const t of y.terms ?? []) {
            const named = []; const labels = [];
            let coop = false;
            const walk = (es) => { for (const e of es ?? []) {
              if (e.coop) { coop = true; walk(e.children); continue; }
              if (e.vacation || e.heading) { walk(e.children); continue; }
              if (e.options?.length === 1) named.push(...e.options[0]);
              else if (e.text) labels.push(String(e.text).replace(/\s+/g, " ").trim().toLowerCase());
              walk(e.children);
            } };
            walk(t.entries);
            if (coop) continue;
            terms.push({ named, labels, half: /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`) });
          }
          if (terms.length >= 4) out.push(terms);
        }
      }
    }
  }
  return out;
}

const PLANS = publishedTerms();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const share = (a, f) => (a.length ? a.filter(f).length / a.length : 0);

test("calibration › there is a corpus to calibrate against", () => {
  // Guards every assertion below from passing vacuously. A loader that silently returns
  // nothing would make each band trivially satisfied, which is the failure mode that lets
  // a calibration test rot into decoration.
  assert.ok(PLANS.length > 300, `only ${PLANS.length} published plan variants parsed`);
});

test("calibration › LEVEL_POSITION still matches where the corpus puts each level", () => {
  const byLevel = new Map();
  for (const terms of PLANS) {
    const span = Math.max(1, terms.length - 1);
    terms.forEach((t, i) => {
      for (const id of t.named) {
        const lv = courseLevel(id);
        if (!lv || lv > 4) continue;                 // graduate levels have their own target
        if (!byLevel.has(lv)) byLevel.set(lv, []);
        byLevel.get(lv).push(i / span);
      }
    });
  }
  const drift = [];
  for (const lv of [1, 2, 3, 4]) {
    const seen = byLevel.get(lv) ?? [];
    if (seen.length < 200) continue;                 // too thin to judge
    const got = median(seen);
    const want = LEVEL_POSITION[lv];
    // 0.15 of the plan — about a term and a half in a ten-term plan. A move that large is
    // a different convention; anything smaller is the same one counted differently.
    if (Math.abs(got - want) > 0.15) {
      drift.push(`level ${lv}: corpus median ${got.toFixed(2)}, LEVEL_POSITION says ${want}`);
    }
  }
  assert.deepEqual(drift, [],
    `LEVEL_POSITION has drifted from the corpus it was measured on:\n  ${drift.join("\n  ")}\n`
    + `Re-measure and update src/engine/prereqDepth.js, or derive it — see this file's header.`);
});

test("calibration › the four-course full term is still what departments do", () => {
  const full = PLANS.flatMap(terms => terms.filter(t => !t.half));
  const withFour = share(full, (t) => {
    const big = t.named.filter(id => (courseMap[id]?.sh ?? 4) >= REAL_COURSE_SH).length;
    return big + t.labels.length >= FULL_TERM_MIN_COURSES;
  });
  // Measured at 97.7% when the rule was adopted. Below 0.85 it is no longer a convention
  // strong enough to enforce as a bound, and CHART would be refusing degrees over a habit
  // their own departments had abandoned.
  assert.ok(withFour >= 0.85,
    `only ${(100 * withFour).toFixed(1)}% of published full terms carry ${FULL_TERM_MIN_COURSES}+ `
    + `courses (was 97.7%). FULL_TERM_MIN_COURSES may no longer describe the corpus.`);
});

test("calibration › SAME_REQ_PER_TERM is still the p90 of one requirement per term", () => {
  const counts = [];
  for (const terms of PLANS) {
    for (const t of terms) {
      const byLabel = new Map();
      for (const l of t.labels) byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
      counts.push(Math.max(0, ...byLabel.values()));
    }
  }
  const sorted = counts.sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  // The bound is a preference ordered around, so what matters is that it is not now BELOW
  // what departments routinely do — that would make CHART spread cells the corpus stacks.
  assert.ok(p90 <= SAME_REQ_PER_TERM + 1,
    `published p90 for cells of one requirement in a term is ${p90}, `
    + `but SAME_REQ_PER_TERM is ${SAME_REQ_PER_TERM} — the target may be too tight now.`);
});
