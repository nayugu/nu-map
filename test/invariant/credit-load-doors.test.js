// INVARIANT · a term's credit load is judged in exactly one place.
//
// This is a drift bug of the kind that cannot be caught behaviourally, because the defect is the
// existence of a SECOND door rather than the behaviour of any one of them. Four surfaces drew the
// same fact and each had grown its own rule:
//
//     SemRow                fall/spring   compared to the cap, red + ⚠
//     SummerRow             summer        hard-coded `var(--success)`, NEVER compared to anything
//     MiniPlanGrid          the preview AND the walkthrough, flat `--text-5`, never compared
//     plannerQueryAdapter   MCP           `sem.weight === 1 && sh > shMax`, so never for a summer
//
// So one plan reported four different verdicts about the same term depending on which surface a
// student happened to be looking at: a 30 SH summer was GREEN in the planner, grey in the preview
// and clean over MCP, while a 20 SH fall was red in the planner and unremarkable in the preview —
// the very term the generator panel warns about two sections down.
//
// A test that asserts "20 SH warns" passes on all four surfaces the day it is written and says
// nothing about the fifth surface someone adds next month. So these check the SHAPE: the verdict
// comes from `core/creditLoad.js`, and no surface re-derives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Every surface that renders or reports a term's credit load to a human or to Claude. */
const DOORS = [
  "src/ui/SemRow.jsx",
  "src/ui/SummerRow.jsx",
  "src/ui/MiniPlanGrid.jsx",
  "src/adapters/mcp/plannerQueryAdapter.js",
];

test("credit load › every surface that judges a load imports the shared rule", () => {
  for (const f of DOORS) {
    const src = read(f);
    assert.match(src, /from ["'][^"']*core\/creditLoad\.js["']/,
      `${f} shows a term's credit load but does not import core/creditLoad.js. `
      + `Add the import and route the verdict through loadState/isOverCap — a fifth private `
      + `copy of this rule is how the summer row came to be permanently green.`);
  }
});

test("credit load › no surface re-derives the verdict with a bare comparison", () => {
  // The ENGINE is exempt and deliberately so: `search.js` and `index.js` do capacity arithmetic
  // to decide whether a course FITS, which is a different question from whether to warn a
  // student. Keeping them separate is the point — `firstTermHeadroom` lets the generator plan a
  // published first-semester overload that the planner then still marks.
  for (const f of DOORS) {
    const src = read(f);
    for (const [i, line] of src.split("\n").entries()) {
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      assert.doesNotMatch(code, /\b(sh|load|total\w*|combined\w*)\s*>\s*(shMax|termMax|cap)\b/i,
        `${f}:${i + 1} compares a load to a cap directly:\n    ${line.trim()}\n`
        + `Use isOverCap/loadState so every surface reaches the same verdict.`);
    }
  }
});

test("credit load › the mini grid renders a load in exactly ONE place", () => {
  // Four label variants draw a load — the summer row's combined column, a summer HALF inline, the
  // dense walkthrough line and the full preview line. Each formatted the number itself, which is
  // four places for the ⚠ to be forgotten. They now all render `<LoadSH>`, so the raw
  // `{sh} {unit}` template must appear exactly once: inside LoadSH.
  const src = read("src/ui/MiniPlanGrid.jsx");
  const raw = src.split("\n").filter(l => l.includes("{sh} {unit}"));
  assert.equal(raw.length, 1,
    `${raw.length} places format a load directly instead of rendering <LoadSH>:\n`
    + raw.map(l => `    ${l.trim()}`).join("\n"));
  assert.match(src, /function LoadSH\(/, "LoadSH is gone but its callers are not");
  // And it must be the one INSIDE LoadSH, not a stray fifth site with LoadSH sitting unused.
  const body = src.slice(src.indexOf("function LoadSH("));
  assert.ok(body.includes("{sh} {unit}"),
    "the single raw load template is not inside LoadSH — something else is formatting it");
});

test("credit load › the summer row no longer hard-codes success for its combined load", () => {
  // The original defect, pinned by name. `combinedSH` was drawn `var(--success)` unconditionally
  // on both the phone and the desktop label, so summer was the one row in the planner that could
  // not report an overload at any load.
  const src = read("src/ui/SummerRow.jsx");
  for (const [i, line] of src.split("\n").entries()) {
    if (!line.includes("combinedSH >")) continue;
    assert.doesNotMatch(line, /color:\s*"var\(--success\)"/,
      `SummerRow.jsx:${i + 1} draws the combined summer load in unconditional success colour:\n`
      + `    ${line.trim()}\n`
      + `Summer is capped as a whole — two 12 SH halves are 24 SH and must warn.`);
  }
  // Both label variants must carry the mark, not just the desktop one.
  const marks = src.split("\n").filter(l => l.includes("summerOverCap ?") && l.includes("⚠"));
  assert.equal(marks.length, 2,
    `${marks.length} of the 2 summer labels (phone + desktop) show the overload mark`);
});
