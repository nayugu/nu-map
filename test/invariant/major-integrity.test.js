// INVARIANT · src/data/majors + src/data/grad-majors — requirement satisfiability.
//
// Guards against "impossible-to-satisfy" requirement sections (a course required
// in two sections without being marked split/shared credit). The detection logic
// and its committed baseline live in scripts/check-major-integrity.js (a CLI tool
// with --update/--list modes for maintaining the baseline); this wraps it as an
// assertion so the invariant runs in the normal suite. Fails only on NEW breakage.
//   Accept intended debt: `node scripts/check-major-integrity.js --update`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findImpossibleSections, BASELINE } from "../../scripts/check-major-integrity.js";

test("majors › no NEW impossible-to-satisfy requirement sections", () => {
  const current = findImpossibleSections();
  const baseline = new Set(JSON.parse(readFileSync(BASELINE, "utf8")));
  const added = current.filter((f) => !baseline.has(f)).sort();
  assert.deepEqual(
    added,
    [],
    `New impossible section(s): a required course is consumed by an earlier section.\n` +
      `Fix in scrape-majors.js (emit split-credit XOM) or accept via ` +
      `\`node scripts/check-major-integrity.js --update\`:\n  ` +
      added.join("\n  ")
  );
});
