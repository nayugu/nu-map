// INVARIANT · the order derived from published plans is believable, and it still
// covers the sequences it was built for.
//
// `plan-order.json` supplies prerequisites the catalog does not record —
// MATH 2321's prereq field is EMPTY, so without this nothing stops a generated plan
// putting Calculus 3 first. It is EVIDENCE rather than fact, so what it must never
// do is drift into asserting things the plans do not actually show.
//
// Regenerate with: node scripts/derive-plan-order.js --write
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import { foldPrereqTree } from "../../src/core/prereqFold.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const doc = JSON.parse(readFileSync(join(ROOT, "public/northeastern/plan-order.json"), "utf8"));
const { courseMap } = loadCatalog();

test("plan-order › the file is shaped as the engine expects", () => {
  assert.ok(Array.isArray(doc.edges) && doc.edges.length > 100,
    `expected ~227 edges, found ${doc.edges?.length}`);
  for (const e of doc.edges) {
    assert.equal(typeof e.before, "string");
    assert.equal(typeof e.after, "string");
    assert.ok(e.programs >= 5, `${e.before}->${e.after} has only ${e.programs} programs of support`);
    assert.ok(e.observations >= 1);
  }
});

test("plan-order › every edge names two courses the catalog still has", () => {
  // A renumbered course would make an edge unenforceable, and a stale file is
  // exactly what a monthly re-scrape produces if nobody regenerates this.
  const missing = doc.edges.filter(e => !courseMap[e.before] || !courseMap[e.after]);
  assert.deepEqual(missing.slice(0, 6), [],
    `${missing.length} edges name a course the catalog no longer has — regenerate`);
});

test("plan-order › no edge points backwards within a subject", () => {
  const num = (id) => parseInt(String(courseMap[id]?.number ?? "").replace(/\D/g, ""), 10);
  const bad = doc.edges.filter(e => num(e.before) >= num(e.after));
  assert.deepEqual(bad.slice(0, 6), [], `${bad.length} descending edges`);
});

test("plan-order › every edge stays inside one subject", () => {
  // All three pairs where the plans contradict a recorded catalog prereq are
  // cross-subject, so this is the filter keeping the file honest.
  const bad = doc.edges.filter(e =>
    courseMap[e.before]?.subject !== courseMap[e.after]?.subject);
  assert.deepEqual(bad.slice(0, 6), [], `${bad.length} cross-subject edges`);
});

test("plan-order › no edge duplicates or contradicts a catalog prereq", () => {
  const refs = (id) => {
    const out = new Set();
    foldPrereqTree(courseMap[id]?.prereqs, {
      or: () => 1, and: () => 1, note: () => 1,
      course: (t) => { out.add(`${String(t.subject).toUpperCase()}${t.number}`); return 1; },
    });
    return out;
  };
  const redundant = doc.edges.filter(e => refs(e.after).has(e.before));
  const reversed  = doc.edges.filter(e => refs(e.before).has(e.after));
  assert.deepEqual(redundant.slice(0, 6), [],
    `${redundant.length} edges the catalog already records — the gap-only filter slipped`);
  assert.deepEqual(reversed.slice(0, 6), [],
    `${reversed.length} edges the catalog orders the OTHER WAY`);
});

test("plan-order › the derivation is acyclic", () => {
  // A cycle would make two courses mutually unplaceable. The ascending-number
  // filter should make this impossible; asserted because "should" is not "does".
  const next = new Map();
  for (const e of doc.edges) {
    if (!next.has(e.before)) next.set(e.before, []);
    next.get(e.before).push(e.after);
  }
  const state = new Map();
  const walk = (id) => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "open") return true;
    state.set(id, "open");
    for (const n of next.get(id) ?? []) if (walk(n)) return true;
    state.set(id, "done");
    return false;
  };
  for (const id of next.keys()) assert.equal(walk(id), false, `cycle through ${id}`);
});

test("plan-order › the sequences it exists for are still covered", () => {
  // The motivating case. MATH 1341 -> 1342 is deliberately absent: the catalog
  // records that one, so the gap-only filter skips it.
  const has = (a, b) => doc.edges.some(e => e.before === a && e.after === b);
  for (const [a, b] of [["MATH1342", "MATH2321"], ["MATH1341", "MATH2321"],
                        ["MATH1342", "MATH2341"], ["MATH1341", "MATH2341"]]) {
    assert.ok(has(a, b), `lost the inferred edge ${a} -> ${b}`);
  }
  assert.equal(has("MATH1341", "MATH1342"), false,
    "MATH 1341 -> 1342 is recorded by the catalog and must not be duplicated here");
});

test("plan-order › the claimed support is real", () => {
  // Re-derive a sample of the counts straight from the plan files, so a file
  // hand-edited or generated by a changed script cannot claim agreement it does
  // not have.
  const plans = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const program of readdirSync(cd)) {
        const f = join(cd, program, "plan.json");
        if (!existsSync(f)) continue;
        for (const pl of JSON.parse(readFileSync(f, "utf8")).plans ?? []) {
          const terms = [];
          for (const y of pl.years ?? []) for (const t of y.terms ?? []) {
            const named = [];
            const walk = (es) => { for (const e of es ?? []) {
              if (e.coop || e.vacation || e.heading || e.either) { walk(e.children); continue; }
              if (e.options?.length === 1) named.push(...e.options[0]);
              walk(e.children);
            } };
            walk(t.entries);
            terms.push(named);
          }
          plans.push({ program, terms });
        }
      }
    }
  }
  assert.ok(plans.length > 500, `expected ~678 published plans, read ${plans.length}`);

  // Every edge in the file must be unanimous in the plans. Checked on all of them:
  // it is the one property the whole idea rests on.
  const bad = [];
  for (const e of doc.edges) {
    let fwd = 0, rev = 0, same = 0;
    for (const pl of plans) {
      let ta = -1, tb = -1;
      pl.terms.forEach((ids, i) => {
        if (ta < 0 && ids.includes(e.before)) ta = i;
        if (tb < 0 && ids.includes(e.after)) tb = i;
      });
      if (ta < 0 || tb < 0) continue;
      if (ta === tb) same++; else if (ta < tb) fwd++; else rev++;
    }
    if (rev > 0) bad.push(`${e.before} -> ${e.after}: ${rev} plans put them the other way`);
    else if (!fwd) bad.push(`${e.before} -> ${e.after}: never actually observed`);
    else if (same / (fwd + rev + same) > 0.05) {
      bad.push(`${e.before} -> ${e.after}: ${same}/${fwd + same} share a term — a corequisite, not a sequence`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} edges the plans do not support`);
});
