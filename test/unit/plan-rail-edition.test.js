// ═══════════════════════════════════════════════════════════════════
// The sample-plan rail must survive a catalog edition roll.
//
// ── The bug this exists for ─────────────────────────────────────────
//
// `checkPlanRail` exists to notice a fleet-wide disappearance of Sample Plans
// of Study, and its own comment anticipates the event: "departments are moving
// plans off the catalog onto their own pages (advisors, Aug 2026), so plans
// really will start vanishing upstream".
//
// It happened on 2026-09-02. The live 2027 scrape parsed **0** sample plans
// against **349** committed for 2026 — NEU removed the pane from the
// undergraduate pages — and the rail said nothing at all, because the count it
// compares against came from `listCommittedPlans()`, which is scoped to the
// edition being WRITTEN. A new edition has no plans yet, so `prevPlans` was 0,
// `checkPlanRail(0, 0)` returns `deleteOk` with no reason, and the loss passed
// in silence on the one run that could have reported it.
//
// Same shape as the two other edition-blind guards found the same day: the
// verification ratchet (ids carry the year) and check-major-integrity (paths
// carry the year). A guard keyed on something that changes at a roll is a guard
// that switches itself off at the roll.
//
// ── Why this is a source-level check ────────────────────────────────
//
// `planBaselineCount` closes over module-level `YEAR` and `OUT_ROOT`, both
// resolved at import time from argv and the environment, so there is no seam to
// drive it through without inventing one. What is worth protecting is the
// decision — that the rail is given a count from an EARLIER edition when this
// one is empty — and that is visible in the source. The rail's arithmetic
// itself is covered by scrape-rails' own tests; this pins the number it is fed.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlanRail } from "../../scripts/lib/scrape-rails.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

for (const scraper of ["scrape-majors.js", "scrape-grad-majors.js"]) {
  const src = readFileSync(join(ROOT, "scripts", scraper), "utf8");

  test(`${scraper}: the plan rail is fed a count that survives an edition roll`, () => {
    assert.match(src, /const prevPlans = EDITION \? 0 : planBaselineCount\(\)/,
      `${scraper} feeds the plan rail an edition-scoped count again — on the first scrape of a `
      + `new year that is always 0, and a fleet-wide plan loss becomes invisible`);
    // …and the helper must actually look at earlier years, not just rename the old call.
    const helper = src.slice(src.indexOf("function planBaselineCount"));
    assert.match(helper.slice(0, 700), /Number\(y\) < YEAR/,
      `${scraper}'s planBaselineCount does not consult any earlier edition`);
  });
}

test("the rail fires on the numbers the 2027 scrape actually produced", () => {
  // 0 parsed, 349 committed for 2026. This is the message that should have been
  // printed on 2026-09-02 and was not.
  const silent = checkPlanRail(0, 0);
  assert.equal(silent.deleteOk, true, "0 vs 0 cannot fire — which is precisely why the count matters");

  const loud = checkPlanRail(0, 349);
  assert.equal(loud.deleteOk, false);
  assert.match(loud.reason, /349 → 0/);
  assert.match(loud.reason, /KEPT rather than deleted/,
    "the plans on disk must be held, not deleted, while a human decides");
});

test("a single program dropping its plan is still not an alarm", () => {
  // The rail warns on a FLEET-wide loss only; ordinary churn must pass, or the
  // warning becomes noise and stops being read.
  assert.equal(checkPlanRail(348, 349).deleteOk, true);
  assert.equal(checkPlanRail(300, 349).deleteOk, true, "25% is the documented tolerance");
  assert.equal(checkPlanRail(260, 349).deleteOk, false, "just past it must fire");
});
