// INVARIANT · every prereq tree in the shipped catalog parses to completion.
//
// A token that is neither an operand nor the operator its position expects ends
// the parse, and everything after it is discarded — so an incomplete parse means
// the app is silently ignoring real prerequisites. See prereqFold.js for why the
// parser reports this rather than guessing a recovery.
//
// This is a scrape gate, not a unit test: the monthly job pushes to main
// unattended, so the day upstream starts emitting malformed trees has to be loud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prereqParseComplete } from "../../src/core/prereqFold.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));

test("catalog › every prereq tree parses to completion", () => {
  const bad = [];
  let trees = 0;
  for (const c of raw) {
    const t = c.prereqs;
    if (!Array.isArray(t) || !t.length) continue;
    trees++;
    if (!prereqParseComplete(t)) {
      bad.push(`${c.subject}${c.number}: ${JSON.stringify(t).slice(0, 180)}`);
    }
  }
  assert.ok(trees > 2000, `expected thousands of prereq trees, saw ${trees}`);
  assert.deepEqual(bad, [],
    `${bad.length} of ${trees} prereq trees truncate — refs after the bad token ` +
    `are being silently dropped:\n  ${bad.slice(0, 10).join("\n  ")}`);
});

test("catalog › patched sub-expressions parse to completion too", () => {
  // Nested arrays come from PREREQ_EXTRA patches, which are hand-written and so
  // are the likeliest source of a malformed list.
  const bad = [];
  let nested = 0;
  const check = (id, t) => {
    for (const tok of t ?? []) {
      if (!Array.isArray(tok)) continue;
      nested++;
      if (!prereqParseComplete(tok)) bad.push(`${id}: ${JSON.stringify(tok).slice(0, 180)}`);
      check(id, tok);
    }
  };
  for (const c of raw) check(`${c.subject}${c.number}`, c.prereqs);
  assert.deepEqual(bad, [], `${bad.length} of ${nested} patched sub-expressions truncate`);
});
