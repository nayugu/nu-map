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
const DESCCOREQ = "src/adapters/northeastern/descriptionCoreq.js";
const RETAIN  = "scripts/lib/course-retention.js";
const SCRAPER = "scripts/scrape-catalog.js";
const RETUNION = "scripts/derive-retired-union.js";
const PREREQ   = "scripts/lib/prereq-parse.js";

const INVARIANT  = "cd test/invariant && node --test requirement-credit-corpus.test.js";
const PROSE      = "cd test/contract  && node --test catalog-prose-sections.test.js";
const MAJORPARSE = "cd test/contract  && node --test major-parser.test.js";
const SUBTOTAL   = "cd test/contract  && node --test catalog-major-subtotal.test.js";
const UNITDEMAND = "cd test/unit      && node --test engine-demand.test.js engine-stated-cells.test.js";
const MINOR      = "cd test/unit      && node --test minor-overlap.test.js";
const UNLOCKS      = "cd test/unit      && node --test unlocked-courses.test.js";
const DESCOREQ_TEST = "cd test/unit      && node --test description-coreq.test.js";
const RETAIN_TEST   = "cd test/unit      && node --test course-retention.test.js";
const RETUNION_TEST = "cd test/unit      && node --test retired-union.test.js";
const PREREQ_TEST   = "cd test/unit      && node --test prereq-parse.test.js";

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
  //
  // Four of these SKIPPED the first time they were re-run, because the
  // major-side release moved their anchors — the exact failure this probe exits
  // non-zero on. Re-anchored, and the release has its own mutants below.
  { name: "minor: the cap is a floor, not a ceiling (comparison flipped)", file: OVERLAP,
    from: "  const over = dependentSH - capSH > EPS;",
    to:   "  const over = capSH - dependentSH > EPS;", run: [MINOR] },

  { name: "minor: the cap is the whole requirement, not half of it", file: OVERLAP,
    from: "  const capSH = requiredSH * MINOR_SHARE_FRACTION;",
    to:   "  const capSH = requiredSH;", run: [MINOR] },

  { name: "minor: the verdict reverts to the plain shared sum", file: OVERLAP,
    from: "  const over = dependentSH - capSH > EPS;",
    to:   "  const over = sharedSH - capSH > EPS;", run: [MINOR] },

  { name: "minor: a course the major does not claim is counted as shared", file: OVERLAP,
    from: "  const sharedKeys  = [...claimed].filter(k => major.has(k)).sort();",
    to:   "  const sharedKeys  = [...claimed].sort();", run: [MINOR] },

  { name: "minor: General Electives counts as a minor requirement", file: OVERLAP,
    from: "    section => section && section.title !== \"Required General Electives\"",
    to:   "    section => Boolean(section)", run: [MINOR] },

  { name: "minor: the withheld allocation is skipped (unique credit assumed zero)", file: OVERLAP,
    from: "  let uniqueSH = minorWithout(charged);",
    to:   "  let uniqueSH = 0;", run: [MINOR] },

  // ── Transfer and advanced standing share the same ceiling ───────
  { name: "minor: transfer credit gets its own budget instead of sharing one", file: OVERLAP,
    from: "  const charged = new Set([...major, ...outside]);",
    to:   "  const charged = new Set([...major]);", run: [MINOR] },

  { name: "minor: outside credit is charged even when the major already claims it", file: OVERLAP,
    from: "  const outsideOnly = [...claimed].filter(k => outside.has(k) && !major.has(k)).sort();",
    to:   "  const outsideOnly = [...claimed].filter(k => outside.has(k)).sort();", run: [MINOR] },

  { name: "minor: transfer credit becomes releasable like the major's", file: OVERLAP,
    from: "      const stillCharged = new Set([...charged].filter(\n        k => outside.has(k) || !releasedKeys.includes(k)));",
    to:   "      const stillCharged = new Set([...charged].filter(\n        k => !releasedKeys.includes(k)));", run: [MINOR] },

  { name: "minor: an ordinary grade counts as transferred", file: OVERLAP,
    from: "    if (grade === TRANSFER_GRADE) add(pid);",
    to:   "    if (grade != null) add(pid);", run: [MINOR] },

  { name: "minor: placed-out courses stop counting as advanced standing", file: OVERLAP,
    from: "  for (const id of placedOut ?? []) add(id);",
    to:   "", run: [MINOR] },

  // ── The major-side release ──────────────────────────────────────
  { name: "minor: the release runs whether or not the cap is exceeded", file: OVERLAP,
    from: "  if (dependentSH - capSH > EPS && typeof majorClaim === \"function\" && sharedKeys.length) {",
    to:   "  if (typeof majorClaim === \"function\" && sharedKeys.length) {", run: [MINOR] },

  { name: "minor: releases are tested one at a time, not accumulated", file: OVERLAP,
    from: "    const without = new Set(placed);\n    for (const r of released) without.delete(r);\n    without.delete(key);",
    to:   "    const without = new Set(placed);\n    without.delete(key);", run: [MINOR] },

  { name: "minor: the release compares TOTALS instead of per-section credit", file: OVERLAP,
    from: "    if (next.sat.every((sh, i) => sh >= base.sat[i] - EPS)) released.push(key);",
    to:   "    const sum = a => a.reduce((n, x) => n + x, 0);\n"
        + "    if (sum(next.sat) >= sum(base.sat) - EPS) released.push(key);", run: [MINOR] },

  { name: "minor: a throwing majorClaim takes the panel down with it", file: OVERLAP,
    from: "  const ask = (set) => { try { return majorClaim(set); } catch { return null; } };",
    to:   "  const ask = (set) => majorClaim(set);", run: [MINOR] },

  // ── majorClaimOf: one owner for "what the majors claim" ─────────
  // Load-bearing for three callers now — the panel, the board's badge and the
  // printed report — and the first two MUST agree, because a student can see
  // both at once.
  { name: "minor: the concentration is left out of the major's claim", file: OVERLAP,
    from: "      if (concentration) {",
    to:   "      if (false) {", run: [MINOR] },

  { name: "minor: the claim reports ONE total instead of per-section credit", file: OVERLAP,
    from: "      for (const s of all) sat.push(satisfiedOf(s, DEFAULT_UNIT_SH, courseMap));",
    to:   "      sat.push(all.reduce((n, s) => n + satisfiedOf(s, DEFAULT_UNIT_SH, courseMap), 0));",
    run: [MINOR] },

  { name: "minor: a junk program entry reaches the allocator", file: OVERLAP,
    from: "  const list = (programs ?? []).filter(p => p?.data);",
    to:   "  const list = programs ?? [];", run: [MINOR] },

  { name: "minor: a malformed majorClaim is trusted rather than declined", file: OVERLAP,
    from: "    if (!next || !Array.isArray(next.sat) || next.sat.length !== base.sat.length) continue;",
    to:   "    if (!next || !Array.isArray(next.sat)) continue;", run: [MINOR] },

  { name: "minor: a course with no credit on record is charged the default 4", file: OVERLAP,
    from: "  const sharedSH  = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);",
    to:   "  const sharedSH  = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);",
    run: [MINOR] },

  { name: "minor: the printed note announces a breach that is not one", file: MODEL,
    from: "  return share.over",
    to:   "  return true", run: [MINOR] },

  // ── UNLOCKS lists a COURSE, not an edge, and never a coreq ──────
  { name: "unlocks: the dedup is defeated (every edge becomes a row)", file: COURSE,
    from: "    if (seen.has(e.to)) continue;",
    to:   "", run: [UNLOCKS] },

  { name: "unlocks: corequisites are listed here again (the doubled lab)", file: COURSE,
    from: "    if (e.type === \"corequisite\" || e.type === \"corequisite-viol\") continue;",
    to:   "", run: [UNLOCKS] },

  { name: "unlocks: incoming prerequisites and self-edges are listed too", file: COURSE,
    from: "    if (e.from !== id || e.to === id) continue;",
    to:   "    if (e.from !== id && e.to !== id) continue;", run: [UNLOCKS] },

  // ── A corequisite stated in the description ─────────────────────
  // KNOWN EQUIVALENT, and the probe is what proved it. Deleting the "or" guard
  // changes nothing today: the operand list is split on commas and " and "
  // only, so any "or" stays INSIDE a segment ("or other 4-SH research course",
  // "PHYS 1151 or PHYS 1153") and that segment then fails the bare-code test,
  // which refuses the whole sentence anyway. So the BIOC 4900 test asserts the
  // right outcome for the wrong reason, which is worth knowing. The guard stays
  // because it becomes load-bearing the moment anyone adds "or" to the
  // separators — and a KILL here is the signal that they did.
  { name: "coreq prose: a CHOICE is read as a conjunction", file: DESCCOREQ,
    from: "  if (/\\bor\\b/i.test(body)) return [];",
    to:   "", run: [DESCOREQ_TEST], equivalent: true },

  { name: "coreq prose: prose among the operands is skipped, not refused", file: DESCCOREQ,
    from: "    if (!c) return [];                       // residue: refuse the sentence",
    to:   "    if (!c) continue;", run: [DESCOREQ_TEST] },

  { name: "coreq prose: a course becomes its own corequisite", file: DESCCOREQ,
    from: "    if (id === String(selfId).toUpperCase()) continue;   // never its own coreq",
    to:   "", run: [DESCOREQ_TEST] },

  { name: "coreq prose: the merge is a fallback, not a union", file: DESCCOREQ,
    from: "  for (const r of [...(Array.isArray(labelled) ? labelled : []),\n                   ...parseDescriptionCoreqs(description, selfId)]) {",
    to:   "  for (const r of (Array.isArray(labelled) ? labelled : [])) {", run: [DESCOREQ_TEST] },

  { name: "total: the shared reader loses the doctoral form", file: PARSER,
    from: "    [new RegExp(`a\\\\s+minimum\\\\s+of\\\\s+${N}\\\\s+${UNIT}[^.]*?beyond\\\\s+the\\\\s+(?:under)?graduate\\\\s+degree`, 'i'),",
    to:   "    [new RegExp(`__never_matches__`, 'i'),", run: [MAJORPARSE, PROSE] },

  // ── Course retention across a catalog edition roll ──────────────
  //
  // This module runs inside an unattended job that REPLACES the course
  // catalog, so each mutant below is a way it could do damage rather than
  // merely be wrong: slander a live course, unbound the file's growth, or
  // disarm the shrink rail that makes an operator look at a roll at all.

  { name: "retain: the shrink rail counts retained courses too", file: RETAIN,
    from: "  return courses.filter(c => c && typeof c === \"object\" && !c.retired).length;",
    to:   "  return courses.filter(c => c && typeof c === \"object\").length;", run: [RETAIN_TEST] },

  { name: "retain: a failed subject is retired like any other absence", file: RETAIN,
    from: "    if (failed.has(String(c.subject ?? \"\").replace(/\\s+/g, \"\").toUpperCase())) continue;",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: everything absent is kept, referenced or not", file: RETAIN,
    from: "    if (!need.has(key)) { dropped.push(key); continue; }",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: retiredSince is re-dated on every run", file: RETAIN,
    from: "      retiredSince: typeof c.retiredSince === \"string\" && c.retiredSince ? c.retiredSince : stamp,",
    to:   "      retiredSince: stamp,", run: [RETAIN_TEST] },

  { name: "retain: a revived course keeps its retirement marker", file: RETAIN,
    from: "    if (c && typeof c === \"object\" && (c.retired || c.retiredSince)) {",
    to:   "    if (false) {", run: [RETAIN_TEST] },

  { name: "retain: duplicate keys in the snapshot duplicate the entry", file: RETAIN,
    from: "    if (seen.has(key)) continue;",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: a malformed tree key protects a fictional course", file: RETAIN,
    from: "          const m = /^([A-Za-z]+)\\s*([0-9][0-9A-Za-z]*)$/.exec(String(raw ?? \"\").trim());\n          const key = m ? normalizeKey(m[1], m[2]) : null;",
    to:   "          const key = String(raw ?? \"\").trim().toUpperCase() || null;", run: [RETAIN_TEST] },

  { name: "retain: an unreadable requirements.json fails the scrape", file: RETAIN,
    from: "      let program;\n      try {\n        program = JSON.parse(io.readFile(path));\n      } catch {\n        unreadable++;\n        io.warn?.(`could not read ${path} — its courses are not protected this run`);\n        continue;\n      }",
    to:   "      const program = JSON.parse(io.readFile(path));", run: [RETAIN_TEST] },

  { name: "retain: a half-key is accepted as a key", file: RETAIN,
    from: "  return s && n ? `${s}${n}` : null;",
    to:   "  return `${s}${n}`;", run: [RETAIN_TEST] },

  // The wiring, which the pure functions cannot hold on their own.
  { name: "retain/wiring: the rail counts the committed file raw again", file: SCRAPER,
    from: "      const prevCount = activeCourseCount(JSON.parse(readFileSync(CATALOG_OUT, \"utf8\")));",
    to:   "      const prevCount = JSON.parse(readFileSync(CATALOG_OUT, \"utf8\")).length;",
    run: [RETAIN_TEST] },

  { name: "retain/wiring: the rail compares raw lengths again", file: SCRAPER,
    from: "      const liveCount = activeCourseCount(out);\n      if (prevCount > 0 && liveCount < floor) {",
    to:   "      const liveCount = out.length;\n      if (prevCount > 0 && out.length < floor) {",
    run: [RETAIN_TEST] },

  { name: "retain/wiring: runRotate keeps a stale retirement marker", file: SCRAPER,
    from: "        retired: undefined, retiredSince: undefined,\n        title:        cat.title        || prev.title,",
    to:   "        title:        cat.title        || prev.title,", run: [RETAIN_TEST] },

  { name: "retain/wiring: runSubjects keeps a stale retirement marker", file: SCRAPER,
    from: "          retired: undefined, retiredSince: undefined,\n          title:        cat.title        || prev.title,",
    to:   "          title:        cat.title        || prev.title,", run: [RETAIN_TEST] },

  // ── The retired union: a plan's courses survive the edition roll ──
  //
  // This module reports "0 courses" against the repo as it stands — the frozen
  // 2026 snapshot IS the shipped catalog — so every one of these mutants is
  // invisible to a report-only run and can only be caught by the simulated
  // roll in the unit test. That is precisely what they are here to verify.
  { name: "union: a course still in the catalog is ALSO reported retired", file: RETUNION,
    from: "    if (current.has(key)) continue;          // still published — not retired",
    to:   "", run: [RETUNION_TEST] },

  // Isolated to the RECORD: `from` is still updated, so fidelity stays correct
  // and this can only be killed by a test that checks which edition's copy of
  // the course survived. A cruder mutant that dropped both would die for the
  // wrong reason and tell us nothing about that.
  { name: "union: the OLDEST edition's record wins, not the newest", file: RETUNION,
    from: "      if (prior) { prior.record = c; prior.from = year; prior.editions.add(year); }",
    to:   "      if (prior) { prior.from = year; prior.editions.add(year); }", run: [RETUNION_TEST] },

  { name: "union: fidelity is taken from the span's START, not the record's edition", file: RETUNION,
    from: "        fidelity: fidelityOfEdition(from),",
    to:   "        fidelity: fidelityOfEdition(years[0]),", run: [RETUNION_TEST] },

  { name: "union: every record is assumed full fidelity", file: RETUNION,
    from: "        fidelity: fidelityOfEdition(from),",
    to:   "        fidelity: \"full\",", run: [RETUNION_TEST] },

  { name: "union: editions are used in directory order, unsorted", file: RETUNION,
    from: "  const ordered = [...snapshots].sort((a, b) => a.year - b.year);",
    to:   "  const ordered = [...snapshots];", run: [RETUNION_TEST] },

  // ── Legacy (Mills) course numbers in prereq text ────────────────────────
  //
  // This defect reached main: an unreadable OR-branch parsed to nothing and
  // left the operator on BOTH sides, corrupting 513 prereq trees. These
  // mutants exist because the bug was invisible to every unit test at the
  // time — the suite asserted what the parser produced for inputs that parsed,
  // and said nothing about a tree coming back malformed.
  { name: "prereq: a legacy course number stops being note-worthy", file: PREREQ,
    from: "  NOTE_SIGNAL.test(note) || SCORE_GATE.test(note) || LEGACY_COURSE.test(note);",
    to:   "  NOTE_SIGNAL.test(note) || SCORE_GATE.test(note);", run: [PREREQ_TEST] },

  // The half of the fix that LOOKED complete. Reverting only the cleanNote
  // guard still leaves 4-digit-subject legacy codes working, so a test that
  // checked one example of the fix would pass here — it has to reach a
  // two-letter subject specifically.
  { name: "prereq: cleanNote's word guard drops two-letter legacy subjects", file: PREREQ,
    from: "  return /[a-z]{3,}/i.test(s) || LEGACY_COURSE.test(s) ? s : null;",
    to:   "  return /[a-z]{3,}/i.test(s) ? s : null;", run: [PREREQ_TEST] },

  // The dangerous direction. If the anchor goes, a REAL four-digit course
  // becomes inert prose and every prereq in the catalog stops being enforced —
  // a silent, catalog-wide disarming rather than a visible break.
  { name: "prereq: LEGACY_COURSE loses its anchors and swallows real codes", file: PREREQ,
    from: "const LEGACY_COURSE = /^(?:[A-Z]{2,6}\\s+\\d{2,3}[A-Z]{0,2}\\s*)+$/;",
    to:   "const LEGACY_COURSE = /(?:[A-Z]{2,6}\\s+\\d{2,3}[A-Z]{0,2}\\s*)+/;", run: [PREREQ_TEST] },

  { name: "union: a stale retiredSince rides along beside the lifespan", file: RETUNION,
    from: "    const { retired: _r, retiredSince: _s, ...clean } = record;",
    to:   "    const clean = record;", run: [RETUNION_TEST] },

  { name: "union: lifespan claims every edition held, not the ones that carried it", file: RETUNION,
    from: "        firstEdition: years[0],\n        lastEdition:  years[years.length - 1],\n        editions:     years,",
    to:   "        firstEdition: ordered[0]?.year,\n        lastEdition:  ordered[ordered.length - 1]?.year,\n        editions:     ordered.map(e => e.year),", run: [RETUNION_TEST] },
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
