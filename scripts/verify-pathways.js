#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// VERIFY PATHWAYS — the gate on hand-curated accelerated-pathway data.
//
// Pathway data is the one part of this feature with no catalog authority:
// docs/plusone-research.md measured the catalog's seven PlusOne pages at ~450
// characters of prose and ZERO tables, so every pathway here was transcribed
// from a college marketing page or a PDF. Transcription is where the errors are,
// and a wrong course number reaches a student planning their degree.
//
// So this script exists to make the class of error that curation invites
// impossible to ship:
//
//   1. every ugProgram / msProgram id resolves in programs-bundle.json
//   2. every named course exists in catalog-courses.json
//   3. the direction invariant: `grad` is >= 5000 and a course target is < 5000
//   4. every rule kind is in the vocabulary AND has an evaluator registered
//   5. the pathway's own share table can satisfy its own cap
//   6. every named graduate share can satisfy SOMETHING in the MS requirement
//      tree — the check that actually catches a mistyped course number, since a
//      plausible-looking wrong code passes checks 1–5 and fails only here
//
// Exit code is non-zero on any failure, so CI and the monthly job can gate on
// it. This script never writes data.
//
// Usage:  node scripts/verify-pathways.js [--json]
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { RULE_KINDS } from "../src/core/pathway/ruleKinds.js";
import { EVALUATORS } from "../src/core/pathway/rules/index.js";
import { plannerId, isGradCode, isUgCode } from "../src/core/pathway/ids.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATHWAYS = join(ROOT, "data/northeastern/pathways");
const COURSES = join(ROOT, "public/northeastern/catalog-courses.json");
const BUNDLE = join(ROOT, "public/northeastern/programs-bundle.json");

const asJson = process.argv.includes("--json");

// ── load ──────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

const courses = new Set(
  JSON.parse(readFileSync(COURSES, "utf8")).map(c => `${c.subject}${c.number}`)
);
const bundle = JSON.parse(readFileSync(BUNDLE, "utf8"));
const programIds = new Set(bundle.programs.map(p => p.id));
const programData = bundle.programData ?? {};

/** Every course reference inside a requirement tree, as planner ids. */
function courseRefsOf(node, out = new Set()) {
  if (Array.isArray(node)) { for (const n of node) courseRefsOf(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === "COURSE" && node.subject) {
    out.add(`${node.subject}${node.classId ?? node.number}`);
  }
  for (const v of Object.values(node)) courseRefsOf(v, out);
  return out;
}

/** RANGE nodes, so a share inside `CS 5100–7980` counts as satisfiable. */
function rangesOf(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) rangesOf(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === "RANGE" && node.subject) {
    out.push({ subject: node.subject, start: node.idRangeStart, end: node.idRangeEnd,
               exceptions: (node.exceptions ?? []).map(e => `${e.subject}${e.classId ?? e.number}`) });
  }
  for (const v of Object.values(node)) rangesOf(v, out);
  return out;
}

function msTreeAccepts(msProgramId, gradId) {
  const data = programData[msProgramId];
  if (!data) return null;                       // cannot tell — reported separately
  const sections = data.requirementSections ?? data.requirements ?? data;
  if (courseRefsOf(sections).has(gradId)) return true;
  const m = /^([A-Za-z]+)(\d{4})$/.exec(gradId);
  if (!m) return false;
  const [, subj, numStr] = m;
  const num = parseInt(numStr, 10);
  for (const r of rangesOf(sections)) {
    if (r.subject !== subj) continue;
    if (Number.isFinite(r.start) && num < r.start) continue;
    if (Number.isFinite(r.end) && num > r.end) continue;
    if (r.exceptions.includes(gradId)) continue;
    return true;
  }
  return false;
}

// ── check ─────────────────────────────────────────────────────────

const problems = [];
const warnings = [];
let nPathways = 0, nShares = 0, nRules = 0;

for (const file of walk(PATHWAYS)) {
  const rel = relative(ROOT, file);
  let p;
  try {
    p = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    problems.push({ file: rel, check: "parse", detail: err.message });
    continue;
  }
  nPathways += 1;
  const at = (check, detail) => problems.push({ file: rel, id: p.id, check, detail });

  if (!p.id) at("id", "missing `id`");
  if (!p.source?.url) at("source", "missing `source.url` — every pathway must name where it came from");
  if (!p.source?.retrievedAt) at("source", "missing `source.retrievedAt` — staleness cannot be shown without it");

  // 1. programs resolve
  for (const e of p.eligibility ?? []) {
    if (!programIds.has(e.ugProgram)) at("ugProgram", `unknown program id: ${e.ugProgram}`);
  }
  if (!(p.msPrograms ?? []).length) at("msPrograms", "no master's program listed");
  for (const id of p.msPrograms ?? []) {
    if (!programIds.has(id)) at("msProgram", `unknown program id: ${id}`);
    else if (!id.startsWith("grad/")) at("msProgram", `not a graduate program: ${id}`);
  }

  // 2 + 3. courses exist, and the direction invariant holds
  for (const share of p.shares ?? []) {
    nShares += 1;
    if (share.grad) {
      const gid = plannerId(share.grad);
      if (!gid) at("share", `unparseable graduate code: ${share.grad}`);
      else if (!courses.has(gid)) at("share", `graduate course not in catalog: ${share.grad}`);
      else if (!isGradCode(gid)) at("direction", `\`grad\` must be >= 5000: ${share.grad}`);
    } else if (!share.gradDomain) {
      at("share", "share has neither `grad` nor `gradDomain`");
    }
    if (share.target?.kind === "course") {
      const tid = plannerId(share.target.ref);
      if (!tid) at("share", `unparseable target code: ${share.target.ref}`);
      else if (!courses.has(tid)) at("share", `target course not in catalog: ${share.target.ref}`);
      else if (!isUgCode(tid)) at("direction", `course target must be < 5000: ${share.target.ref}`);
    } else if (!share.target?.kind) {
      at("share", "share has no `target.kind`");
    }
    if (share.mandatory && share.mandatoryUnless) {
      at("share", `${share.grad}: both \`mandatory\` and \`mandatoryUnless\` — pick one`);
    }
    if (share.mandatoryUnless?.completed && !plannerId(share.mandatoryUnless.completed)) {
      at("share", `unparseable mandatoryUnless.completed: ${share.mandatoryUnless.completed}`);
    }
  }

  // 4. rule kinds are known and wired
  for (const rule of p.rules ?? []) {
    nRules += 1;
    if (!rule.kind) { at("rule", "rule with no `kind`"); continue; }
    if (!RULE_KINDS[rule.kind]) {
      at("rule", `unknown rule kind: ${rule.kind} — add it to src/core/pathway/ruleKinds.js`);
      continue;
    }
    if (typeof EVALUATORS[rule.kind] !== "function") {
      at("rule", `rule kind "${rule.kind}" has no evaluator registered in rules/index.js`);
    }
  }
  for (const c of (p.rules ?? []).filter(r => r.kind === "excludedFromShare")
                                 .flatMap(r => r.courses ?? [])) {
    const id = plannerId(c);
    if (!id) at("rule", `excludedFromShare: unparseable code ${c}`);
    else if (!courses.has(id)) at("rule", `excludedFromShare: not in catalog: ${c}`);
  }

  // 5. the pathway's own table can satisfy its own cap
  const cap = (p.rules ?? []).find(r => r.kind === "shareCap");
  if (cap) {
    const named = (p.shares ?? []).filter(s => s.grad);
    const distinct = new Set(named.map(s => plannerId(s.grad)));
    const maxCourses = Number.isFinite(cap.courses) ? cap.courses : 4;
    if (distinct.size < maxCourses && !(p.shares ?? []).some(s => s.gradDomain)) {
      warnings.push({
        file: rel, id: p.id, check: "cap",
        detail: `only ${distinct.size} distinct graduate courses offered but the cap allows ` +
                `${maxCourses} — the student cannot reach the cap through this table alone`,
      });
    }
  }

  // 6. every named graduate share satisfies something in at least one MS tree
  for (const share of p.shares ?? []) {
    if (!share.grad) continue;
    const gid = plannerId(share.grad);
    if (!gid || !courses.has(gid)) continue;
    let anyKnown = false, anyAccepts = false;
    for (const ms of p.msPrograms ?? []) {
      const r = msTreeAccepts(ms, gid);
      if (r === null) continue;
      anyKnown = true;
      if (r) { anyAccepts = true; break; }
    }
    if (!anyKnown) {
      warnings.push({ file: rel, id: p.id, check: "msTree",
        detail: `no requirement data for any listed MS program — cannot verify ${share.grad}` });
    } else if (!anyAccepts) {
      at("msTree", `${share.grad} satisfies nothing in any listed MS requirement tree ` +
                   `— likely a wrong course number`);
    }
  }
}

// ── report ────────────────────────────────────────────────────────

if (asJson) {
  console.log(JSON.stringify({ nPathways, nShares, nRules, problems, warnings }, null, 2));
} else {
  console.log(`\nverify-pathways — ${nPathways} pathways, ${nShares} shares, ${nRules} rules\n`);
  for (const w of warnings) console.log(`  ⚠ ${w.id ?? w.file} [${w.check}] ${w.detail}`);
  if (warnings.length) console.log("");
  for (const p of problems) console.log(`  ✗ ${p.id ?? p.file} [${p.check}] ${p.detail}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}. ` +
                `Pathway data must not ship in this state.\n`);
  } else {
    console.log(`✓ all pathways verified${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}\n`);
  }
}

process.exit(problems.length ? 1 : 0);
