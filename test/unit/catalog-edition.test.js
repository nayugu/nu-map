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
import {
  parseEditionArg, editionBasePath, assertEdition,
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
