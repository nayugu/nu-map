// Catalog-edition selection — which frozen year a cohort follows.
//
// Requirements are locked to the edition a student entered under (the
// catalog says so on every page). These two pure helpers decide that, and
// they are the difference between a 2026 entrant keeping their real
// requirements and being silently moved onto 2027's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cohortCatalogYear, pickCatalogYear, withCatalogYear, resolveInMap, parseMajorPathParts }
  from "../../src/data/programPaths.js";

// ── cohort → edition ────────────────────────────────────────────────
// An edition runs fall → summer and is labelled by its ENDING year, so
// only fall entrants shift forward. Getting this wrong puts every
// spring/summer entrant on the wrong edition.

test("cohort › a fall entrant belongs to the edition ENDING the next year", () => {
  assert.equal(cohortCatalogYear("fall", 2025), 2026);   // 2025-2026 edition
  assert.equal(cohortCatalogYear("fall", 2030), 2031);
});

test("cohort › spring and summer entrants stay on the SAME edition as the prior fall", () => {
  assert.equal(cohortCatalogYear("spring", 2026), 2026); // still 2025-2026
  assert.equal(cohortCatalogYear("sumA", 2026), 2026);
  assert.equal(cohortCatalogYear("sumB", 2026), 2026);
});

test("cohort › a missing/garbage year yields NaN, which pickCatalogYear treats as 'no cohort'", () => {
  assert.ok(Number.isNaN(cohortCatalogYear("fall", undefined)));
  assert.ok(Number.isNaN(cohortCatalogYear("fall", "abc")));
});

// ── edition selection ───────────────────────────────────────────────

test("pick › the newest edition NOT NEWER than the cohort's", () => {
  const have = [2026, 2027, 2028];
  assert.equal(pickCatalogYear(have, 2026), 2026);   // must not jump to 2028
  assert.equal(pickCatalogYear(have, 2027), 2027);
  assert.equal(pickCatalogYear(have, 2029), 2028);   // cohort newer than we hold
});

test("pick › a cohort older than the archive gets the OLDEST we hold, never the current one", () => {
  assert.equal(pickCatalogYear([2026, 2027, 2028], 2023), 2026);
});

test("pick › no cohort (NaN/undefined) falls back to the newest", () => {
  assert.equal(pickCatalogYear([2026, 2027], NaN), 2027);
  assert.equal(pickCatalogYear([2026, 2027], undefined), 2027);
});

test("pick › single edition (today's state) always wins — the change is a no-op until 2027 lands", () => {
  for (const cohort of [2020, 2026, 2031, NaN]) assert.equal(pickCatalogYear([2026], cohort), 2026);
});

test("pick › empty/unsorted input is safe", () => {
  assert.equal(pickCatalogYear([], 2026), undefined);
  assert.equal(pickCatalogYear(undefined, 2026), undefined);
  assert.equal(pickCatalogYear([2028, 2026, 2027], 2027), 2027);  // order-independent
});

// ── pinning an id onto a cohort's edition ───────────────────────────
// MCP list_programs is a catalog tool with no plan, so it offers newest-
// edition ids; SET_MAJOR pins them before storing.

test("pin › rewrites the year, preserving college, folder and the grad/ prefix", () => {
  assert.equal(withCatalogYear("2029/khoury/cs_bscs_(boston)", 2026), "2026/khoury/cs_bscs_(boston)");
  assert.equal(withCatalogYear("grad/2029/khoury/cs_ms_(boston)", 2026), "grad/2026/khoury/cs_ms_(boston)");
});

test("pin › a missing year or cohort leaves the id untouched", () => {
  assert.equal(withCatalogYear("khoury/cs_bscs", 2026), "khoury/cs_bscs");
  assert.equal(withCatalogYear("2029/khoury/cs", NaN), "2029/khoury/cs");
  assert.equal(withCatalogYear("", 2026), "");
});

// ── stale-path resolution must not jump editions ────────────────────
// resolveInMap is the fallback for every loader. It used to take the
// NEWEST match at each tier, which would silently relocate a frozen plan
// onto current requirements whenever its exact path stopped resolving.

test("resolve › an exact path always wins", () => {
  const map = { "2026/khoury/cs": 1, "2029/khoury/cs": 1 };
  assert.equal(resolveInMap(map, "2026/khoury/cs", parseMajorPathParts), "2026/khoury/cs");
});

test("resolve › a renamed folder resolves within the SAME edition, not the newest", () => {
  const map = { "2026/khoury/cs_bscs": 1, "2029/khoury/cs_bscs": 1 };
  // saved id used a cosmetic variant that no longer exists verbatim
  assert.equal(resolveInMap(map, "2026/khoury/cs-bscs", parseMajorPathParts), "2026/khoury/cs_bscs");
});

test("resolve › when the cohort's edition is gone, prefer the closest OLDER one", () => {
  const map = { "2025/khoury/cs": 1, "2029/khoury/cs": 1 };
  assert.equal(resolveInMap(map, "2026/khoury/cs", parseMajorPathParts), "2025/khoury/cs");
});

test("resolve › only when nothing older exists does it fall forward", () => {
  const map = { "2028/khoury/cs": 1, "2029/khoury/cs": 1 };
  assert.equal(resolveInMap(map, "2026/khoury/cs", parseMajorPathParts), "2029/khoury/cs");
});

// ── the property that matters ───────────────────────────────────────

test("selection › a 2026 entrant keeps 2026 as later editions are published", () => {
  const cohort = cohortCatalogYear("fall", 2025);       // 2026
  let have = [2026];
  for (const next of [2027, 2028, 2029, 2030, 2031, 2032]) {
    have = [...have, next];
    assert.equal(pickCatalogYear(have, cohort), 2026,
      `after ${next} was published the cohort must still see 2026`);
  }
});
