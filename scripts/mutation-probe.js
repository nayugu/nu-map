#!/usr/bin/env node
/**
 * mutation-probe.js — does a test actually FAIL when the code is broken?
 *
 * ── Why this is committed ───────────────────────────────────────────
 *
 * CLAUDE.md says tests that confirm are close to worthless here and the ones
 * that pay are hostile. Nothing in the repo could tell the difference, so
 * "hostile" was a claim about intent rather than a measured property. This
 * measures it: break the code on purpose, run the tests, and see whether they
 * notice. A mutant nothing kills is a hole in the suite.
 *
 * It earned its place on the free-elective work, where it found more than the
 * review did:
 *
 *   · four guards in `proseSectionSH` were each deletable with no test failing,
 *     because the tests used figures the plausibility ceiling caught first —
 *     they asserted the right outcomes for the wrong reason;
 *   · `minOptions`' "Electives Option" correction had no test at all;
 *   · and chasing one stubborn survivor turned up a REAL BUG: the total guard
 *     matched one phrasing of a degree total where `parseTotalCredits`
 *     recognises seven, so "A total of 42 semester hours are required" and the
 *     doctoral "a minimum of 28 … beyond the graduate degree" became phantom
 *     42 SH and 28 SH requirement sections on the smallest degrees in the
 *     catalog.
 *
 * ── Reading the output ──────────────────────────────────────────────
 *
 *   KILLED    a test failed. The guard is real and covered.
 *   SURVIVED  nothing failed. Either the suite has a hole, or the mutant is
 *             EQUIVALENT — it changes code without changing behaviour, and no
 *             test can kill it. Decide which; do not assume the first.
 *   SKIP      the anchor text is gone, so the mutant never applied. This is the
 *             failure mode that quietly turns the whole run green: a refactor
 *             moves a line and the mutant silently stops testing anything.
 *
 * ⚠ Mutants are applied to the WORKING TREE and reverted with `git checkout --`,
 * so uncommitted edits to a mutated file are destroyed, and a run against
 * uncommitted work measures HEAD instead of what you wrote. Both happened while
 * building this. It refuses to run on a dirty target file for that reason.
 *
 *   node scripts/mutation-probe.js                 # every mutant
 *   node scripts/mutation-probe.js --only credit   # names matching a substring
 *   node scripts/mutation-probe.js --list
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const DEMAND = "src/core/requirementDemand.js";
const PARSER = "scripts/lib/catalog-program-parser.js";
const RECORD = "scripts/lib/program-record.js";
const OVERLAP = "src/core/minorOverlap.js";
const MODEL   = "src/core/planModel.js";
const COURSE  = "src/core/courseModel.js";

const INVARIANT  = "cd test/invariant && node --test requirement-credit-corpus.test.js";
const PROSE      = "cd test/contract  && node --test catalog-prose-sections.test.js";
const MAJORPARSE = "cd test/contract  && node --test major-parser.test.js";
const SUBTOTAL   = "cd test/contract  && node --test catalog-major-subtotal.test.js";
const UNITDEMAND = "cd test/unit      && node --test engine-demand.test.js engine-stated-cells.test.js";
const MINOR      = "cd test/unit      && node --test minor-overlap.test.js";
const PARTNERS   = "cd test/unit      && node --test related-partners.test.js";

/**
 * Each mutant is a plausible REGRESSION, not random noise: an inverted
 * tie-break, a deleted guard, a fallback restored. `from` must be unique in the
 * file — the runner checks — so a mutant cannot silently apply somewhere else.
 */
const MUTANTS = [
  // ── A section's credit is read, not estimated ───────────────────
  { name: "credit: OR takes the MAX branch, not the min", file: DEMAND,
    from: "const req = Math.min(...kids.map(k => k.req));",
    to:   "const req = Math.max(...kids.map(k => k.req));", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: OR satisfaction is UNCAPPED (branches sum)", file: DEMAND,
    from: "return { req, sat: Math.min(req, Math.max(...kids.map(k => k.sat))) };",
    to:   "return { req, sat: kids.reduce((n, k) => n + k.sat, 0) };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: COURSE ignores its real credits (back to the modal unit)", file: DEMAND,
    from: "const req = sh(node.key) ?? unit;",
    to:   "const req = unit;", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: AND counts as ONE entry, not the sum of its courses", file: DEMAND,
    from: "return { req: parts.reduce((n, k) => n + k.req, 0),\n             sat: parts.reduce((n, k) => n + k.sat, 0) };",
    to:   "return { req: unit, sat: allocSection?.sat ? unit : 0 };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: XOM ignores the registrar's threshold", file: DEMAND,
    from: "return { req: node.reqSh ?? 0, sat: Math.min(node.reqSh ?? 0, node.satSh ?? 0) };",
    to:   "return { req: unit, sat: node?.sat ? unit : 0 };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: a childless section forgets its stated credit", file: DEMAND,
    from: "const req = allocSection?.statedSH > 0\n      ? allocSection.statedSH\n      : (allocSection?.minRequired ?? allocSection?.total ?? 0) * unit;",
    to:   "const req = (allocSection?.minRequired ?? allocSection?.total ?? 0) * unit;",
    run: [INVARIANT, UNITDEMAND] },

  // KNOWN EQUIVALENT, kept deliberately. `minRequirementCount >= children.length`
  // on every shipped section, so "the N cheapest of N" sums the same set as
  // "all of them". It survives because it cannot be killed, which is exactly
  // what the pick-N tripwire test records — if this ever starts being KILLED,
  // the corpus has gained a pick-N section and that branch now decides credit.
  { name: "credit: every section takes the pick-N path [EQUIVALENT]", file: DEMAND,
    from: "  if (min >= kids.length) {",
    to:   "  if (false) {", run: [INVARIANT, UNITDEMAND], equivalent: true },

  // ── Prose sections, and the restatements they must refuse ───────
  { name: "prose: the major SUBTOTAL is no longer refused", file: PARSER,
    from: "  if (/\\b(?:in|for|toward)\\s+the\\s+major\\b/i.test(text)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the degree TOTAL is no longer refused", file: PARSER,
    from: "  if (statedTotalIn(text, profile)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the total guard reverts to its own smaller pattern", file: PARSER,
    from: "  if (statedTotalIn(text, profile)) return null;",
    to:   "  if (/\\btotal\\s+(?:semester\\s+hours?|credits?)\\s+required\\b/i.test(text)) return null;",
    run: [PROSE] },

  { name: "prose: a GPA sentence is no longer refused", file: PARSER,
    from: "  if (/\\bGPA\\b/i.test(text)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the plausibility ceiling is removed", file: PARSER,
    from: "  return sh > 0 && sh <= 60 ? sh : null;",
    to:   "  return sh > 0 ? sh : null;", run: [PROSE] },

  { name: "prose: sections are dropped instead of emitted", file: PARSER,
    from: "      const sh = proseSectionSH(title, adjacentParas(headingIdx), profile);",
    to:   "      const sh = null && proseSectionSH(title, adjacentParas(headingIdx), profile);",
    run: [PROSE] },

  { name: "prose: the 'Electives Option' minOptions correction is reverted", file: PARSER,
    from: "  if (minOptions === 0 &&\n      concentrationOptions.some(o => /\\belectives?\\s+option\\b/i.test(o.title ?? ''))) {\n    minOptions = 1;\n  }",
    to:   "", run: [PROSE] },

  // ── The major subtotal, as a floor ──────────────────────────────
  { name: "floor: the subtotal is ADDED instead of used as a floor", file: RECORD,
    from: "  const gap = subtotal - demand;\n  if (gap <= 0) return null;",
    to:   "  const gap = subtotal;\n  if (gap <= 0) return null;", run: [SUBTOTAL] },

  { name: "floor: fires even when the parse already meets the subtotal", file: RECORD,
    from: "  if (gap <= 0) return null;",
    to:   "  if (gap < -999) return null;", run: [SUBTOTAL] },

  { name: "floor: guesses with no catalog instead of declining", file: RECORD,
    from: "  if (!subtotal || !courseMap || !Object.keys(courseMap).length) return null;",
    to:   "  if (!subtotal) return null;\n  courseMap = courseMap ?? {};", run: [SUBTOTAL] },

  { name: "floor: the emitted section enumerates a phantom course", file: RECORD,
    from: "    requirements: [],\n    notes: [`The catalog states ${subtotal} semester hours in the major. `",
    to:   "    requirements: [{ type: 'COURSE', subject: 'PHIL', classId: 9999 }],\n    notes: [`The catalog states ${subtotal} semester hours in the major. `",
    run: [SUBTOTAL] },

  { name: "subtotal: the plausibility bound is removed", file: PARSER,
    from: "      if (Number.isFinite(n) && n >= 12 && n <= 90) return n;",
    to:   "      if (Number.isFinite(n)) return n;", run: [SUBTOTAL] },

  // ── The 50% cap on double counting a minor ──────────────────────
  { name: "minor: the cap is a floor, not a ceiling (comparison flipped)", file: OVERLAP,
    from: "  const over  = dependentSH - capSH > EPS;",
    to:   "  const over  = capSH - dependentSH > EPS;", run: [MINOR] },

  { name: "minor: the cap is the whole requirement, not half of it", file: OVERLAP,
    from: "  const capSH = requiredSH * MINOR_SHARE_FRACTION;",
    to:   "  const capSH = requiredSH;", run: [MINOR] },

  { name: "minor: the verdict reverts to the plain shared sum", file: OVERLAP,
    from: "  const over  = dependentSH - capSH > EPS;",
    to:   "  const over  = sharedSH - capSH > EPS;", run: [MINOR] },

  { name: "minor: a course the major does not claim is counted as shared", file: OVERLAP,
    from: "  const sharedKeys = [...claimed].filter(k => major.has(k));",
    to:   "  const sharedKeys = [...claimed];", run: [MINOR] },

  { name: "minor: General Electives counts as a minor requirement", file: OVERLAP,
    from: "    section => section && section.title !== \"Required General Electives\"",
    to:   "    section => Boolean(section)", run: [MINOR] },

  { name: "minor: the withheld allocation is skipped (unique credit assumed zero)", file: OVERLAP,
    from: "  let uniqueSH = claimedSH;",
    to:   "  let uniqueSH = 0;", run: [MINOR] },

  { name: "minor: a course with no credit on record is charged the default 4", file: OVERLAP,
    from: "  const sharedSH = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);",
    to:   "  const sharedSH = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);",
    run: [MINOR] },

  { name: "minor: the printed note announces a breach that is not one", file: MODEL,
    from: "  return share.over",
    to:   "  return true", run: [MINOR] },

  // ── UNLOCKS lists a partner COURSE, not an edge ─────────────────
  { name: "unlocks: the dedup is defeated (every edge becomes a row)", file: COURSE,
    from: "    const row = byId.get(otherId);",
    to:   "    const row = null;", run: [PARTNERS] },

  { name: "unlocks: the strongest relation loses the tie-break", file: COURSE,
    from: "    } else if (rank(e.type) > rank(row.type)) {",
    to:   "    } else if (rank(e.type) < rank(row.type)) {", run: [PARTNERS] },

  { name: "unlocks: incoming prerequisites are listed too", file: COURSE,
    from: "    if (!isOut && !(coreq && e.to === id)) continue;",
    to:   "    if (false) continue;", run: [PARTNERS] },

  { name: "unlocks: a course becomes its own corequisite", file: COURSE,
    from: "    if (otherId === id) continue;              // a self-edge is not a relationship",
    to:   "", run: [PARTNERS] },

  { name: "total: the shared reader loses the doctoral form", file: PARSER,
    from: "    [new RegExp(`a\\\\s+minimum\\\\s+of\\\\s+${N}\\\\s+${UNIT}[^.]*?beyond\\\\s+the\\\\s+(?:under)?graduate\\\\s+degree`, 'i'),",
    to:   "    [new RegExp(`__never_matches__`, 'i'),", run: [MAJORPARSE, PROSE] },
];

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const selected = only ? MUTANTS.filter(m => m.name.includes(only)) : MUTANTS;

if (argv.includes("--list")) {
  for (const m of MUTANTS) console.log(`${m.equivalent ? "[equiv] " : "        "}${m.name}`);
  process.exit(0);
}

// A dirty target file would be reverted by `git checkout --`, destroying the
// work AND measuring HEAD rather than what the operator wrote. Both happened
// while this was being built, and the second is the dangerous one: the run
// looks like it passed judgement on your change when it never saw it.
const files = [...new Set(selected.map(m => m.file))];
const dirty = execSync(`git status --porcelain -- ${files.join(" ")}`, { cwd: ROOT })
  .toString().trim();
if (dirty) {
  console.error(`refusing to run: uncommitted changes in a file this mutates.\n${dirty}\n`
    + `Mutants are reverted with \`git checkout --\`, so this would discard that work and\n`
    + `measure HEAD instead of what you wrote. Commit or stash first.`);
  process.exit(2);
}

const restore = () => execSync(`git checkout -- ${files.join(" ")}`, { cwd: ROOT });

let killed = 0;
const survived = [], skipped = [];
for (const m of selected) {
  restore();
  const path = join(ROOT, m.file);
  const src = readFileSync(path, "utf8");
  const hits = src.split(m.from).length - 1;
  if (hits === 0) { skipped.push(m.name); console.log(`SKIP     ${m.name}   (anchor gone — this mutant tests nothing)`); continue; }
  if (hits > 1)   { skipped.push(m.name); console.log(`SKIP     ${m.name}   (anchor matches ${hits}x — not unique)`); continue; }
  writeFileSync(path, src.replace(m.from, m.to));
  let by = null;
  for (const cmd of m.run) {
    try { execSync(cmd, { cwd: ROOT, stdio: "pipe" }); }
    catch { by = cmd.split("node --test ")[1]; break; }
  }
  if (by) { killed++; console.log(`KILLED   ${m.name}   (by ${by})`); }
  else if (m.equivalent) { killed++; console.log(`survived ${m.name}   — expected: equivalent mutant`); }
  else { survived.push(m.name); console.log(`SURVIVED ${m.name}   <-- NOTHING CAUGHT THIS`); }
}
restore();

console.log(`\n${killed}/${selected.length} accounted for`);
if (survived.length) {
  console.log(`\n${survived.length} SURVIVED — a hole in the suite, or an equivalent mutant. Decide which:`);
  for (const s of survived) console.log(`  ${s}`);
}
if (skipped.length) {
  console.log(`\n${skipped.length} SKIPPED — re-anchor these or they silently stop testing:`);
  for (const s of skipped) console.log(`  ${s}`);
}
process.exit(survived.length || skipped.length ? 1 : 0);
