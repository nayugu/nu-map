#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DERIVE PLAN ORDER — prerequisites the catalog forgot to record
//
// MATH 1341, MATH 1342 and MATH 2321 are Calculus 1, 2 and 3. Anyone who has
// taken them knows the order. The catalog's `prereqs` field for MATH 1341 and
// MATH 2321 is EMPTY, so nothing in our data stops a generated plan putting
// Calculus 3 first — and a plan that did would be wrong in a way a student would
// notice immediately and an advisor would never sign.
//
// The 678 published Sample Plans of Study know the answer. Across 61 programs
// that place both, MATH 1341 comes before MATH 1342 187 times and after it never.
// This script turns that agreement into edges CHART can use, and writes them to
// `public/northeastern/plan-order.json`.
//
// ── The whole difficulty is that agreement is not causation ─────────
//
// 29,385 pairs of courses co-occur in published plans and 5,352 of them are
// unanimously ordered. Almost none of those are prerequisites. `CS 1800` precedes
// `CS 1210` in 49 programs because CS 1210 is a second-year professional
// development seminar, not because it needs discrete mathematics. `CS 2101`
// "precedes" `CS 2100` in a handful of plans and shares a term with it in 96 —
// they are corequisites, and asserting an order between them would forbid the very
// arrangement every department prints.
//
// So five filters, each measured, cutting 5,352 to 227:
//
//   unanimous          no published plan ever reverses the pair
//   rarely same-term   ≤5% of observations share a term. A corequisite pair shares
//                      one constantly (CS 2101/CS 2100: 50%); a real prerequisite
//                      essentially never does (MATH 1342/2321: 0.6%, one sloppy
//                      plan out of 167). Requiring exactly zero was too strict and
//                      dropped the calculus sequence
//   same subject       all 3 pairs where the plans contradict a recorded catalog
//                      prereq are cross-subject (PHYS before MATH 2321)
//   ascending number   kills `CS 1800 → CS 1210` and 16 more like it
//   GAP ONLY           the successor's catalog prereqs name NO course in this
//                      subject. We fill silence; we never second-guess a stated
//                      opinion. This is why MATH 1341 → MATH 1342 is absent — the
//                      catalog does record that one
//
// Support of ≥5 distinct programs throughout, so one department's habit is not
// evidence.
//
// ── What this is, and is not ───────────────────────────────────────
//
// It is EVIDENCE, not a fact, and it is labelled as such: every edge carries its
// support so a reader can weigh it, and CHART reports which of a plan's orderings
// rest on it. It only ever ADDS a constraint, so the failure mode is a course
// scheduled later than strictly necessary — never a course scheduled too early,
// which is the failure that matters.
//
// Usage:  node scripts/derive-plan-order.js [--write]
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import { foldPrereqTree } from "../src/core/prereqFold.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/northeastern/plan-order.json");

/** ≤ this share of observations may put the pair in the same term. */
const MAX_SAME_TERM_SHARE = 0.05;
/** Distinct programs that must agree before a pair is believed. */
const MIN_PROGRAMS = 5;

const { courseMap } = loadCatalog();

// ── Read every published plan as an ordered list of terms ───────────

function publishedPlans() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const program of readdirSync(cd)) {
        const f = join(cd, program, "plan.json");
        if (!existsSync(f)) continue;
        for (const plan of JSON.parse(readFileSync(f, "utf8")).plans ?? []) {
          const terms = [];
          for (const year of plan.years ?? []) {
            for (const term of year.terms ?? []) {
              const named = [];
              let coop = false;
              const walk = (entries) => {
                for (const e of entries ?? []) {
                  if (e.coop) { coop = true; walk(e.children); continue; }
                  if (e.vacation || e.heading || e.either) { walk(e.children); continue; }
                  // Only cells the plan DECIDES. A choice tells us nothing about
                  // which course was actually placed.
                  if (e.options?.length === 1) named.push(...e.options[0]);
                  walk(e.children);
                }
              };
              walk(term.entries);
              terms.push({ named, coop });
            }
          }
          out.push({ program, terms });
        }
      }
    }
  }
  return out;
}

// ── Count observed order for every co-occurring pair ────────────────

function observe(plans) {
  const pairs = new Map();
  for (const plan of plans) {
    // A course's FIRST appearance is its position; a repeated course would
    // otherwise order itself.
    const at = new Map();
    plan.terms.forEach((t, i) => { for (const id of t.named) if (!at.has(id)) at.set(id, i); });
    const ids = [...at.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const key = `${a}|${b}`;
        let r = pairs.get(key);
        if (!r) { r = { ab: 0, ba: 0, same: 0, programs: new Set() }; pairs.set(key, r); }
        const ta = at.get(a), tb = at.get(b);
        if (ta === tb) r.same++;
        else if (ta < tb) r.ab++;
        else r.ba++;
        r.programs.add(plan.program);
      }
    }
  }
  return pairs;
}

/** Subjects a course's catalog prereqs mention. */
function prereqSubjects(id) {
  const out = new Set();
  foldPrereqTree(courseMap[id]?.prereqs, {
    or: () => 1, and: () => 1, note: () => 1,
    course: (tok) => { out.add(String(tok.subject).toUpperCase()); return 1; },
  });
  return out;
}

const numberOf = (id) =>
  parseInt(String(courseMap[id]?.number ?? "").replace(/\D/g, ""), 10);

// ── Filter ──────────────────────────────────────────────────────────

function derive(pairs) {
  const stages = { coOccurring: pairs.size, supported: 0, unanimous: 0,
                   rarelySameTerm: 0, sameSubject: 0, ascending: 0, gapOnly: 0 };
  const edges = [];

  for (const [key, r] of pairs) {
    const [x, y] = key.split("|");
    if (r.programs.size < MIN_PROGRAMS) continue;
    stages.supported++;

    const strict = r.ab + r.ba;
    if (!strict || (r.ab && r.ba)) continue;
    stages.unanimous++;

    if (r.same / (strict + r.same) > MAX_SAME_TERM_SHARE) continue;
    stages.rarelySameTerm++;

    const [before, after] = r.ab ? [x, y] : [y, x];
    const subject = courseMap[before]?.subject;
    if (!subject || subject !== courseMap[after]?.subject) continue;
    stages.sameSubject++;

    if (!(numberOf(before) < numberOf(after))) continue;
    stages.ascending++;

    if (prereqSubjects(after).has(subject)) continue;
    stages.gapOnly++;

    edges.push({ before, after, programs: r.programs.size,
                 observations: strict, sameTerm: r.same });
  }

  // Sorted, so the committed file is reviewable and a re-run produces no
  // spurious diff.
  edges.sort((a, b) =>
    a.before.localeCompare(b.before) || a.after.localeCompare(b.after));
  return { edges, stages };
}

// ── Report and write ────────────────────────────────────────────────

const plans = publishedPlans();
const pairs = observe(plans);
const { edges, stages } = derive(pairs);

console.log(`published plans read:        ${plans.length}`);
console.log(`co-occurring course pairs:   ${stages.coOccurring.toLocaleString()}`);
console.log(`\nsurvivors after each filter:`);
for (const [k, v] of Object.entries(stages)) {
  if (k === "coOccurring") continue;
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(7)}`);
}

const bySubject = new Map();
for (const e of edges) {
  const s = courseMap[e.before].subject;
  bySubject.set(s, (bySubject.get(s) ?? 0) + 1);
}
console.log(`\ninferred edges: ${edges.length}, across ${bySubject.size} subjects`);
console.log("  " + [...bySubject].sort((a, b) => b[1] - a[1]).slice(0, 14)
  .map(([s, n]) => `${s} ${n}`).join("  "));

// The pairs this exists for. A regression here is the one that matters.
console.log(`\nthe calculus sequence:`);
for (const [a, b] of [["MATH1341", "MATH1342"], ["MATH1342", "MATH2321"],
                      ["MATH1341", "MATH2321"], ["MATH1342", "MATH2341"]]) {
  const e = edges.find(x => x.before === a && x.after === b);
  const known = prereqSubjects(b).has("MATH");
  console.log(`  ${a} -> ${b}: ${e ? `inferred (${e.programs} programs)`
    : known ? "already in the catalog" : "NOT COVERED"}`);
}

// Upstream breakage guard, the same principle as fetch-nupath's 5% rule: a scrape
// that lost the plans would silently empty this file.
if (plans.length < 500) {
  console.error(`\nREFUSING TO WRITE: only ${plans.length} published plans found (expected ~678). ` +
                `Either the plan scrape is broken or the data moved.`);
  process.exit(1);
}
if (edges.length < 100) {
  console.error(`\nREFUSING TO WRITE: only ${edges.length} edges derived (expected ~227). ` +
                `A filter or the catalog's prereq coverage changed materially.`);
  process.exit(1);
}

// ── Co-op preparation: a requirement the catalog never states ───────
//
// Northeastern requires a professional-development course before a student may go on
// co-op. `ENCP 2000`, `CS 1210`, `EEAM 2000`, `HSCI 2000` and their siblings are that
// course for each college — and NOTHING in the catalog records the dependency, because
// the co-op is not a course and cannot have a prerequisite.
//
// The plans record it unanimously. Measured: every one of these appears BEFORE the
// first co-op in 100% of the plans that contain both, typically exactly two terms
// before. CHART duly put CS 1210 after the co-op it is meant to prepare for.
//
// Identified by two things together, because neither alone is enough: the course text
// mentions co-op or professional development, AND the plans never once place it after
// the first work term. The text alone would catch `MEIE 4702`, a senior capstone that
// discusses co-op experience and belongs at the END (measured 0% before).
function coopPrep(plans) {
  const seen = new Map();
  for (const plan of plans) {
    const first = plan.terms.findIndex(t => t.coop);
    if (first < 0) continue;
    plan.terms.forEach((t, i) => {
      if (t.coop) return;
      for (const id of t.named) {
        const text = `${courseMap[id]?.title ?? ""} ${courseMap[id]?.desc ?? ""}`;
        if (!/co-?op|cooperative education|professional development/i.test(text)) continue;
        if (!seen.has(id)) seen.set(id, { before: 0, after: 0 });
        seen.get(id)[i < first ? "before" : "after"] += 1;
      }
    });
  }
  return [...seen.entries()]
    .filter(([, v]) => v.after === 0 && v.before >= MIN_PROGRAMS)
    .map(([id, v]) => ({ course: id, observations: v.before }))
    .sort((a, b) => a.course.localeCompare(b.course));
}

/**
 * Where each course SITS, as a fraction through the plan — the departments' own convention.
 *
 * ── Why this is a floor and not a target ────────────────────────────
 *
 * The engine already has a position convention, `LEVEL_POSITION`, and it is a median over every
 * course of a level band. That is too coarse for the courses it matters most for. `ENGW 3302`
 * is 3000-level, so the band says 0.64 — and the departments that place it put it at 0.78. The
 * band permits year two; the course itself says year three or four, and the difference is a
 * plan that puts advanced writing before the first co-op.
 *
 * Measured, leave-one-PROGRAM-out over 11,325 held-out placements: the per-course median
 * predicts position at MAE 0.071 against the band's 0.128.
 *
 * It is emitted so a placement can be REFUSED for being in front of it, never so a placement can
 * be chosen by it. That distinction is the whole licence for using this corpus at all — these
 * same plans violate prerequisite order in 7.7% of cases and season in 31.9%, which is what
 * CHART exists to beat. A witness can prove we got something wrong; it cannot tell us what to
 * do. Same stance CLAUDE.md already takes on the Sample Plan of Study, applied to ordering
 * rather than to content.
 *
 * `MIN_PROGRAMS` support throughout, exactly as the edges use, so one department's habit is not
 * evidence. Positions are counted over ALL terms including co-op ones, and a course's FIRST
 * appearance is its position — a repeated course would otherwise average against itself.
 */
function coursePositions(plans) {
  const at = new Map();
  for (const plan of plans) {
    const n = plan.terms.length;
    if (n < 2) continue;
    const seen = new Set();
    plan.terms.forEach((t, i) => {
      for (const id of t.named) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!at.has(id)) at.set(id, []);
        at.get(id).push({ pos: i / (n - 1), program: plan.program });
      }
    });
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
  const out = {};
  for (const [id, xs] of [...at.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const programs = new Set(xs.map(x => x.program)).size;
    if (programs < MIN_PROGRAMS) continue;
    out[id] = { at: +med(xs.map(x => x.pos)).toFixed(3), programs };
  }
  return out;
}

const prep = coopPrep(plans);
console.log(`\nco-op preparation courses (always before the first co-op): ${prep.length}`);
console.log("  " + prep.map(p => `${p.course}(${p.observations})`).join("  "));

const positions = coursePositions(plans);
console.log(`\ncourses with a believed position (>=${MIN_PROGRAMS} programs): ${Object.keys(positions).length}`);

const doc = {
  generated: new Date().toISOString().slice(0, 10),
  coopPrep: prep,
  // Where departments put each course, as a FLOOR the engine may refuse a placement against —
  // never a target it may aim at. See `coursePositions`.
  positions,
  source: "published Sample Plans of Study",
  plans: plans.length,
  filters: { minPrograms: MIN_PROGRAMS, maxSameTermShare: MAX_SAME_TERM_SHARE,
             unanimous: true, sameSubject: true, ascendingNumber: true,
             onlyWhereCatalogSilent: true },
  edges,
};

if (process.argv.includes("--write")) {
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
  console.log(`\nwrote ${OUT}`);
} else {
  console.log(`\n(dry run — pass --write to update ${OUT})`);
}
