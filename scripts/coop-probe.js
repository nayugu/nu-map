#!/usr/bin/env node
/**
 * coop-probe.js — one instrument for every co-op question.
 *
 * ## Why this exists
 *
 * Co-op is two things at once: a native planner block, and 86 real registrable
 * catalog courses that ~140 programs name as requirements. Every question about
 * reconciling them ("how many programs need an ABROAD co-op?", "would a granted
 * key get swept up by an electives RANGE?", "does this change regress anyone?")
 * is a corpus question, and each one used to be a throwaway script that reloaded
 * the 8,000-course catalog from scratch. This answers all of them in about a
 * second. Extend it rather than writing another script.
 *
 * See docs/coop-design.md, which is written entirely from this output.
 *
 * Usage:
 *   node scripts/coop-probe.js courses      # the 2x2 classification
 *   node scripts/coop-probe.js nodes        # requirement nodes, flag sensitivity
 *   node scripts/coop-probe.js ranges       # RANGE requirements that capture co-op keys
 *   node scripts/coop-probe.js dryrun       # today's grant vs the design, corpus-wide
 *   node scripts/coop-probe.js allocate     # real allocator on International Business
 *   node scripts/coop-probe.js all
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allocateMajorSections } from "../src/core/gradRequirements.js";
import { workTermGrants } from "../src/core/specialTermUtils.js";
import specialTerms from "../src/adapters/northeastern/specialTerms.js";

const COOP_TYPES = specialTerms.getTypes();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Classification ────────────────────────────────────────────────────
//
// A WORK EXPERIENCE course is the registration row for a work term. A PREP
// course is an ordinary class you sit in, taught before the co-op. They are
// separated by TITLE, not by number: ENCP 6100 ("Introduction to Cooperative
// Education", 1 SH, a real class) and ENCP 6954 ("Co-op Work Experience -
// Half-Time", 0 SH, a registration) are adjacent in the same subject.
const WORK = /co-?op work experience|internship exchange|work experience abroad/i;

/**
 * A class you sit in — WINS over WORK when both match, and must stay identical
 * to `derive-coop-courses.js`. `EESC 6400 "Pre-co-op Work Experience"` matches
 * WORK on the words "co-op Work Experience", but its description is "…to
 * PREPARE FOR graduate co-op" — the same description as `BINF 6900 "Pre–Co-op
 * Experience"`, which WORK misses only because that title omits "Work". The
 * classification must not turn on that accident.
 */
const CLASSROOM = /professional development|introduction to|integration seminar|reflection seminar|preparing for|pre-?.?co-?op/i;

const isWork = (c) => WORK.test(c.title ?? "") && !CLASSROOM.test(c.title ?? "");

const flagsOf = (c) => ({
  abroad:   /abroad|global|international/i.test(c.title ?? ""),
  halfTime: /half[-\s]?time/i.test(c.title ?? ""),
});

const catalog = JSON.parse(fs.readFileSync(path.join(REPO, "public/northeastern/catalog-courses.json"), "utf8"));
const courses = Array.isArray(catalog) ? catalog : (catalog.courses ?? Object.values(catalog));
const keyOf   = (c) => c.subject + c.number;

const workCourses = courses.filter(isWork);
/** key → { abroad, halfTime, title, subject } for the 86 work-experience courses. */
const WORK_BY_KEY = Object.fromEntries(
  workCourses.map(c => [keyOf(c), { ...flagsOf(c), title: c.title, subject: c.subject }]));

// ── Requirement corpus ────────────────────────────────────────────────

const requirementFiles = (() => {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "requirements.json") out.push(p);
    }
  })(path.join(REPO, "data/northeastern/programs"));
  return out;
})();

const progNameOf = (file) => file.split("/programs/")[1].replace("/requirements.json", "");

/**
 * A co-op requirement NODE is the smallest choice a student actually makes:
 * an OR/XOM whose option list contains a work-experience course, or a bare
 * COURSE that is one.
 *
 * Descending into an XOM's `groups` would DOUBLE-COUNT — the groups are a
 * presentation of the same option list, not extra requirements. Verified: zero
 * co-op options appear only in `groups`, so nothing is lost by stopping here.
 * (An earlier pass that did descend reported 217 nodes instead of 153.)
 */
function coopNodes(json) {
  const out = [];
  const walk = (o, section) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, section));
    if (!o || typeof o !== "object") return;
    const sec = o.type === "SECTION" ? o : section;
    if ((o.type === "OR" || o.type === "XOM") && Array.isArray(o.courses)) {
      const keys = o.courses.filter(c => c.type === "COURSE").map(c => c.subject + c.classId);
      if (keys.some(k => WORK_BY_KEY[k])) { out.push({ keys, sec, kind: o.type }); return; }
    }
    if (o.type === "COURSE" && WORK_BY_KEY[o.subject + o.classId]) {
      out.push({ keys: [o.subject + o.classId], sec, kind: "COURSE" });
      return;
    }
    Object.values(o).forEach(v => walk(v, sec));
  };
  walk(json, null);
  return out;
}

const eachProgram = function* () {
  for (const f of requirementFiles) {
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    const nodes = coopNodes(json);
    if (nodes.length) yield { name: progNameOf(f), json, nodes };
  }
};

// ── The resolver under test ───────────────────────────────────────────
//
// Each block emits the variant — FROM THE SET THIS PROGRAM NAMES — matching its
// flags. If no such variant exists, or that key was already emitted, it emits
// the program's base (full-time domestic) variant instead.
//
// The base fallback is not a nicety. The requirement layer is a Set of BASE
// course keys (buildPlacedKeySet maps through courseMap and emits
// courseKey(subject, number)), so `COOP3948#2` is unrepresentable and repeat
// instances cannot express "two co-ops". Falling back to the base variant is
// what stops two identically-flagged blocks collapsing to one key — and it is
// true: a second abroad co-op with nothing abroad-specific left to claim is
// still a co-op.
const BASE = { abroad: false, halfTime: false };

/**
 * Calls the SHIPPED resolver rather than modelling it.
 *
 * This file previously carried its own copy, which meant the numbers in
 * docs/coop-design.md could agree with a model and disagree with the code.
 * That is the drift the doc exists to prevent, so the instrument imports what
 * runs. `specialTermPl` is synthesised here because the probe reasons about
 * hypothetical plans ("one abroad co-op") rather than real ones.
 */
export function resolveGrants(blocks, programKeys) {
  const options = programKeys.map(k => ({ key: k, ...WORK_BY_KEY[k] }));
  const pl = Object.fromEntries(blocks.map((f, i) =>
    [`c${i}`, { typeId: "coop", semId: `s${i}`, duration: 6, abroad: !!f.abroad, halfTime: !!f.halfTime }]));
  const semIndex = Object.fromEntries(blocks.map((_, i) => [`s${i}`, i]));
  return workTermGrants(pl, COOP_TYPES, semIndex, null, options).planned;
}

const programKeysOf = (nodes) =>
  [...new Set(nodes.flatMap(n => n.keys.filter(k => WORK_BY_KEY[k])))];

// ── Reports ───────────────────────────────────────────────────────────

const COMBOS = [
  ["full/domestic", { abroad: false, halfTime: false }],
  ["full/abroad",   { abroad: true,  halfTime: false }],
  ["half/domestic", { abroad: false, halfTime: true  }],
  ["half/abroad",   { abroad: true,  halfTime: true  }],
];

function reportCourses() {
  console.log(`── CLASSIFICATION ──`);
  console.log(`work-experience courses: ${workCourses.length}   subjects: ${new Set(workCourses.map(c => c.subject)).size}   credits: ${[...new Set(workCourses.map(c => c.credits))].join(",")}`);
  for (const [label, f] of COMBOS) {
    const ks = Object.entries(WORK_BY_KEY).filter(([, v]) => v.abroad === f.abroad && v.halfTime === f.halfTime).map(([k]) => k);
    console.log(`  ${label.padEnd(14)} ${String(ks.length).padStart(3)}  ${ks.slice(0, 5).join(" ")}${ks.length > 5 ? " …" : ""}`);
  }
  const inCoopSubject = workCourses.filter(c => c.subject === "COOP" || c.subject === "COP").length;
  console.log(`  in subject COOP/COP: ${inCoopSubject} of ${workCourses.length} — a subject-based lookup would miss ${workCourses.length - inCoopSubject}`);

  const other = courses.filter(c => /co-?op|cooperative/i.test(c.title ?? "") && !isWork(c));
  console.log(`\nco-op-TITLED ordinary classes (untouched by any of this): ${other.length}`);
  for (const c of other) console.log(`  ${keyOf(c).padEnd(10)} ${String(c.credits).padStart(2)} SH  ${c.title}`);
}

function reportNodes() {
  console.log(`── REQUIREMENT NODES ──`);
  const all = [];
  for (const p of eachProgram()) for (const n of p.nodes) all.push({ ...n, prog: p.name });
  const ug = all.filter(n => n.prog.startsWith("undergraduate"));
  console.log(`nodes ${all.length} (undergrad ${ug.length}, graduate ${all.length - ug.length})  programs ${new Set(all.map(n => n.prog)).size}`);

  const buckets = {};
  for (const n of all) {
    const ok = COMBOS.filter(([, f]) => n.keys.some(k => WORK_BY_KEY[k] && WORK_BY_KEY[k].abroad === f.abroad && WORK_BY_KEY[k].halfTime === f.halfTime)).map(([l]) => l);
    (buckets[ok.join(",") || "NONE"] ??= []).push(n);
  }
  console.log(`\nflag combinations that satisfy each node:`);
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${String(v.length).padStart(3)}  ${k}`);

  const defaultOk = all.filter(n => n.keys.some(k => WORK_BY_KEY[k] && !WORK_BY_KEY[k].abroad && !WORK_BY_KEY[k].halfTime));
  console.log(`\nsatisfied by a plain full-time domestic co-op: ${defaultOk.length} of ${all.length}`);
  console.log(`NOT satisfied by the default:`);
  for (const n of all.filter(x => !defaultOk.includes(x)))
    console.log(`   ${n.prog.split("/").pop()} §${n.sec?.title ?? "?"} → ${n.keys.filter(k => WORK_BY_KEY[k]).join(",")}`);
}

/**
 * `matchRange` ITERATES placedSet rather than testing membership, so any key we
 * grant is a candidate for every RANGE in the program. Zero RANGEs catch
 * COOP3945 — COOP is its own subject and nobody ranges over it — which is
 * exactly why the current single-key grant has never hit this. Graduate co-op
 * lives inside the program's own subject, right in the middle of its electives
 * range.
 */
function reportRanges() {
  console.log(`── RANGE CAPTURE ──`);
  const hits = [];
  let totalRanges = 0;
  for (const f of requirementFiles) {
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    const walk = (o, section, parent) => {
      if (Array.isArray(o)) return o.forEach(x => walk(x, section, parent));
      if (!o || typeof o !== "object") return;
      const sec = o.type === "SECTION" ? o.title : section;
      if (o.type === "RANGE") {
        totalRanges++;
        const exc = (o.exceptions ?? []).map(e => e.subject + e.classId);
        const caught = workCourses.filter(c =>
          c.subject === o.subject && +c.number >= o.idRangeStart && +c.number <= o.idRangeEnd && !exc.includes(keyOf(c)));
        if (caught.length) hits.push({ prog: progNameOf(f), sec, subject: o.subject, lo: o.idRangeStart, hi: o.idRangeEnd, caught: caught.map(keyOf), parent });
      }
      const nextParent = (o.type === "XOM" || o.type === "OR" || o.type === "AND") ? o : parent;
      Object.values(o).forEach(v => walk(v, sec, nextParent));
    };
    walk(json, null, null);
  }
  console.log(`RANGE requirements: ${totalRanges}`);
  console.log(`…that would capture a granted co-op key: ${hits.length} in ${new Set(hits.map(h => h.prog)).size} programs`);
  console.log(`…that capture COOP3945 (today's grant): ${hits.filter(h => h.caught.includes("COOP3945")).length}`);
  const creditBased = hits.filter(h => h.parent?.type === "XOM" && h.parent.numCreditsMin);
  console.log(`\nseverity — co-op courses are 0 SH:`);
  console.log(`  inside a credit-based XOM (listed, cannot falsely satisfy): ${creditBased.length}`);
  console.log(`  elsewhere (could falsely satisfy):                          ${hits.length - creditBased.length}`);
  for (const h of hits.filter(x => !creditBased.includes(x)))
    console.log(`     ${h.prog.split("/").pop()} §${h.sec} ${h.subject} ${h.lo}-${h.hi} → ${h.caught.join(",")} (under ${h.parent?.type ?? "top-level"})`);

  // ── The number above is the WRONG one to design against ─────────────
  //
  // It counts every RANGE that could catch ANY of the 86 keys. A student grants
  // exactly ONE key, drawn from their own program's option list, so the honest
  // exposure is: for each program, does that program's own RANGE catch the key
  // that program's own co-op would grant? First measurement said 146 and made
  // the guard look like a blocker; this one is what it actually costs.
  const byProg = new Map();
  for (const h of hits) (byProg.get(h.prog) ?? byProg.set(h.prog, []).get(h.prog)).push(h);
  let exposed = 0, dangerous = [];
  for (const p of eachProgram()) {
    const granted = programKeysOf(p.nodes).find(k => !WORK_BY_KEY[k].abroad && !WORK_BY_KEY[k].halfTime);
    if (!granted) continue;
    const own = (byProg.get(p.name) ?? []).filter(h => h.caught.includes(granted));
    if (!own.length) continue;
    exposed++;
    if (own.some(h => !(h.parent?.type === "XOM" && h.parent.numCreditsMin)))
      dangerous.push(`${p.name.split("/").pop()} ${granted}`);
  }
  console.log(`\nREAL exposure — the one key each program actually grants:`);
  console.log(`  programs whose own RANGE catches their own granted key: ${exposed}`);
  console.log(`  …of those, able to falsely satisfy:                     ${dangerous.length}`);
  dangerous.forEach(d => console.log(`     ${d}`));
}

function reportDryRun() {
  console.log(`── DRY RUN: one default (full-time domestic) co-op ──`);
  let progs = 0, total = 0, oldSat = 0, newSat = 0;
  const regressions = [];
  for (const p of eachProgram()) {
    progs++;
    const keys = resolveGrants([BASE], programKeysOf(p.nodes));
    for (const n of p.nodes) {
      total++;
      const before = n.keys.includes("COOP3945");
      const after  = n.keys.some(k => keys.has(k));
      if (before) oldSat++;
      if (after)  newSat++;
      if (before && !after) regressions.push(`${p.name.split("/").pop()} §${n.sec?.title ?? "?"}`);
    }
  }
  console.log(`  programs ${progs}   nodes ${total}`);
  console.log(`  satisfied today (grant = COOP3945): ${oldSat}`);
  console.log(`  satisfied under the design:         ${newSat}`);
  console.log(`  gained ${newSat - oldSat}   regressions ${regressions.length}`);
  regressions.forEach(r => console.log(`     REGRESSION: ${r}`));
}

/**
 * The real allocator, on the one program the whole abroad question turns on.
 * A naive `options.some(k => keys.has(k))` harness reports "1 abroad ⇒ both
 * sections MET" and is WRONG: allocateSections runs a single global `used` set
 * and neither IB section is `shared`, so COOP3948 is consumed once. Read the
 * code, then run it.
 */
function reportAllocate() {
  console.log(`── REAL ALLOCATOR: International Business BSIB ──`);
  const courseMap = {};
  for (const c of courses) courseMap[keyOf(c)] = { ...c, sh: c.credits };
  const ib = JSON.parse(fs.readFileSync(
    path.join(REPO, "data/northeastern/programs/undergraduate/2026/business/international_business_bsib_(boston)/requirements.json"), "utf8"));

  const ABROAD = { abroad: true, halfTime: false };
  const progKeys = programKeysOf(coopNodes(ib));
  const scenarios = [
    ["0 co-ops", []], ["1 domestic", [BASE]], ["1 abroad", [ABROAD]],
    ["1 abroad + 1 domestic", [ABROAD, BASE]], ["2 abroad", [ABROAD, ABROAD]],
    ["2 domestic", [BASE, BASE]],
  ];
  for (const [label, blocks] of scenarios) {
    const keys = resolveGrants(blocks, progKeys);
    const { sections } = allocateMajorSections(ib, new Set(keys), courseMap);
    const rel = sections.filter(s => /Experiential/i.test(s.title ?? ""));
    console.log(`  ${label.padEnd(22)} {${[...keys].join(",")}}`.padEnd(60) +
      rel.map(s => `${/International/.test(s.title) ? "Intl" : "Busi"}=${s.sat ? "MET" : "unmet"}`).join("  "));
  }
}

const cmd = process.argv[2] ?? "all";
const run = { courses: reportCourses, nodes: reportNodes, ranges: reportRanges, dryrun: reportDryRun, allocate: reportAllocate };
if (cmd === "all") {
  for (const [name, fn] of Object.entries(run)) { fn(); console.log(); }
} else if (run[cmd]) {
  run[cmd]();
} else {
  console.error(`unknown command "${cmd}" — one of: ${Object.keys(run).join(", ")}, all`);
  process.exit(1);
}
