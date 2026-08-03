#!/usr/bin/env node
/**
 * build-equivalences.js — derive the course-equivalence index.
 *
 * Reads the committed corpus (never the network) and writes
 * `public/northeastern/course-equivalences.json`, the index behind "what can I
 * take instead of X?" and behind substitution offers.
 *
 * All judgement lives in `scripts/lib/equivalence.js`, which is pure and
 * dependency-free so `test/invariant/` can import it under a job that runs
 * with no `npm install`. This file only gathers evidence and writes files.
 *
 * ## Inputs (all committed, so a run is reproducible)
 *
 *   public/northeastern/catalog-courses.json   titles, credits, descriptions,
 *                                             nuPath, parsed prereq trees
 *   src/data/majors/**\/parsed.initial.json     OR / XOM requirement nodes
 *   src/data/grad-majors/**\/parsed.initial.json
 *
 * ## Usage
 *
 *   node scripts/build-equivalences.js            # report only, writes nothing
 *   node scripts/build-equivalences.js --write     # write the index
 *   node scripts/build-equivalences.js --explain "PHYS 1151"
 *
 * ## Write rail
 *
 * Like `fetch-nupath`'s 5% mass-clear rule and the scrapers' corpus rails, this
 * refuses to write when the result looks like upstream breakage rather than
 * data drift — see `RAILS` below. It runs unattended in the monthly job and
 * pushes straight to main, so a silent collapse to an empty index is the
 * failure mode worth guarding.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classifyPair, comparePairs, pairKey, parseStatedEquivalences,
  jaccard, stemContainment, companionParent, courseRole, roleSlot,
  MAX_CROSSLIST_CLUSTER, TIER_C_MIN_EVIDENCE,
} from "./lib/equivalence.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COURSES = join(ROOT, "public/northeastern/catalog-courses.json");
const OUT = join(ROOT, "public/northeastern/course-equivalences.json");
const PROGRAM_ROOTS = ["src/data/majors", "src/data/grad-majors"];

/** Refuse to write if any of these trip. */
const RAILS = {
  minProgramBacked: 2000, // measured 3,525 — a collapse means the OR walk broke
  minTierB: 80,           // measured 181 cross-listings
  minPairs: 2500,         // total emitted
  minPrograms: 800,       // measured 1,017 program files
  minCourses: 5000,       // measured 7,966
};

const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const idOf = c => `${c.subject} ${c.number}`;

// ═══════════════════════════════════════════════════════════════════
// Gather
// ═══════════════════════════════════════════════════════════════════

function programFiles() {
  const out = [];
  for (const r of PROGRAM_ROOTS) {
    const abs = join(ROOT, r);
    if (!existsSync(abs)) continue;
    (function walk(d) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e === "parsed.initial.json") out.push(p);
      }
    })(abs);
  }
  return out;
}

/** Every course id mentioned anywhere in a prereq token array. */
function prereqLeaves(tokens, out = []) {
  for (const t of tokens) {
    if (Array.isArray(t)) prereqLeaves(t, out);
    else if (t && typeof t === "object" && t.subject) out.push(`${t.subject} ${t.number}`);
  }
  return out;
}

/**
 * Sibling OR groups in a prereq tree.
 *
 * The parsed form is a flat token array with "(" / ")" / "And" / "Or", so a
 * group counts only when every operator at that nesting level is "Or" —
 * otherwise `A And (B Or C)` would wrongly yield `A ⇄ B`.
 */
function prereqOrGroups(tokens) {
  const groups = [];
  (function walk(toks) {
    const items = [];
    let depth = 0, buf = [], ops = [];
    for (const t of toks) {
      if (t === "(") { depth++; if (depth === 1) { buf = []; continue; } }
      if (t === ")") { depth--; if (depth === 0) { items.push({ nested: buf }); continue; } }
      if (depth > 0) { buf.push(t); continue; }
      if (t === "And" || t === "Or") { ops.push(t); continue; }
      if (t && typeof t === "object" && t.subject) items.push({ leaf: `${t.subject} ${t.number}` });
    }
    if (ops.length && ops.every(o => o === "Or")) {
      const leaves = [...new Set(items.filter(i => i.leaf).map(i => i.leaf))];
      if (leaves.length >= 2) groups.push(leaves);
    }
    for (const i of items) if (i.nested) walk(i.nested);
  })(tokens);
  return groups;
}

/** All-COURSE OR/XOM groups inside one program's requirement tree. */
function programChoiceGroups(sections) {
  const groups = [];
  (function scan(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(scan);
    if (n.type === "OR" || n.type === "XOM") {
      const kids = n.courses ?? [];
      const codes = kids.filter(k => k?.type === "COURSE").map(k => `${k.subject} ${k.classId}`);
      // Only a group made *entirely* of concrete courses is a course choice.
      // A group mixing in RANGE/SECTION nodes is a pool ("any 4000-level CS"),
      // where membership does not imply the members are interchangeable.
      if (kids.length >= 2 && codes.length === kids.length && codes.length <= 6) {
        groups.push([...new Set(codes)]);
      }
    }
    for (const k of Object.keys(n)) if (typeof n[k] === "object") scan(n[k]);
  })(sections);
  return groups;
}

// ═══════════════════════════════════════════════════════════════════
// Build
// ═══════════════════════════════════════════════════════════════════

function build() {
  const courses = JSON.parse(readFileSync(COURSES, "utf8"));
  const titleOf = {}, creditsOf = {}, nuPathOf = {}, descOf = {};
  for (const c of courses) {
    const id = idOf(c);
    titleOf[id] = c.title ?? "";
    creditsOf[id] = Number.isFinite(c.credits) ? c.credits : null;
    nuPathOf[id] = new Set(c.nuPath ?? []);
    descOf[id] = norm(c.description);
  }

  // ── signal 4 + gate sets + prereq edges ───────────────────────────
  const prereqOr = new Map();      // pairKey -> Set of downstream course ids
  const gates = new Map();         // course -> Set of courses it gates
  const prereqEdges = new Set();   // "A→B" = A is a prerequisite of B
  for (const c of courses) {
    if (!Array.isArray(c.prereqs)) continue;
    const id = idOf(c);
    for (const p of new Set(prereqLeaves(c.prereqs))) {
      prereqEdges.add(`${p}→${id}`);
      if (!gates.has(p)) gates.set(p, new Set());
      gates.get(p).add(id);
    }
    for (const g of prereqOrGroups(c.prereqs)) {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const k = pairKey(g[i], g[j]);
        if (!prereqOr.has(k)) prereqOr.set(k, new Set());
        prereqOr.get(k).add(id);
      }
    }
  }

  // ── signal 6: program-published choices ──────────────────────────
  const programPairs = new Map();  // pairKey -> Set of program slugs
  const files = programFiles();
  for (const f of files) {
    const slug = f.split("/").slice(-2, -1)[0];
    let j;
    try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    for (const g of programChoiceGroups(j.requirementSections)) {
      for (let i = 0; i < g.length; i++) for (let k = i + 1; k < g.length; k++) {
        const pk = pairKey(g[i], g[k]);
        if (!programPairs.has(pk)) programPairs.set(pk, new Set());
        programPairs.get(pk).add(slug);
      }
    }
  }

  // ── signal 1: stated equivalences ────────────────────────────────
  const stated = new Map();        // pairKey -> statement (+ direction)
  for (const c of courses) {
    const id = idOf(c);
    for (const s of parseStatedEquivalences(id, c.description)) {
      if (!titleOf[s.target]) continue;                    // target must exist
      const pk = pairKey(id, s.target);
      if (!stated.has(pk)) stated.set(pk, { ...s, from: id, to: s.target });
    }
  }

  // ── signal 3: cross-listing by identical description ─────────────
  const byDesc = new Map();
  for (const c of courses) {
    const d = descOf[idOf(c)];
    if (!d || d.length < 80) continue;
    const k = d.toLowerCase();
    if (!byDesc.has(k)) byDesc.set(k, []);
    byDesc.get(k).push(idOf(c));
  }
  const crossList = new Map();     // pairKey -> cluster size
  for (const ids of byDesc.values()) {
    if (ids.length < 2 || ids.length > MAX_CROSSLIST_CLUSTER) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      // Same text AND same title. Text alone catches renumbered shells whose
      // titles differ; requiring both keeps this to genuine cross-listings.
      if (norm(titleOf[ids[i]]) !== norm(titleOf[ids[j]])) continue;
      crossList.set(pairKey(ids[i], ids[j]), ids.length);
    }
  }

  // ── signal 5: parallel numbering (…01 / …09), a prior only ───────
  const numbering = new Set();
  for (const c of courses) {
    const n = parseInt(c.number, 10);
    if (!Number.isFinite(n) || n % 10 !== 9) continue;
    for (const delta of [8, 6]) {                          // …09↔…01 and …09↔…03
      const sib = `${c.subject} ${n - delta}`;
      if (titleOf[sib] && norm(titleOf[sib]) === norm(c.title)) numbering.add(pairKey(idOf(c), sib));
    }
  }

  // ── bundles: a lecture plus the companions that name it ───────────
  //
  // Read from companion titles ("Lab for PHYS 1151"), which is more reliable
  // than inferring from numbering — the units digit convention holds for the
  // science sequences but not universally.
  const companionsOf = new Map();    // parent id -> [companion ids]
  for (const c of courses) {
    const parent = companionParent(c.title);
    if (!parent || !titleOf[parent]) continue;
    if (!companionsOf.has(parent)) companionsOf.set(parent, []);
    companionsOf.get(parent).push(idOf(c));
  }
  const bundleCreditsOf = {};
  for (const id of Object.keys(titleOf)) {
    const own = Number.isFinite(creditsOf[id]) ? creditsOf[id] : 0;
    const kids = (companionsOf.get(id) ?? [])
      .reduce((s, k) => s + (Number.isFinite(creditsOf[k]) ? creditsOf[k] : 0), 0);
    bundleCreditsOf[id] = own + kids;
  }

  // ── classify every candidate ──────────────────────────────────────
  const candidates = new Set([
    ...prereqOr.keys(), ...programPairs.keys(), ...stated.keys(),
    ...crossList.keys(), ...numbering,
  ]);

  const ctx = { titleOf, creditsOf, prereqEdges, bundleCreditsOf };
  const rows = [];
  const byPair = new Map();
  for (const pk of candidates) {
    const [a, b] = pk.split("|");
    if (!titleOf[a] || !titleOf[b]) continue;              // unknown code
    const ev = {
      programs: programPairs.get(pk)?.size ?? 0,
      programSlugs: [...(programPairs.get(pk) ?? [])].sort(),
      prereqOr: prereqOr.get(pk)?.size ?? 0,
      stated: stated.get(pk) ?? null,
      crossListCluster: crossList.get(pk) ?? null,
      numbering: numbering.has(pk),
      gateOverlap: jaccard(gates.get(a), gates.get(b)),
      nuPathOverlap: jaccard(nuPathOf[a], nuPathOf[b]),
    };
    const res = classifyPair({ a, b }, ev, ctx);
    const row = { a, b, ...res, ev };
    rows.push(row);
    byPair.set(pk, row);
  }

  // ── propagate a lecture pair down its bundle ──────────────────────
  //
  // A proven lecture equivalence implies the component-by-component mapping
  // students actually need: PHYS 1161 → 1151 also means 1162 → 1152 (lab) and
  // 1163 → 1153 (recitation). Labs and recitations essentially never appear in
  // prereq `OR` groups or program choice tables, so nothing else reaches them —
  // without this, a substitution would silently strip a student's lab.
  //
  // Matching is by ROLE, not by numbering: parent titles give the pairing
  // directly, so a variant that has a recitation where the other has a seminar
  // still lines up.
  const derived = [];
  for (const row of rows) {
    if (row.tier === "D" && !row.programBacked) continue;
    const kidsA = companionsOf.get(row.a) ?? [];
    const kidsB = companionsOf.get(row.b) ?? [];
    if (!kidsA.length || !kidsB.length) continue;
    const used = new Set();
    for (const ka of kidsA) {
      const slotA = roleSlot(courseRole(titleOf[ka]));
      const kb = kidsB.find(x => !used.has(x) && roleSlot(courseRole(titleOf[x])) === slotA);
      if (!kb) continue;
      used.add(kb);
      const pk = pairKey(ka, kb);
      if (byPair.has(pk)) continue;                        // direct evidence wins
      const ev = {
        programs: 0, programSlugs: [], prereqOr: 0, stated: null,
        crossListCluster: null, numbering: false,
        gateOverlap: 0, nuPathOverlap: jaccard(nuPathOf[ka], nuPathOf[kb]),
        derivedFrom: `${row.a}|${row.b}`, derivedRole: slotA,
      };
      // Inherit the parent's tier — the bundle is not a weaker claim than the
      // lecture it belongs to — but never let a derived row outrank tier B,
      // since the parent's own evidence is what is really being cited.
      const res = classifyPair({ a: ka, b: kb }, ev, ctx);
      const tier = row.tier === "A" ? "A" : row.tier === "B" ? "B" : "C";
      derived.push({
        a: ka, b: kb, ...res, tier,
        score: Math.round(Math.max(0, row.score - 0.1) * 10) / 10,
        offer: true,
        approval: tier === "C",
        programBacked: row.programBacked,
        reasons: [`follows ${row.a} ⇄ ${row.b} (${slotA})`],
        ev: { ...ev, programSlugs: row.ev.programSlugs, programs: row.ev.programs },
      });
      byPair.set(pk, derived[derived.length - 1]);
    }
  }
  rows.push(...derived);

  rows.sort(comparePairs);
  return { rows, files, courses, titleOf, derivedCount: derived.length };
}

// ═══════════════════════════════════════════════════════════════════
// Emit
// ═══════════════════════════════════════════════════════════════════

/**
 * Compact wire format. The app indexes by course at load, so the file is a flat
 * list rather than a pre-built map — a map would repeat every pair twice.
 *
 * ## Tier A carries WHICH programs, not just how many
 *
 * Tier A means "a program publishes this choice", and that is only an answer
 * for a student *in* that program. `MATH 1241 ⇄ MATH 1341` is offered by 63
 * programs and is fair to describe as broadly accepted; `PHYS 1155 ⇄ PHYS 1165`
 * is offered by exactly **one**, and telling an unrelated major "your program
 * accepts either" would be false. So the slugs travel with the pair and the UI
 * decides its wording by checking membership against the active program.
 *
 * Slugs are interned into a lookup array and referenced by index: ~10,000
 * references at ~30 chars each would be 300 KB inline, versus roughly 65 KB
 * as one slug table plus integers.
 *
 * ## Tier D is deliberately not emitted
 *
 * It is the residue — weak or vetoed evidence, e.g. `LS 6101 ⇄ LS 6102`, a
 * course *sequence*. Presenting that as an alternative is worse than showing
 * nothing, and it would roughly double the payload for negative value.
 */
function toWire(rows, meta) {
  // Keep anything we can say something true about. A pair whose agnostic tier is
  // D but which a program publishes must still be emitted — for a student in
  // that program it is tier A, and dropping it would lose a fact.
  const keep = rows.filter(r => r.tier !== "D" || r.programBacked);

  // Intern program slugs in first-seen order.
  const slugIndex = new Map();
  const intern = slug => {
    if (!slugIndex.has(slug)) slugIndex.set(slug, slugIndex.size);
    return slugIndex.get(slug);
  };
  const pairs = keep.map(r => {
    const e = {};
    if (r.ev.programSlugs?.length) e.p = r.ev.programSlugs.map(intern).sort((x, y) => x - y);
    if (r.ev.prereqOr) e.q = r.ev.prereqOr;
    if (r.ev.crossListCluster) e.x = r.ev.crossListCluster;
    // `o` is the share of downstream courses the two unlock in common, as a
    // percent. A raw count of "N courses accept either" reads as a magnitude
    // when what matters is proportion — 12 of 14 is a strong signal, 12 of 200
    // is not, and the count alone cannot tell them apart.
    if (r.ev.gateOverlap > 0) e.o = Math.round(r.ev.gateOverlap * 100);
    // `f` links a derived companion row to the lecture pair it follows, so the
    // UI can present a bundle as ONE decision with a +N chip rather than as
    // three unrelated rows appearing at once.
    if (r.ev.derivedFrom) { e.f = r.ev.derivedFrom; e.r = r.ev.derivedRole; }
    if (r.ev.stated) {
      e.s = r.ev.stated.kind;
      if (r.ev.stated.directed) e.d = r.ev.stated.from;        // direction: from → to
      if (r.ev.stated.scope) e.sc = r.ev.stated.scope;
      if (r.ev.stated.excludes) e.ex = r.ev.stated.excludes;
    }
    return { a: r.a, b: r.b, t: r.tier, s: r.score, e };
  });

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: "Derived from the committed catalog corpus. Tier A is scoped to the " +
          "programs listed in `e.p`; tier C is inference and requires advisor " +
          "approval. See docs/substitutions-design.md.",
    tierCMinEvidence: TIER_C_MIN_EVIDENCE,
    counts: meta.counts,
    programs: [...slugIndex.keys()],
    pairs,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const explainAt = argv.indexOf("--explain");
  const explain = explainAt >= 0 ? argv[explainAt + 1] : null;

  const { rows, files, courses, titleOf, derivedCount } = build();
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of rows) counts[r.tier]++;

  console.log(`courses            ${courses.length}`);
  console.log(`program files      ${files.length}`);
  console.log(`candidate pairs    ${rows.length}  (${derivedCount} derived from bundles)`);
  const backed = rows.filter(r => r.programBacked).length;
  console.log(`\nProgram-agnostic tier — what a student NOT in a publishing program sees:`);
  console.log(`  A   ${String(counts.A).padStart(5)}  catalog states the equivalence outright`);
  console.log(`  B   ${String(counts.B).padStart(5)}  same course, two codes`);
  console.log(`  C   ${String(counts.C).padStart(5)}  commonly interchangeable (inference, needs approval)`);
  console.log(`  D   ${String(counts.D).padStart(5)}  related only`);
  console.log(`\n  ${backed} pairs are published by >=1 program, so they upgrade to tier A`);
  console.log(`  for students in those programs (resolveTier).`);

  if (explain) {
    const want = norm(explain).toUpperCase();
    const hits = rows.filter(r => r.a === want || r.b === want);
    console.log(`\n═══ ${want} — ${titleOf[want] ?? "?"} ═══`);
    if (!hits.length) console.log("  no candidates");
    for (const r of hits) {
      const other = r.a === want ? r.b : r.a;
      console.log(`  [${r.tier}] ${String(r.score).padStart(5)}  ${other}  ${titleOf[other] ?? "?"}`);
      for (const why of r.reasons) console.log(`             · ${why}`);
    }
  } else {
    console.log(`\n═══ tier A/B sample ═══`);
    for (const r of rows.filter(x => x.tier === "A" || x.tier === "B").slice(0, 10))
      console.log(`  [${r.tier}] ${String(r.score).padStart(5)}  ${r.a} ⇄ ${r.b}  — ${r.reasons[0]}`);
    console.log(`\n═══ tier C (the inference layer) ═══`);
    for (const r of rows.filter(x => x.tier === "C").slice(0, 14))
      console.log(`  [C] ${String(r.score).padStart(5)}  ${r.a} ⇄ ${r.b}\n           ${titleOf[r.a]} // ${titleOf[r.b]}\n           ${r.reasons.join(" · ")}`);
  }

  // ── rails ────────────────────────────────────────────────────────
  const emitted = rows.filter(r => r.tier !== "D" || r.programBacked).length;
  const failures = [];
  if (backed < RAILS.minProgramBacked) failures.push(`program-backed ${backed} < ${RAILS.minProgramBacked}`);
  if (counts.B < RAILS.minTierB) failures.push(`tier B ${counts.B} < ${RAILS.minTierB}`);
  if (emitted < RAILS.minPairs) failures.push(`emitted ${emitted} < ${RAILS.minPairs}`);
  if (files.length < RAILS.minPrograms) failures.push(`program files ${files.length} < ${RAILS.minPrograms}`);
  if (courses.length < RAILS.minCourses) failures.push(`courses ${courses.length} < ${RAILS.minCourses}`);

  if (failures.length) {
    console.error(`\n✗ write rail tripped — refusing to write:\n   ${failures.join("\n   ")}`);
    console.error(`   This looks like upstream breakage, not data drift.`);
    process.exit(1);
  }

  if (!write) {
    console.log(`\n(dry run — pass --write to emit ${OUT.replace(ROOT + "/", "")})`);
    return;
  }
  const wire = toWire(rows, { counts });
  writeFileSync(OUT, JSON.stringify(wire, null, 1) + "\n");
  const kb = Math.round(Buffer.byteLength(JSON.stringify(wire)) / 1024);
  console.log(`\n✓ wrote ${OUT.replace(ROOT + "/", "")} — ${wire.pairs.length} pairs, ${kb} KB`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
