// ═══════════════════════════════════════════════════════════════════
// INVARIANT · no script reads the program corpus at a hard-coded edition.
//
// ── Why this is a test and not a code review note ───────────────────
//
// Audited 2026-09-10, right after the graduate tree rolled to 2027. Ten scripts read the
// program corpus. TWO resolved the edition correctly — and did it by keeping near-identical
// private copies of the same seven lines. SIX hard-coded `2026`, among them `corpus-ask.js`
// and `corpus-snapshot.js`, which CLAUDE.md names as THE way to ask a question about the
// corpus. `corpus-ask` was answering every question about 1,071 programs of a superseded
// catalog when the shipped corpus was 1,304.
//
// A pinned edition in an INSTRUMENT is worse than one in a feature, and it is worth being
// precise about why: it does not fail. It answers, in the right format, with a plausible
// number, about last year's data. Every rule in CLAUDE.md's working method — measure before
// designing, argue from the corpus, re-derive your most confident claim — routes through
// these scripts, so a silently stale instrument does not merely produce one wrong answer.
// It launders wrong answers as measurements.
//
// The defect also has a period of ONE YEAR: it is correct on the day it is written and
// becomes wrong at the next roll, quietly, with nobody touching the file. That is the same
// shape as `catalog-covers-programs`, and it is the reason this cannot be held by anyone
// remembering it.
//
// ── What this permits ───────────────────────────────────────────────
//
// A year LITERAL is fine in a comment, in a test fixture, or as an `--edition` argument a
// human typed. What is banned is a path into `data/northeastern/programs/` with a year baked
// into it, because that is the construct that silently selects an edition. `newestEditionHeld`
// is the one way to choose, and it still honours `--edition YYYY` for the legitimate case of
// pinning a measurement to a frozen edition so its answer stops moving.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every .js under scripts/, including lib/. */
function scriptFiles(dir = join(ROOT, "scripts"), out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { scriptFiles(p, out); continue; }
    if (e.endsWith(".js")) out.push(p);
  }
  return out;
}

/**
 * A program-corpus path with a year baked into it.
 *
 * Deliberately narrow. It matches `programs/<tree>/2026` and `programs/${lvl}/2026` — the
 * two spellings that actually occurred — and not a bare `2026` anywhere else, because a year
 * in a comment or a fixture is not a defect and a pattern that flagged those would be turned
 * off rather than obeyed.
 */
const PINNED = new RegExp([
  // `…/programs/undergraduate/2026` and `…/programs/${lvl}/2026` — the year as a path segment.
  String.raw`programs[^\n"'\`]{0,40}\/(?:19|20)\d{2}\b`,
  // `join(root, ".../programs", lvl, "2026")` — the year as a separate path ARGUMENT.
  // This form was missed by the first version of the pattern, which only looked for a
  // slash. Two of the eight offenders were written this way, including corpus-snapshot's,
  // so a slash-only guard would have passed the primary instrument straight through.
  String.raw`programs["'\`][^\n]{0,40}?["'\`](?:19|20)\d{2}["'\`]`,
].join("|"));

// Scripts that legitimately name a year in a corpus path. Empty, and it is meant to stay
// that way: an entry here is a script whose answer silently stops tracking what we ship.
// If one is ever needed, say in the comment WHY that script must not follow the roll.
const ALLOWED = new Set([]);

test("no script selects a program edition by hard-coding the year", () => {
  const offenders = [];
  for (const file of scriptFiles()) {
    const rel = file.slice(ROOT.length);
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Comments are prose about the defect — this file's own history is full of them.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (PINNED.test(code)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }

  assert.deepEqual(offenders, [],
    `${offenders.length} script(s) read the program corpus at a hard-coded edition. They do `
    + `not fail at a roll — they answer confidently about a catalog we no longer ship. Use `
    + `newestEditionHeld(root, tree, argv) from scripts/lib/catalog-edition.js:\n  `
    + offenders.join("\n  "));
});

test("the guard would actually catch the shapes that shipped", () => {
  // Guard the guard. A pattern that matches nothing passes this file forever, and every one
  // of these is a line that was really in the tree this morning.
  for (const shipped of [
    'const ROOT = "data/northeastern/programs/undergraduate/2026";',
    'const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);',
    'const base = join(root, "data/northeastern/programs", lvl, "2026");',
    'const base = join(ROOT, "data/northeastern/programs/undergraduate/2026");',
  ]) {
    assert.ok(PINNED.test(shipped), `the guard would have missed: ${shipped}`);
  }

  // ...and must not fire on the legitimate forms, or it gets switched off.
  for (const fine of [
    'const base = join(ROOT, "data/northeastern/programs", lvl, String(newestEditionHeld(ROOT, lvl)));',
    'const EDITION = newestEditionHeld(ROOT, "undergraduate", argv);',
    'node scripts/verify-chart.js --all --edition 2026',
    'const rng = 20260822;',
  ]) {
    assert.ok(!PINNED.test(fine.replace(/\/\/.*$/, "")), `the guard is too broad: ${fine}`);
  }
});
