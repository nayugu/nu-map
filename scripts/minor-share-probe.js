#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// MINOR-SHARE PROBE — sweep (major, minor) pairs through the 50% cap.
//
// `src/core/minorOverlap.js` is the most-measured module in this repo and
// every one of those measurements — "19 of 6,920 pairs fire, 1 falsely",
// "derived equals stated on 9 of 10" — was made by a script written in a chat
// and thrown away. So the next question about the cap paid full price again.
// This is that script, committed.
//
// The student it simulates is the worst case the rule cares about: someone who
// has taken exactly the courses their minor names. Anything the major claims is
// then double counted by construction, which is what makes the sweep a probe of
// the CAP rather than of one person's plan.
//
//   node scripts/minor-share-probe.js                  # 40 majors x all minors
//   node scripts/minor-share-probe.js --majors 120     # wider
//   node scripts/minor-share-probe.js --verbose        # every firing pair
//
// Prints, for each pair that is over the cap, how the reported overage differs
// between the CEILING reading (`dependentSH - capSH`) and the WHOLE-COURSE one
// (`dependentSH - usableSH`) — and asserts the two never disagree about
// whether a pair is over at all, which is the property that makes the
// whole-course reading safe to ship.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
// fileURLToPath, not URL.pathname — pathname keeps "%20" for a checkout whose
// path contains a space, and every read below then ENOENTs.
import { fileURLToPath } from "node:url";
import { minorShare, minorRequirementSections, majorClaimOf } from "../src/core/minorOverlap.js";
import { courseKey } from "../src/core/gradRequirements.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UG = join(ROOT, "data/northeastern/programs/undergraduate/2026");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const VERBOSE = process.argv.includes("--verbose");
const MAJOR_LIMIT = arg("--majors", 40);

/** Every requirements.json under the undergraduate tree, with its slug. */
function programs() {
  const out = [];
  for (const college of readdirSync(UG)) {
    const dir = join(UG, college);
    for (const slug of readdirSync(dir)) {
      const file = join(dir, slug, "requirements.json");
      if (!existsSync(file)) continue;
      out.push({ slug, college, file });
    }
  }
  return out;
}

const courseMap = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"))
    .map(c => [courseKey(c.subject, c.number),
               { ...c, sh: c.credits, id: courseKey(c.subject, c.number) }]));

/** Course keys a program's requirement sections name, at any depth. */
function keysOf(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (node.type === "COURSE" && node.subject && node.classId != null) {
    into.add(courseKey(node.subject, node.classId));
  }
  for (const k of ["requirements", "courses", "children", "requirementSections"]) {
    if (Array.isArray(node[k])) node[k].forEach(n => keysOf(n, into));
  }
  return into;
}

const all = programs();
const minors = all.filter(p => p.slug.endsWith("_minor"))
  .map(p => ({ ...p, data: JSON.parse(readFileSync(p.file, "utf8")) }))
  .filter(p => minorRequirementSections(p.data).length > 0);
const majors = all.filter(p => !p.slug.endsWith("_minor")).slice(0, MAJOR_LIMIT)
  .map(p => ({ ...p, data: JSON.parse(readFileSync(p.file, "utf8")) }));

console.log(`sweeping ${majors.length} majors x ${minors.length} minors ` +
            `= ${majors.length * minors.length} pairs`);

let pairs = 0, fired = 0, changed = 0, flipped = 0, deltaSum = 0;
const examples = [];

for (const minor of minors) {
  // The student took exactly what the minor names.
  const placed = new Set();
  for (const s of minorRequirementSections(minor.data)) keysOf(s, placed);
  if (!placed.size) continue;

  for (const major of majors) {
    const claim = majorClaimOf([{ data: major.data, concentration: null }], courseMap);
    let share;
    try {
      share = minorShare({ minor: minor.data, placedSet: placed,
                           majorKeys: claim(placed).claimed, courseMap, majorClaim: claim });
    } catch { continue; }
    if (!share) continue;
    pairs++;
    if (!share.over) continue;
    fired++;

    const ceilingOver = share.dependentSH - share.capSH;
    const courseOver  = share.overSH;
    // The safety property: the whole-course reading may report MORE waste, and
    // must never turn a compliant pair into a breach or the reverse.
    if ((ceilingOver > 0) !== (courseOver > 0)) flipped++;
    if (Math.abs(courseOver - ceilingOver) > 1e-9) {
      changed++;
      deltaSum += courseOver - ceilingOver;
      if (examples.length < 12 || VERBOSE) {
        examples.push(`${minor.slug} × ${major.slug}: ` +
          `${share.dependentSH} shared, cap ${share.capSH}, usable ${share.usableSH} ` +
          `→ over ${ceilingOver} → ${courseOver}`);
      }
    }
  }
}

console.log(`\npairs measured      ${pairs}`);
console.log(`over the cap        ${fired}`);
console.log(`overage restated    ${changed}` +
            (changed ? `  (mean +${(deltaSum / changed).toFixed(2)} SH)` : ""));
console.log(`verdicts flipped    ${flipped}${flipped ? "  ← MUST BE 0" : "  ✓"}`);
if (examples.length) console.log("\n" + examples.join("\n"));
process.exit(flipped === 0 ? 0 : 1);
