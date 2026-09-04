// UNIT · the guard around scraping a FROZEN past edition.
//
// This module has one job and it is a safety job. Writing an archive edition
// means putting ~1,000 files into a directory labelled with a year and later
// telling a student "these are the requirements you entered under". If the
// archive ever serves live content for a URL, we would write today's rules
// into 2022's folder, and nothing downstream could tell: the file is
// well-formed, the program verifies, and the only symptom is a student
// planning against a degree that is not theirs.
//
// So the tests below are mostly about REFUSING. The permissive cases are the
// short ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseEditionArg, editionBasePath, assertEdition,
  KEEP_YEARS, editionWindow,
} from "../../scripts/lib/catalog-edition.js";

// ── Reading the flag ─────────────────────────────────────────────────────────

test("edition › no flag means the live catalog", () => {
  assert.equal(parseEditionArg(["node", "scrape-majors.js", "--write"]), null);
  assert.equal(editionBasePath(null), "");
});

test("edition › the stored year is the END of the academic year", () => {
  // data/northeastern/programs/undergraduate/{year}/ and parseCatalogEdition both use the end year, so
  // the 2022-2023 edition lands in 2023/. Storing the start year would file
  // every edition one folder early and silently shift every cohort by a year.
  assert.deepEqual(parseEditionArg(["--edition", "2022-2023"]), { label: "2022-2023", year: 2023 });
  assert.deepEqual(parseEditionArg(["--edition", "2024-2025"]), { label: "2024-2025", year: 2025 });
});

test("edition › the base path is the archive prefix, not a whole URL", () => {
  // It is stripped from sitemap paths so archive URLs classify exactly like
  // live ones; a full URL here would leave every path unmatched.
  assert.equal(editionBasePath({ label: "2022-2023", year: 2023 }), "/archive/2022-2023");
});

test("edition › a malformed label is refused, never guessed", () => {
  const bad = ["2022", "2022/2023", "22-23", "", "latest", "2022-2024", "1899-1900"];
  for (const label of bad) {
    assert.throws(() => parseEditionArg(["--edition", label]), /--edition/,
      `${JSON.stringify(label)} should not parse`);
  }
  // The flag with nothing after it is the easy typo, and it must not silently
  // scrape live and write it into an archive folder.
  assert.throws(() => parseEditionArg(["--edition"]), /--edition/);
});

// ── The assertion that matters ───────────────────────────────────────────────

const ed = { label: "2022-2023", year: 2023 };

test("edition › a page from the edition we asked for passes", () => {
  assert.doesNotThrow(() => assertEdition(2023, ed, "https://example.test/x/"));
});

test("edition › a page from ANOTHER edition aborts", () => {
  // The live catalog answering an archive URL is the exact scenario: we asked
  // for 2023 and got 2026.
  assert.throws(() => assertEdition(2026, ed, "https://example.test/x/"),
    /Edition mismatch.*2022-2023.*2026/s);
});

test("edition › a page with NO edition label aborts too", () => {
  // Not a lesser case. A page we cannot place in time is a page we cannot
  // file, and defaulting to the requested year is precisely the silent
  // mislabelling this exists to stop.
  assert.throws(() => assertEdition(null, ed, "https://example.test/x/"),
    /no edition label at all/);
});

test("edition › the message says why the whole run stops, not just this page", () => {
  // A mismatch is evidence about the ARCHIVE, not about one program: if one
  // URL can serve the wrong edition then the pages already scraped are no
  // longer trustworthy, so skipping and continuing would be the wrong repair.
  try {
    assertEdition(2026, ed, "https://example.test/x/");
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /already scraped in this run cannot be trusted/);
  }
});

// ── The shipping window ──────────────────────────────────────────────────────
//
// Without a cap the retired union grows with every capture, forever: a course
// retired in 2019 would still ship in 2035, browsable as something to add, for
// a course NEU stopped teaching before the student was in high school.
//
// The cap is only meaningful when it BINDS, and today it does not — 5 editions
// are held against a limit of 7, so every test below works on synthetic year
// lists rather than on the tree. A window that is never exercised is a window
// that silently stops working; these are what make the 2029 slide a non-event.

test("window › KEEP_YEARS is 7", () => {
  // Pinned deliberately. It is sized from the longest realistic path — a
  // 5-year co-op degree, plus a leave or an extra co-op cycle is 6 ordinary,
  // and 7 adds a year of margin — so changing it is a decision about which
  // students we can still answer for, not a tuning knob.
  assert.equal(KEEP_YEARS, 7);
});

test("window › the constant is defined ONCE", () => {
  // It used to live in prune-catalog-years.js and govern the two PROGRAM trees
  // only, while the course-edition snapshots had no cap at all. Two windows
  // meant to be the same window must not be two numbers, and the way that
  // regresses is somebody re-adding a local literal rather than importing.
  const src = readFileSync(
    new URL("../../scripts/prune-catalog-years.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const\s+KEEP_YEARS\s*=/,
    "prune-catalog-years.js redeclares KEEP_YEARS instead of importing it");
  assert.match(src, /import\s*\{[^}]*KEEP_YEARS[^}]*\}\s*from/);
});

test("window › under the limit keeps everything", () => {
  assert.deepEqual(editionWindow([2023, 2024, 2025, 2026, 2027]),
    [2027, 2026, 2025, 2024, 2023]);
  assert.equal(editionWindow([2027]).length, 1);
  assert.deepEqual(editionWindow([]), []);
});

test("window › exactly at the limit drops nothing", () => {
  // The off-by-one that would quietly discard a live edition.
  const seven = [2021, 2022, 2023, 2024, 2025, 2026, 2027];
  assert.equal(editionWindow(seven).length, 7);
  assert.ok(editionWindow(seven).includes(2021));
});

test("window › over the limit drops the OLDEST, never the newest", () => {
  const eight = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
  const kept = editionWindow(eight);
  assert.equal(kept.length, 7);
  assert.ok(!kept.includes(2020), "the oldest edition should have left the window");
  assert.ok(kept.includes(2027), "the newest edition must always be kept");
  assert.equal(kept[0], 2027);
});

test("window › the anchor is the newest edition HELD, not the clock", () => {
  // Deliberate: a derive step must not need the network to decide what it
  // ships. If a capture were ever missed the anchor lags a year and the window
  // keeps one edition too many — the recoverable direction, since dropping an
  // edition removes a course from a plan that already names it.
  const stale = [2018, 2019, 2020, 2021, 2022];
  assert.deepEqual(editionWindow(stale), [2022, 2021, 2020, 2019, 2018],
    "a tree whose newest edition is old must not be emptied by the window");
});

test("window › input order does not matter and the input is not mutated", () => {
  const years = [2025, 2020, 2027, 2022, 2026, 2021, 2023, 2024];
  const copy = [...years];
  const kept = editionWindow(years);
  assert.deepEqual(kept, [2027, 2026, 2025, 2024, 2023, 2022, 2021]);
  assert.deepEqual(years, copy, "editionWindow mutated its argument");
});
