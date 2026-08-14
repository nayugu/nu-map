// INVARIANT · data/northeastern/programs/undergraduate + data/northeastern/programs/graduate — requirement satisfiability.
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
import {
  findImpossibleSections, BASELINE,
  findOverconsumingPools, OVERCONSUMPTION_BASELINE,
} from "../../scripts/check-major-integrity.js";

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

// Catches the failure mode findImpossibleSections cannot see: a pool that stays
// technically satisfiable (so it never goes "impossible") but silently consumes more
// named-course credit than its own numCreditsMin needed, starving a later section that
// lists the same courses (see the Media Arts BFA "Electives Option" case that motivated
// the XOM/RANGE consumption cap in src/core/gradRequirements.js).
test("majors › no NEW pools over-consuming named-course credit beyond their threshold", () => {
  const current = findOverconsumingPools();
  const baseline = new Set(JSON.parse(readFileSync(OVERCONSUMPTION_BASELINE, "utf8")));
  const added = current.filter((f) => !baseline.has(f)).sort();
  assert.deepEqual(
    added,
    [],
    `New over-consuming pool section(s): a pool consumed more credit than its numCreditsMin\n` +
      `needed, which can starve a later section listing the same courses. Check for a\n` +
      `regression in the XOM/RANGE consumption cap (src/core/gradRequirements.js), or accept\n` +
      `via \`node scripts/check-major-integrity.js --update\`:\n  ` +
      added.join("\n  ")
  );
});
