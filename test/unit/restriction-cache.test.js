// UNIT · scripts/lib/restriction-cache.js › the raw getRestrictions cache
//
// The cache exists so a parser change costs a re-parse instead of a 4.5-hour
// re-fetch. That makes exactly one property load-bearing: it must never LOSE a
// page. A sampled probe run and a full scrape both write the same term, and a
// truncated file must not read as an empty term — either would silently turn a
// captured term back into an unfetched one.
//
// These tests run against a temp CACHE_DIR, so they never touch the real cache.

import { test }   from "node:test";
import assert     from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { gzipSync } from "node:zlib";

// Point the module at a scratch tree BEFORE importing it — the first draft of
// this file did not, and wrote fake term codes into the real cache, which
// `cachedTerms()` would then have handed to reparse-restrictions.js. A test
// that corrupts the artifact it tests is worse than no test.
process.env.NUMAP_RESTRICTION_CACHE = mkdtempSync(join(tmpdir(), "numap-restr-"));

const { readTermCache, writeTermCache, cachedTerms, migrateLegacy, legacyTerms, CACHE_DIR } =
  await import("../../scripts/lib/restriction-cache.js");

const T  = "999901";
const T2 = "999902";

test("the tests are isolated from the real cache", () => {
  assert.match(CACHE_DIR, /numap-restr-/, "CACHE_DIR was not redirected — refusing to pollute");
  assert.ok(!CACHE_DIR.includes(".cache/banner"));
});

test("a written term round-trips", () => {
  writeTermCache(T, { "10001": "<html>a</html>" }, { "10001": "CS1210" });
  const got = readTermCache(T);
  assert.equal(got.pages["10001"], "<html>a</html>");
  assert.equal(got.courses["10001"], "CS1210");
  assert.ok(got.generated, "a cache must record when it was written");
});

test("writing MERGES rather than replaces — a sample must not delete a full capture", () => {
  // The real sequence: a scrape captures 7,400 CRNs, then a probe run samples
  // 300. If the second write replaced the first, the term would silently go
  // from complete to sampled and a reparse would under-report every course.
  writeTermCache(T, { "20001": "full-1", "20002": "full-2", "20003": "full-3" });
  writeTermCache(T, { "20002": "sampled-2" });
  const got = readTermCache(T);
  assert.equal(got.pages["20001"], "full-1", "an untouched page must survive");
  assert.equal(got.pages["20003"], "full-3");
  assert.equal(got.pages["20002"], "sampled-2", "a re-fetched page wins");
});

test("the course map merges independently of the pages", () => {
  writeTermCache(T2, { "1": "p1" }, { "1": "AAA1000" });
  writeTermCache(T2, { "2": "p2" });                       // pages only
  const got = readTermCache(T2);
  assert.equal(got.courses["1"], "AAA1000", "an earlier identity must not be dropped");
  assert.equal(Object.keys(got.pages).length, 2);
});

test("an absent term reads as null, not as an empty term", () => {
  // The distinction that matters: "we never fetched this" vs "we fetched it and
  // there was nothing". Same rule as `false` vs absent in term-history.js.
  assert.equal(readTermCache("999999"), null);
});

test("a corrupt file reads as null rather than as an empty term", () => {
  const p = join(CACHE_DIR, "999903.json.gz");
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(p, Buffer.from("not gzip at all"));
  assert.equal(readTermCache("999903"), null,
    "a truncated write must not look like a term with no restrictions");
});

test("a half-written file cannot be observed — the write is atomic", () => {
  // writeTermCache renames a temp file into place, so a reader either sees the
  // previous cache or the new one. Asserted structurally: no .tmp survives a
  // successful write, and the payload is complete.
  writeTermCache(T, { "30001": "x".repeat(50_000) });
  const leftovers = readdirSync(CACHE_DIR).filter(f => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "a temp file survived a successful write");
  assert.equal(readTermCache(T).pages["30001"].length, 50_000);
});

test("cachedTerms lists only real term codes", () => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, "notaterm.json.gz"), gzipSync(Buffer.from("{}")));
  const terms = cachedTerms();
  assert.ok(terms.includes(T), "a written term must be listed");
  assert.ok(!terms.includes("notaterm"), "a non-term file must not be listed");
  for (const t of terms) assert.match(t, /^\d{6}$/);
});

// ── The legacy layout the probe wrote first ─────────────────────────

test("a legacy per-page directory is read transparently", () => {
  const dir = join(CACHE_DIR, "999904");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "40001.html"), "<html>legacy</html>");
  writeFileSync(join(dir, "index.json"), JSON.stringify({ "40001": "ENCP2000" }));

  const got = readTermCache("999904");
  assert.equal(got.pages["40001"], "<html>legacy</html>");
  assert.equal(got.courses["40001"], "ENCP2000");
  assert.equal(got.legacy, true, "the caller should be able to tell");
  assert.ok(existsSync(dir), "READING must never delete captured pages");
});

test("migrateLegacy folds the directory in and only THEN removes it", () => {
  const dir = join(CACHE_DIR, "999905");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "50001.html"), "<html>one</html>");
  writeFileSync(join(dir, "50002.html"), "<html>two</html>");

  const res = migrateLegacy("999905");
  assert.equal(res.pages, 2);
  assert.ok(!existsSync(dir), "the legacy directory should be gone");
  const got = readTermCache("999905");
  assert.equal(got.pages["50001"], "<html>one</html>");
  assert.equal(got.pages["50002"], "<html>two</html>");
  assert.ok(!got.legacy);
});

test("migrating a term that already has a single-file cache keeps both sets", () => {
  writeTermCache("999906", { "60001": "modern" });
  const dir = join(CACHE_DIR, "999906");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "60002.html"), "legacy");
  migrateLegacy("999906");
  const got = readTermCache("999906");
  assert.equal(got.pages["60001"], "modern", "the existing capture must survive migration");
  assert.equal(got.pages["60002"], "legacy");
});

test("migrateLegacy on a term with no legacy directory is a no-op", () => {
  assert.equal(migrateLegacy("999907"), null);
  assert.ok(!legacyTerms().includes("999907"));
});
