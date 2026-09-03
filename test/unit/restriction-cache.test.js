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

test("many INCREMENTAL flushes accumulate without loss", () => {
  // The contract behind `--resume`. A restrictions pass is ~7,000 requests and
  // ~55 minutes, and the `finally` that used to be the only flush does NOT run
  // when the process is killed — measured: killing a run mid-term discarded all
  // ~2,400 pages it had fetched. So the pass now flushes every N pages, which
  // means the SAME growing map is written repeatedly and every earlier page has
  // to survive each rewrite.
  const term = "999910";
  const pages = {}, courses = {};
  for (let batch = 0; batch < 4; batch++) {
    for (let i = 0; i < 50; i++) {
      const crn = String(batch * 50 + i);
      pages[crn] = `<p>${crn}</p>`;
      courses[crn] = `SUBJ${batch}`;
    }
    const n = writeTermCache(term, pages, courses);
    assert.equal(n.pages, (batch + 1) * 50, `flush ${batch + 1} lost pages`);
  }
  const got = readTermCache(term);
  assert.equal(Object.keys(got.pages).length, 200);
  assert.equal(got.pages["0"], "<p>0</p>", "the first page must survive every later flush");
  assert.equal(got.courses["0"], "SUBJ0", "and so must its course attribution");
});

test("a resumed run can tell which CRNs it already has", () => {
  // `--resume` skips a CRN when the cache holds it, and RE-PARSES it rather
  // than merely counting it: the derived gate for a course is folded from ALL
  // of its sections, so a course half-restored from cache and half re-fetched
  // would otherwise be folded from the second half alone — a false gate, the
  // one failure that can refuse a plan outright.
  writeTermCache("999911", { "1": "<p>a</p>", "2": "<p>b</p>" }, { "1": "X1000", "2": "X1000" });
  const got = readTermCache("999911");
  const have = new Set(Object.keys(got.pages));
  assert.ok(have.has("1") && have.has("2"));
  assert.ok(!have.has("3"), "a CRN never fetched must not look cached");
  // The page content is what makes re-parsing possible, not just the key.
  assert.equal(got.pages["1"], "<p>a</p>");
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
