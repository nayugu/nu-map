#!/usr/bin/env node
/**
 * derive-offering-summary.js
 *
 * Transforms the raw, heavy public/northeastern/term-details.json (~4.3 MB, full per-term
 * section aggregates) into a slim client asset the app actually loads:
 *
 *   public/northeastern/offering-summary.json
 *   {
 *     "CS3500": {
 *       e:   { "202610": 240, "202630": 180 }, // enrolled count per completed term
 *       c:   { "202610": 250, "202630": 246 }, // capacity per completed term
 *       s:   { "202610": 6,   "202630": 5 },   // section count per completed term
 *       fmt: ["Traditional"],                  // instructional formats ever seen (union)
 *       cmp: ["Boston"],                       // campuses ever seen (union)
 *       dow: [80, 0, 80, 60, 20],              // % of sections meeting each weekday [M,T,W,Th,F]
 *       pat: [["MWR",60],["TF",20]],           // [day-pattern, % of sections], top 6, most common first
 *       lab: false,                            // any section requires a linked lab/co-section
 *       prof: { "fall": [["Gregory Aloupis", 54]] }, // primary instructors per SEMESTER TYPE [name, avg % of enrolment], top 4
 *       std: "JR"                              // class standing required: FR|SH|JR|SR (absent = none)
 *     }
 *   }
 *
 * Storing raw enrolled + capacity + sections (rather than a pre-computed fill%) lets the app
 * derive everything exactly and losslessly: open = max(0, c - e), fill% = e/c, open-per-section
 * = open/s, and it preserves overenrollment (e > c). Per-semester breakdown (Fall vs Spring vs
 * Summer) is derived in the app since the term code carries the semester type. Still well under
 * 1 MB — three small int maps are no larger than the old fill%/open pair.
 *
 * `std` is the class-standing gate — the registrar's own restriction, which the catalog
 * states only in prose. It is folded here rather than at capture time because the two
 * rules it needs (every section gated; most lenient standing) are presentation
 * decisions over the raw per-section tally. See scripts/lib/class-standing.js.
 *
 * Usage:
 *   node scripts/derive-offering-summary.js            # dry run — prints size + samples
 *   node scripts/derive-offering-summary.js --write    # write offering-summary.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { courseGate, STANDING_LADDER } from "./lib/class-standing.js";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = resolve(__dirname, "..");
const DETAILS_IN  = resolve(ROOT, "public/northeastern/term-details.json");
const SUMMARY_OUT = resolve(ROOT, "public/northeastern/offering-summary.json");

const doWrite = process.argv.includes("--write");

if (!existsSync(DETAILS_IN)) {
  console.error(`Missing ${DETAILS_IN} — run scripts/scrape-availability.js first.`);
  process.exit(1);
}

const details = JSON.parse(readFileSync(DETAILS_IN, "utf8"));
const summary = {};

for (const [courseId, byTerm] of Object.entries(details)) {
  const enr  = {};                                    // enrolled count
  const cap  = {};                                    // capacity
  const secs = {};                                    // section count (for open-per-section colour)
  const formats  = new Set();
  const campuses = new Set();
  const weekday  = { M: 0, T: 0, W: 0, R: 0, F: 0 };  // R = Thursday
  const patterns = {};                                // primary day-pattern → enrolled headcount
  let totalWt = 0;                                    // total enrolled across all patterns
  let lab = false;

  // Primary instructors aggregated per SEMESTER TYPE (fall/spring/sumA/sumB):
  // each professor's average enrolment share across every recorded term of
  // that type, computed from the FULL per-term lists BEFORE any capping — so
  // the percentages are true shares even for a 70-section writing course.
  const SUFFIX_TYPE = { "10": "fall", "30": "spring", "40": "sumA", "60": "sumB", "32": "spring", "52": "sumA" };
  const profAgg = {};                                 // typeId → Map(name → weight)

  for (const [termCode, d] of Object.entries(byTerm)) {
    if (d.cap > 0) {
      enr[termCode]  = d.enr;
      cap[termCode]  = d.cap;
      secs[termCode] = d.sections || 1;
    }
    if (d.prof?.length) {
      const typeId = SUFFIX_TYPE[String(termCode).slice(-2)];
      if (typeId) {
        // Weight by enrolment; a term with no enrolment data falls back to
        // section counts so it still contributes instead of disappearing.
        const termTotalE = d.prof.reduce((s, [, , e]) => s + (e || 0), 0);
        const m = (profAgg[typeId] ??= new Map());
        for (const [name, n, e] of d.prof) {
          const w = termTotalE > 0 ? (e || 0) : (n || 0);
          m.set(name, (m.get(name) ?? 0) + w);
        }
      }
    }
    for (const f of d.formats ?? [])  formats.add(f);
    for (const c of d.campuses ?? []) campuses.add(c);
    // Each `days` value is {n: sections, e: enrolled} (see scrape-availability); a legacy plain
    // number is treated as a section count. Weight by enrolment when this term has any (where
    // students actually are), otherwise fall back to section counts so a term with missing/zero
    // enrolment still contributes its patterns instead of disappearing.
    const daysObj = d.days ?? {};
    const wOf = v => (typeof v === "number" ? { n: v, e: 0 } : { n: v?.n ?? 0, e: v?.e ?? 0 });
    const useEnr = Object.values(daysObj).reduce((s, v) => s + wOf(v).e, 0) > 0;
    for (const [pattern, v] of Object.entries(daysObj)) {
      const w = wOf(v);
      const wt = useEnr ? w.e : w.n;                   // includes async / weekend
      totalWt += wt;
      patterns[pattern] = (patterns[pattern] ?? 0) + wt;
      for (const ch of pattern) if (ch in weekday) weekday[ch] += wt;
    }
    if (d.linked) lab = true;
  }

  // Per-weekday frequency: % of enrolment that meets on each weekday (M,T,W,Th,F). Captures
  // "mostly MWR, occasionally TF" as a gradient rather than a single binary pattern. Async /
  // weekend enrolment counts toward the total, so a heavily-online course reads as all-faint.
  const dow = totalWt > 0
    ? ["M", "T", "W", "R", "F"].map(k => Math.round((weekday[k] / totalWt) * 100))
    : null;

  // Meeting-pattern distribution: [pattern, % of enrolment] for the top patterns, most common
  // first — powers the schedule hover chart. Capped to the top 6; the UI shows the remainder as
  // "other". "async" is its own pattern here (no fixed days).
  const pat = totalWt > 0
    ? Object.entries(patterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([p, c]) => [p, Math.round((c / totalWt) * 100)])
    : null;

  summary[courseId] = {
    e:   enr,      // enrolled count per term → fill% (height) = e/c
    c:   cap,      // capacity per term       → open = max(0, c - e)
    s:   secs,     // section count per term  → colour uses open ÷ sections
    fmt: [...formats].sort(),
    cmp: [...campuses].sort(),
    ...(dow ? { dow } : {}),
    ...(pat ? { pat } : {}),
    ...(lab ? { lab: true } : {}),
  };

  const prof = {};                                    // typeId → [[name, pct], …] top 4
  for (const [typeId, m] of Object.entries(profAgg)) {
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    if (!total) continue;
    prof[typeId] = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, w]) => [name, Math.round((w / total) * 100)]);
  }
  if (Object.keys(prof).length) summary[courseId].prof = prof;

  // Class-standing gate. Absent for the ~79% of courses with no restriction, and
  // absent — deliberately — whenever the terms we looked at disagree: this field
  // becomes a floor in the generator, and a floor invented from conflicting
  // evidence can refuse a plan outright.
  const gate = courseGate(byTerm);
  if (gate) summary[courseId].std = gate.standing;
}

const json  = JSON.stringify(summary);
const bytes = Buffer.byteLength(json, "utf8");
console.log(`Courses: ${Object.keys(summary).length}`);
console.log(`Size:    ${(bytes / 1048576).toFixed(2)} MB`);
for (const id of ["CS3500", "MATH1341", "ENGW1111"]) {
  if (summary[id]) console.log(`  ${id}: ${JSON.stringify(summary[id])}`);
}

// ── Class-standing gates: report, then refuse a silent collapse ────
//
// Same principle as fetch-nupath's 5% rule. The failure this guards is specific and
// quiet: Banner renames a heading or changes the markup, `parseRestrictions` matches
// nothing, every gate disappears, and the generator goes back to guessing from the
// level digit with no error anywhere. Losing gates in bulk is never a legitimate
// outcome of a derive run — the input file only ever gains restriction data.
const gated = Object.entries(summary).filter(([, v]) => v.std);
const byStanding = {};
for (const [, v] of gated) byStanding[v.std] = (byStanding[v.std] ?? 0) + 1;
console.log(`\nClass-standing gates: ${gated.length} courses` +
  (gated.length ? `  (${STANDING_LADDER.filter(s => byStanding[s]).map(s => `${s} ${byStanding[s]}`).join(", ")})` : ""));
for (const id of ["ENGW3302", "ENGW3307", "MEIE4702", "BIOL4701"]) {
  if (summary[id]?.std) console.log(`  sample ${id}: std=${summary[id].std}`);
}

let prevGated = 0, lost = 0;
if (existsSync(SUMMARY_OUT)) {
  try {
    const prev = JSON.parse(readFileSync(SUMMARY_OUT, "utf8"));
    for (const [id, v] of Object.entries(prev)) {
      if (!v?.std) continue;
      prevGated += 1;
      if (!summary[id]?.std) lost += 1;
    }
  } catch { /* unreadable previous file cannot accuse this one */ }
}
// A floor of 50 so the very first run — which legitimately goes from 0 gates to many —
// and a tiny --term test corpus are not treated as a collapse.
const LOSS_LIMIT = 0.05;
if (prevGated >= 50 && lost / prevGated > LOSS_LIMIT) {
  console.error(`\nREFUSING TO WRITE: ${lost} of ${prevGated} class-standing gates ` +
    `(${(100 * lost / prevGated).toFixed(1)}%) disappeared — limit ${LOSS_LIMIT * 100}%.`);
  console.error("A derive run only ever gains restriction data, so this means the scrape " +
    "or the Banner parse broke. Check parseRestrictions against a live getRestrictions page.");
  process.exit(1);
}
if (lost) console.log(`  (${lost} of ${prevGated} previous gates gone — within the ${LOSS_LIMIT * 100}% limit)`);

if (doWrite) {
  writeFileSync(SUMMARY_OUT, json);
  console.log(`\nWrote ${SUMMARY_OUT}`);
} else {
  console.log("\nDry run — pass --write to save offering-summary.json");
}
