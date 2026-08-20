// ═══════════════════════════════════════════════════════════════════
// CORPUS SNAPSHOT — pay for the sweep once, then ask questions for free
//
// ── The problem this exists for ─────────────────────────────────────
//
// The expensive verifications in this project are not the committed ones. They are the
// scripts written inline to answer one question — `verify-attr` for the designation
// change, and the three throwaway sweeps that chased one empty-term regression
// (docs/chart-success-criteria.md). Each cost minutes to tens of minutes, and each was
// deleted afterwards, so the next question paid again.
//
// The instinct is that this cannot be fixed because an ad-hoc script is by definition not
// in the codebase. That is the wrong diagnosis. Nothing about the QUESTION is slow —
// "where do WD-designated courses land?" is five lines and a loop. What is slow is
// regenerating 1,078 plans to have something to ask it OF, and that part is identical
// every single time.
//
// So the expensive half becomes a file, and the ad-hoc half stays ad-hoc:
//
//     node scripts/verify-chart.js --all --snapshot .cache/corpus.json   # once, ~10 min
//     node scripts/corpus-ask.js --js 'plans.filter(p => ...)'           # thereafter, ~1 s
//
// The second, third and fourth question then cost nothing, which is the actual failure
// this addresses: three hypotheses about one regression each took a full corpus run to
// disprove, and all three were asking about the same plans.
//
// ── Why not a warm daemon ───────────────────────────────────────────
//
// Considered and rejected on a measurement. Keeping the catalog resident saves **364 ms**
// — `loadCatalog` for 7,966 courses — which is nothing, and it is the number that killed
// the old "throwaway scripts reload the catalog" complaint too. The expensive resident
// state would be the generated PLANS, and a file holds those better than a process does:
// it survives the session, it can be diffed against another one, and it can be copied to
// compare a colleague's run. A daemon would also die between sessions, which is exactly
// when you want yesterday's baseline.
//
// ── Staleness is the whole risk ─────────────────────────────────────
//
// A snapshot answering questions about code you have since changed is worse than no
// snapshot: it is confidently wrong, which is the failure mode this project is organised
// against. So provenance is recorded on write and CHECKED on read, and a mismatch prints
// a loud banner rather than a note. It does not refuse — a stale snapshot is still the
// right baseline for a before/after — but it can never be mistaken for current.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * Fingerprint of the code that produces plans.
 *
 * Hashes the SOURCE of the engine and the core, not the git SHA, because the question is
 * "would a re-run produce this?" and an uncommitted edit changes that answer while the SHA
 * does not. The SHA is recorded too, separately, because it is what a human recognises.
 */
export function codeHash(root) {
  const h = createHash("sha1");
  for (const dir of ["src/engine", "src/core"]) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    const walk = (d) => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith(".js")) h.update(e).update(readFileSync(p));
      }
    };
    walk(base);
  }
  return h.digest("hex").slice(0, 16);
}

/** Fingerprint of the DATA. A monthly scrape moves plans with no code change at all. */
export function dataHash(root) {
  const h = createHash("sha1");
  const catalog = join(root, "public/northeastern/catalog-courses.json");
  if (existsSync(catalog)) h.update(readFileSync(catalog));
  // Program requirements, by mtime+size rather than content: there are ~1,450 files and
  // hashing them all costs more than the snapshot is worth. A scrape rewrites them, so
  // mtime moves; that is enough to invalidate.
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(root, "data/northeastern/programs", lvl, "2026");
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base).sort()) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const key of readdirSync(cd).sort()) {
        const rf = join(cd, key, "requirements.json");
        if (!existsSync(rf)) continue;
        const s = statSync(rf);
        h.update(key).update(String(s.size)).update(String(Math.floor(s.mtimeMs)));
      }
    }
  }
  return h.digest("hex").slice(0, 16);
}

export function provenance(root) {
  let sha = "unknown", dirty = false;
  try {
    sha = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    dirty = execSync("git status --porcelain", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim().length > 0;
  } catch { /* not a checkout; the hashes below still work */ }
  return { at: new Date().toISOString(), sha, dirty, code: codeHash(root), data: dataHash(root) };
}

/**
 * A plan in a shape a question can be asked of.
 *
 * `canonicalPlan` already exists and is a STRING — right for hashing and diffing, wrong for
 * querying, because every question then starts by re-parsing lines with a regex. This keeps
 * the same information as data. It is intentionally flat: `cells` carries the term it is in,
 * so the common question ("where does X land?") is one `.filter`, not three nested loops.
 */
export function structurePlan(plan) {
  const terms = [];
  const cells = [];
  let index = 0;
  for (const year of plan?.years ?? []) {
    for (const t of year.terms ?? []) {
      const term = {
        index: index++, year: year.label ?? "", term: t.term ?? "", type: t.type ?? "",
        cells: [],
      };
      const walk = (entries, depth) => {
        for (const e of entries ?? []) {
          const cell = {
            kind: e.coop ? "COOP" : e.vacation ? "VAC" : e.heading ? "HEAD" : "CELL",
            text: e.text ?? "", sh: e.sh ?? 0, depth,
            // Flattened course ids: an `options` group is an OR over AND-groups, and almost
            // every question ("is BIOL 2299 scheduled here?") wants membership, not structure.
            courses: [...new Set((e.options ?? []).flat())],
            options: (e.options ?? []).map(g => [...g].sort()),
            termIndex: term.index, termType: term.type, year: term.year,
          };
          term.cells.push(cell);
          cells.push(cell);
          walk(e.children, depth + 1);
        }
      };
      walk(t.entries, 0);
      terms.push(term);
    }
  }
  return { terms, cells, termCount: terms.length };
}

export function writeSnapshot(path, { root, plans, meta = {} }) {
  writeFileSync(path, JSON.stringify({
    meta: { ...meta, ...provenance(root), format: 1 }, plans,
  }));
  return path;
}

/**
 * Read a snapshot and say plainly whether it still describes this working tree.
 *
 * Returns `{ meta, plans, stale, why }`. `stale` is advisory — a before/after comparison
 * WANTS the old one — but it is printed loudly by `corpus-ask.js` so a number can never be
 * quoted off a snapshot that predates the change it is supposed to be measuring.
 */
export function readSnapshot(path, root) {
  const snap = JSON.parse(readFileSync(path, "utf8"));
  const now = provenance(root);
  const why = [];
  if (snap.meta?.code !== now.code) why.push("the ENGINE has changed since this was taken");
  if (snap.meta?.data !== now.data) why.push("the DATA has changed since this was taken");
  if (snap.meta?.dirty) why.push("it was taken with uncommitted changes in the tree");
  return { ...snap, stale: why.length > 0, why, now };
}

/** `label → structured plan` flattened to one array, with the label on every plan. */
export function planList(snap) {
  return Object.entries(snap.plans ?? {}).map(([label, v]) => ({
    label, ...(v.plan ?? {}), hash: v.hash, canonical: v.canonical,
  }));
}

// ── The query vocabulary ────────────────────────────────────────────
//
// Deliberately small. These are the four shapes every ad-hoc plan question in this repo's
// history has actually been — "does X appear", "where does X sit", "which terms look like
// this", "what moved" — and having them named is what turns a 60-line throwaway script into
// one line. Anything more specific belongs in the `--js` expression, not here.

/** Plans scheduling `courseId` anywhere. */
export const plansWith = (plans, courseId) =>
  plans.filter(p => (p.cells ?? []).some(c => c.courses.includes(courseId)));

/**
 * Where `courseId` lands, as a fraction of the plan's length, per plan.
 *
 * Fractional rather than absolute because plans differ in length — a 5-year co-op degree and
 * a 2-year master's cannot be compared on term index, and comparing them anyway is how a
 * position claim gets quoted wrongly.
 */
export const positionsOf = (plans, courseId) => plansWith(plans, courseId).map(p => {
  const cell = p.cells.find(c => c.courses.includes(courseId));
  return { label: p.label, termIndex: cell.termIndex, termType: cell.termType,
           at: p.termCount > 1 ? cell.termIndex / (p.termCount - 1) : 0 };
});

/** Every term across every plan satisfying `pred(term, plan)`. */
export const termsWhere = (plans, pred) =>
  plans.flatMap(p => (p.terms ?? []).filter(t => pred(t, p)).map(t => ({ label: p.label, ...t })));

/** Every cell across every plan satisfying `pred(cell, plan)`. */
export const cellsWhere = (plans, pred) =>
  plans.flatMap(p => (p.cells ?? []).filter(c => pred(c, p)).map(c => ({ label: p.label, ...c })));

/**
 * Labels whose plan differs between two snapshots, plus what appeared and vanished.
 *
 * `chart-fingerprint-diff` answers "what moved" from hashes; this answers "what moved AND
 * how" without re-running anything, which is the follow-up question that used to cost a
 * second full sweep.
 */
export function diffSnapshots(before, after) {
  const a = new Map(planList(before).map(p => [p.label, p]));
  const b = new Map(planList(after).map(p => [p.label, p]));
  const out = { moved: [], gained: [], lost: [], same: 0 };
  for (const [label, bp] of b) {
    const ap = a.get(label);
    if (!ap) { out.gained.push(label); continue; }
    if (ap.hash === bp.hash) { out.same++; continue; }
    const ids = (p) => new Set((p.cells ?? []).flatMap(c => c.courses));
    const before_ = ids(ap), after_ = ids(bp);
    out.moved.push({
      label,
      appeared: [...after_].filter(x => !before_.has(x)),
      vanished: [...before_].filter(x => !after_.has(x)),
    });
  }
  for (const label of a.keys()) if (!b.has(label)) out.lost.push(label);
  return out;
}
