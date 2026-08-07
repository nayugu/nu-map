// Write rails — the guard that refuses a whole scrape run when it looks
// like upstream breakage rather than data drift. These jobs push straight
// to main unattended, so the rails are the only thing between a catalog
// markup change and ~1,000 gutted program files.
//
// Focus here is the CATALOG-EDITION ROLL: it happens once a year, so it is
// the case least likely to be caught by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScrapeRails, checkPlanRail } from "../../scripts/lib/scrape-rails.js";

const prog = (sections = 3) => ({
  requirementSections: Array.from({ length: sections }, () => ({})),
});
const mapOf = (n, sections = 3, prefix = "p") =>
  new Map(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, prog(sections)]));

test("rails › a healthy run passes", () => {
  const { ok } = checkScrapeRails({
    discovered: 500, failed: 2, results: mapOf(500), previous: mapOf(500),
  });
  assert.equal(ok, true);
});

test("rails › a fleet-wide collapse is refused", () => {
  const { ok, failures } = checkScrapeRails({
    discovered: 500, failed: 0, results: mapOf(500, 0), previous: mapOf(500, 3),
  });
  assert.equal(ok, false);
  assert.ok(failures.some(f => /previously parsed now yield nothing/.test(f)), failures.join(" | "));
});

// ── the edition roll ────────────────────────────────────────────────
// `previous` is scoped to the edition being written, so the first scrape of
// a new catalog year legitimately has none. Two things must hold: the roll
// is not blocked, and the run is not left completely unguarded.

test("roll › a brand-new edition is NOT blocked by having no prior files", () => {
  // Paths all belong to the new edition; previous (this edition) is empty.
  const { ok } = checkScrapeRails({
    discovered: 500, failed: 1, results: mapOf(500, 3, "2027/"), previous: new Map(),
    baselineCount: 500,
  });
  assert.equal(ok, true);
});

test("roll › the discovery floor still applies on a new edition, via the baseline", () => {
  // The sitemap breaks during the roll: only 40 of ~500 URLs come back.
  const { ok, failures } = checkScrapeRails({
    discovered: 40, failed: 0, results: mapOf(40, 3, "2027/"), previous: new Map(),
    baselineCount: 500,
  });
  assert.equal(ok, false, "a broken sitemap during an edition roll must still be caught");
  assert.ok(failures.some(f => /program URLs discovered/.test(f)), failures.join(" | "));
});

test("roll › with no baseline at all (the very first run) the floor cannot fire", () => {
  const { ok } = checkScrapeRails({
    discovered: 40, failed: 0, results: mapOf(40), previous: new Map(), baselineCount: 0,
  });
  assert.equal(ok, true);
});

test("roll › the fetch-failure rail is edition-independent and still fires", () => {
  const { ok, failures } = checkScrapeRails({
    discovered: 500, failed: 100, results: mapOf(400, 3, "2027/"), previous: new Map(),
    baselineCount: 500,
  });
  assert.equal(ok, false);
  assert.ok(failures.some(f => /failed to fetch/.test(f)), failures.join(" | "));
});

// ── The sample-plan rail ─────────────────────────────────────────────────────
//
// Shaped deliberately unlike the rails above: it holds DELETIONS instead of
// refusing the run. Departments are moving sample plans off the catalog onto
// their own pages, so plans really will vanish upstream, and a hard failure
// would eventually block every requirements update for an unrelated reason.

test("plan rail › a single program dropping its plan is normal", () => {
  const { deleteOk } = checkPlanRail(387, 388);
  assert.equal(deleteOk, true, "one removal must go straight through");
});

test("plan rail › a fleet-wide loss holds the deletions and explains itself", () => {
  const { deleteOk, reason } = checkPlanRail(40, 388);
  assert.equal(deleteOk, false);
  assert.match(reason, /388 → 40/);
  // The message must say what DID happen, not only what didn't — this is the
  // only signal a human gets from an unattended run.
  assert.match(reason, /Requirements were written/);
});

test("plan rail › exactly at the floor still deletes", () => {
  // 25% loss allowed: 388 → 291 is the boundary and must not trip.
  assert.equal(checkPlanRail(291, 388).deleteOk, true);
  assert.equal(checkPlanRail(290, 388).deleteOk, false);
});

test("plan rail › the first run has nothing to protect", () => {
  // No committed plans means no deletion can be wrong, and the ratio would
  // divide into an empty baseline.
  assert.equal(checkPlanRail(0, 0).deleteOk, true);
  assert.equal(checkPlanRail(388, 0).deleteOk, true);
});

test("plan rail › gaining plans never trips it", () => {
  assert.equal(checkPlanRail(500, 388).deleteOk, true);
});
