#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// GRAD PROBE — run the graduation audit's allocator over one program
// and a named set of placed courses, and print what each section
// claimed.
//
// The reusable instrument for allocation questions ("did this pool
// over-consume?", "where did the 4th elective go?"), so that answering
// one does not mean writing another throwaway script that reloads the
// 8,000-course catalog from scratch.
//
//   node scripts/grad-probe.js <program-match> <COURSE> [COURSE...]
//   node scripts/grad-probe.js --overconsume            (corpus sweep)
//
// Example:
//   node scripts/grad-probe.js computer_science_and_mathematics \
//     "MATH 3081" "MATH 4025" "MATH 4527" "MATH 4545"
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocateMajorWithElectives, allocateMajorSections, collectCandidateKeys,
} from "../src/core/gradRequirements.js";
import { demandOf } from "../src/core/requirementDemand.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Catalog ──────────────────────────────────────────────────────

/** courseMap keyed exactly as the audit keys it: "MATH4527" → { subject, number, sh }. */
export function loadCourseMap() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const map = {};
  for (const c of raw) {
    map[`${c.subject}${c.number}`] = {
      subject: c.subject, number: c.number,
      sh: typeof c.credits === "number" ? c.credits : 4,
      coreqs: c.coreqs ?? [],
    };
  }
  return map;
}

// ── Programs ─────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "requirements.json") out.push(p);
  }
  return out;
}

export function allProgramPaths() {
  return walk(path.join(ROOT, "data/northeastern/programs"));
}

export function findProgram(match) {
  const hits = allProgramPaths().filter(p => p.includes(match));
  if (!hits.length) throw new Error(`no program matching ${match}`);
  return hits[0];
}

// ── Reporting ────────────────────────────────────────────────────

const keyOf = (code) => code.replace(/\s+/g, "");

function describe(node, courseMap, depth = 1) {
  const pad = "  ".repeat(depth);
  const mark = node.sat ? "✓" : "·";
  let head = `${pad}${mark} ${node.type}`;
  if (node.type === "XOM") head += ` ${node.satSh}/${node.reqSh} SH`;
  if (node.type === "RANGE") {
    head += ` ${node.subject} ${node.start}–${node.end} → [${node.matched.join(", ")}]`;
  }
  if (node.type === "COURSE") head += ` ${node.key}${node.released ? " (released)" : ""}`;
  const lines = [head];
  for (const child of node.children ?? []) lines.push(describe(child, courseMap, depth + 1));
  return lines.join("\n");
}

function shOf(courseMap, keys) {
  let n = 0;
  for (const k of keys) n += courseMap[k]?.sh ?? 4;
  return n;
}

// ── One plan ─────────────────────────────────────────────────────

export function probe(programPath, codes, courseMap, { verbose = true } = {}) {
  const major = JSON.parse(fs.readFileSync(programPath, "utf8"));
  const placedSet = new Set(codes.map(keyOf));
  // A course the catalog does not carry is invisible to the audit — it can be
  // claimed by nothing and `calculateGeneralElectives` skips it. Say so, rather
  // than let it read as a course the allocator lost.
  const unknown = [...placedSet].filter(k => !courseMap[k]);
  if (unknown.length && verbose) {
    console.log(`\n⚠ not in catalog (ignored by the audit): ${unknown.join(", ")}`);
  }
  const { sections, generalElectives, allocatedSet } =
    allocateMajorWithElectives(major, placedSet, courseMap);

  if (verbose) {
    console.log(`\n${path.relative(ROOT, programPath)}`);
    console.log(`placed: ${[...placedSet].join(", ")} (${shOf(courseMap, placedSet)} SH)\n`);
    for (const s of sections) {
      if (!s.allocatedCourses?.size && !s.children?.some(c => c.sat)) continue;
      const src = major.requirementSections?.find(x => x.title === s.title);
      console.log(`[${s.sat ? "✓" : "·"}] ${s.title}  ${s.satCount}/${s.minRequired}` +
                  `${src?.shared ? "  [shared]" : ""}` +
                  `  claims {${[...(s.allocatedCourses ?? [])].join(", ")}}`);
      for (const c of s.children ?? []) console.log(describe(c, courseMap));
    }
    console.log(`\nGeneral Electives: {${
      generalElectives.children.map(c => c.key).join(", ")}}  ${generalElectives.placedSH} SH`);
    const candidates = collectCandidateKeys(sections, placedSet);
    const lost = [...placedSet].filter(
      k => !allocatedSet.has(k) && !generalElectives.allocatedCourses.has(k));
    console.log(`candidates (held out of GE): {${[...candidates].join(", ")}}`);
    if (lost.length) console.log(`⚠ VANISHED (claimed by nothing): {${lost.join(", ")}}`);
  }
  return { sections, generalElectives, allocatedSet, placedSet };
}

// ── Corpus sweep: which sections consume more than they demand ────
//
// A section over-consumes when the credit it claims exceeds the credit it
// demands. That is the shape of the reported bug: a pool that keeps matching
// after its threshold is met starves General Electives and every later section.

export function overconsumption(courseMap) {
  const rows = [];
  for (const p of allProgramPaths()) {
    let major;
    try { major = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    // Saturate: place every course any RANGE/COURSE in the program could match.
    const placed = new Set();
    const collect = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "COURSE") placed.add(`${node.subject}${node.classId}`);
      if (node.type === "RANGE") {
        for (const [k, c] of Object.entries(courseMap)) {
          if (c.subject !== node.subject) continue;
          const n = parseInt(c.number, 10);
          if (Number.isNaN(n) || n < node.idRangeStart || n > node.idRangeEnd) continue;
          placed.add(k);
        }
      }
      (node.courses ?? node.requirements ?? []).forEach(collect);
    };
    (major.requirementSections ?? []).forEach(collect);
    for (const k of placed) if (!courseMap[k]) placed.delete(k);

    // Measure demand with the audit's OWN `demandOf`, not a pool-only sum. The
    // pool-only reading counts every section that mixes a pool with plain
    // course children as over-consuming — 61 sections mix the two shapes, and
    // requirementDemand.js exists precisely because that reading is wrong.
    const { sections: alloc } = allocateMajorSections(major, placed, courseMap);
    for (const a of alloc) {
      const pools = (a.children ?? []).filter(c => typeof c.reqSh === "number");
      if (!pools.length) continue;
      // Only genuine CHOICE pools. A single-COURSE XOM is the split-credit
      // pattern — "GE 1501, 1 of its 4 SH counts here" — where claiming the whole
      // 4 SH course against a 1 SH allotment is correct, not greed.
      const choice = pools.some(pool =>
        (pool.children ?? []).some(c => c.type === "RANGE") || (pool.children ?? []).length > 1);
      if (!choice) continue;
      const demand = demandOf(a);
      const claimedKeys = [...(a.allocatedCourses ?? [])];
      const claimed = shOf(courseMap, claimedKeys);
      // Overshoot smaller than the cheapest course claimed is granularity, not a
      // defect: nobody can take three-quarters of a class.
      const grain = Math.min(...claimedKeys.map(k => courseMap[k]?.sh ?? 4), Infinity);
      if (claimed - demand >= grain) {
        rows.push({ program: path.relative(ROOT, p), section: a.title,
                    demand, claimed, over: claimed - demand });
      }
    }
  }
  return rows.sort((a, b) => b.over - a.over);
}

// ── Corpus sweep: does the program's OWN sample plan satisfy it? ──
//
// The most hostile realistic test available. A published Sample Plan of Study
// is one valid path through the degree, so every named course in it should be
// claimable by the section that asked for it. Where the audit reports a section
// unsatisfied, the allocator — not the student — chose badly.
//
// The plan is a WITNESS, not a source (see CLAUDE.md): it takes one branch of
// every choice and leaves electives as unnamed placeholders, so a section it
// cannot satisfy is only evidence when the plan actually names courses for it.
// Hence `namesEverything` below.

function planPlacements(planFile) {
  const doc = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const plan = doc.plans?.[0];
  if (!plan) return null;
  const keys = new Set();
  let placeholders = 0;
  for (const year of plan.years ?? []) {
    for (const term of year.terms ?? []) {
      for (const entry of term.entries ?? []) {
        const first = entry.options?.[0];
        if (!first?.length) { placeholders++; continue; }
        first.forEach(k => keys.add(k));
      }
    }
  }
  return { keys, placeholders };
}

export function planSatisfaction(courseMap) {
  const rows = [];
  for (const p of allProgramPaths()) {
    const planFile = path.join(path.dirname(p), "plan.json");
    if (!fs.existsSync(planFile)) continue;
    let major, placed;
    try {
      major = JSON.parse(fs.readFileSync(p, "utf8"));
      placed = planPlacements(planFile);
    } catch { continue; }
    if (!placed) continue;
    for (const k of placed.keys) if (!courseMap[k]) placed.keys.delete(k);

    const { sections } = allocateMajorSections(major, placed.keys, courseMap);
    // Only sections every one of whose named courses the plan actually places:
    // an unsatisfied section the plan never named is the plan's silence, not a
    // misallocation.
    for (const a of sections) {
      if (a.sat) continue;
      const named = namedKeys(major.requirementSections?.find(s => s.title === a.title));
      if (!named.size) continue;
      const missing = [...named].filter(k => !placed.keys.has(k));
      // Every course this section names is placed, yet it reports unsatisfied →
      // some other section ate them first.
      if (!missing.length) {
        rows.push({ program: path.relative(ROOT, p), section: a.title,
                    satCount: a.satCount, minRequired: a.minRequired });
      }
    }
  }
  return rows;
}

/** Every COURSE key a requirement subtree names outright (RANGEs name nothing). */
function namedKeys(section) {
  const out = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "COURSE") out.add(`${n.subject}${n.classId}`);
    (n.courses ?? n.requirements ?? []).forEach(walk);
  };
  walk(section);
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const courseMap = loadCourseMap();
  if (args[0] === "--plan") {
    // Probe one program against its OWN published sample plan.
    const file = findProgram(args[1]);
    const placed = planPlacements(path.join(path.dirname(file), "plan.json"));
    probe(file, [...placed.keys], courseMap);
  } else if (args[0] === "--plans") {
    const rows = planSatisfaction(courseMap);
    console.log(`${rows.length} sections unsatisfied despite the plan naming every course\n`);
    for (const r of rows.slice(0, 60)) {
      console.log(`${r.satCount}/${r.minRequired}  ${r.section}  ${r.program}`);
    }
  } else if (args[0] === "--overconsume") {
    const rows = overconsumption(courseMap);
    console.log(`${rows.length} over-consuming sections\n`);
    for (const r of rows) {
      console.log(`+${String(r.over).padStart(3)} SH  ${r.section} ` +
                  `(demands ${r.demand}, claims ${r.claimed})  ${r.program}`);
    }
  } else {
    const [match, ...codes] = args;
    probe(findProgram(match), codes, courseMap);
  }
}
