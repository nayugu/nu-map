// UNIT · `scrape-catalog.js --edition` may reach ONE directory and no other.
//
// ── The property under test ─────────────────────────────────────────
//
// `catalog-edition.test.js` covers the shared guard (parseEditionArg,
// assertEdition). This file covers the thing that guard cannot see: the
// SCRAPER's routing. An archive run and a live run share a file, a parser and
// an argv, and almost everything the live path does after parsing is wrong for
// an archive edition — the nuPath reconcile against the live catalog, edition
// retention, the 2% shrink floor, data-meta, change-log, scrape-state,
// subjects.json. Every one of those fails silently, producing a well-formed
// file with the wrong contents in a folder named after a year.
//
// So the question these tests ask is not "does it parse" but "can any
// combination of flags get an edition run into a live write path". The answer
// has to be no, and it has to stay no after someone adds the next mode.
//
// ── Why a subprocess, and why that is not a cop-out ─────────────────
//
// `runEdition` is deliberately not exported: it short-circuits inside a
// top-level script, and the routing IS the behaviour. Exporting it to test it
// would test a function that no longer stands where the guard stands. Spawning
// the real CLI tests the real entry point, which is the only place the flag
// combination exists.
//
// Every case here refuses BEFORE the first network request, so the file is
// fast and offline. The complement — that a real archive fetch parses and
// asserts its own edition — is `test/live/catalog-scrape.live.test.js`
// territory, because it needs catalog.northeastern.edu.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Run the scraper with argv, offline-safe cases only. Returns {code, out}. */
function scrape(...args) {
  const r = spawnSync(process.execPath, ["scripts/scrape-catalog.js", ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 30_000,
    // A refusal must not depend on the developer cache being warm or cold.
    env: { ...process.env, CATALOG_HTML_CACHE: "" },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── Every live artifact an edition run must never touch ──────────────────────
// Named explicitly rather than globbed. A glob would silently start covering
// nothing if the paths moved, and this list is the definition of "live".
const LIVE_ARTIFACTS = [
  "public/northeastern/catalog-courses.json",
  "public/northeastern/all-courses.json",
  "public/northeastern/subjects.json",
  "public/northeastern/change-log.json",
  "public/northeastern/scrape-state.json",
  "public/northeastern/retired-courses.json",
  "public/data-meta.json",
  "src/core/dataMeta.json",
  "data/northeastern/scrape-state.json",
  // The one frozen snapshot that already exists. An edition run must not be
  // able to regenerate it either — frozen means frozen.
  "data/northeastern/catalog/editions/2026/catalog-courses.json",
];

/** Content hash + mtime, so neither a rewrite nor a same-bytes touch escapes. */
function fingerprint() {
  const fp = {};
  for (const rel of LIVE_ARTIFACTS) {
    const path = ROOT + rel;
    if (!existsSync(path)) { fp[rel] = "ABSENT"; continue; }
    fp[rel] = createHash("sha1").update(readFileSync(path)).digest("hex")
      + ":" + statSync(path).mtimeMs;
  }
  return fp;
}

describe("scrape-catalog --edition › refusals", () => {
  let before_;
  before(() => { before_ = fingerprint(); });

  // The headline guarantee. Asserted over the WHOLE set at once rather than
  // per-case, because the failure being guarded against is a write nobody
  // predicted into a file nobody was watching.
  after(() => {
    assert.deepEqual(fingerprint(), before_,
      "an --edition run modified a live artifact — see runEdition's docblock");
  });

  describe("cannot be combined with a mode that writes live data", () => {
    // Each of these three has its own live write path. --merge overlays
    // all-courses.json; --rotate and --subjects both read-modify-write
    // catalog-courses.json. An edition run reaching any of them writes a past
    // edition's courses into the current catalog.
    for (const mode of [["--merge"], ["--rotate"], ["--subjects", "CS"]]) {
      test(`--edition + ${mode[0]}`, () => {
        const { code, out } = scrape("--edition", "2024-2025", ...mode, "--write");
        assert.equal(code, 1, `expected refusal, got exit ${code}\n${out}`);
        assert.match(out, /cannot be combined/);
      });
    }
  });

  test("the descriptive era is refused, not written empty", () => {
    // Editions before 2022 publish no prereq/coreq/attribute lines AND state
    // credits in a form the title regex does not match, so the parser yields
    // ZERO courses rather than partial ones. Writing that would be a snapshot
    // asserting the 2020-2021 catalog had no courses in it — the absent-vs-
    // empty collapse this repo keeps paying for. Refuse until an era-aware
    // reader exists (docs/catalog-editions-design.md §8 step 11).
    const { code, out } = scrape("--edition", "2020-2021", "--write");
    assert.equal(code, 1);
    assert.match(out, /descriptive/);
    assert.match(out, /EMPTY snapshot/);
  });

  test("an edition already on disk is never regenerated", () => {
    // 2026 is the only machine-readable copy of that catalog in existence —
    // /archive/2025-2026/ does not exist, NEU published it as PDF only. There
    // is deliberately no --force: deleting it by hand leaves a trace in git,
    // which is the friction that should be there.
    const { code, out } = scrape("--edition", "2025-2026", "--write");
    assert.equal(code, 1);
    assert.match(out, /already exists/);
    assert.match(out, /never regenerated/);
  });

  describe("a malformed label fails at startup, before anything is fetched", () => {
    // The label names a DIRECTORY. Guessing what "2024" or "2024-2026" meant
    // would file an edition under the wrong year, and every downstream reader
    // trusts that folder name.
    for (const label of ["2024", "2024-2026", "24-25", "", "next"]) {
      test(JSON.stringify(label), () => {
        assert.equal(scrape("--edition", label, "--write").code, 1);
      });
    }
  });
});

describe("scrape-catalog --edition › routing", () => {
  test("no --edition flag still means a live scrape", () => {
    // The regression this guards: making the archive path safe by making the
    // live path unreachable. --dry-run --edition-less must still start a live
    // run, so it is checked by its banner rather than by running it.
    const src = readFileSync(ROOT + "scripts/scrape-catalog.js", "utf8");
    assert.match(src, /const EDITION = parseEditionArg\(process\.argv\)/);
    assert.match(src, /if \(EDITION\) \{/);
  });

  test("the edition short-circuit precedes every live mode", () => {
    // Source order is the guarantee. `runEdition` is safe because nothing in
    // the live flow runs before it — not the rotate handler, not the subjects
    // handler, not the main loop. A future mode inserted above the EDITION
    // block would silently break that, and no behavioural test would see it
    // until an archive run corrupted a live file.
    const src = readFileSync(ROOT + "scripts/scrape-catalog.js", "utf8");
    const at = (re) => src.search(re);
    const edition = at(/^if \(EDITION\) \{/m);
    assert.ok(edition > 0, "the EDITION short-circuit is gone");
    for (const [name, re] of [
      ["--rotate",   /^if \(ROTATE\) \{/m],
      ["--subjects", /^if \(SUBJECTS\) \{/m],
    ]) {
      const other = at(re);
      assert.ok(other > edition,
        `the ${name} handler now runs BEFORE the --edition short-circuit`);
    }
  });

  test("runEdition names exactly one output root", () => {
    // Cheap, and it catches the specific mistake of copying a live write into
    // the edition path during a refactor: the function body may mention the
    // editions directory and no other artifact path.
    const src  = readFileSync(ROOT + "scripts/scrape-catalog.js", "utf8");
    const body = src.slice(src.indexOf("async function runEdition"),
                          src.indexOf("console.log(\"\\nNU Catalog Scraper\")"));
    assert.ok(body.length > 500, "runEdition not found — did it move?");
    assert.match(body, /data\/northeastern\/catalog\/editions/);
    // CATALOG_OUT is READ (to report the retired yield) and must never be
    // written. writeFileSync appears exactly once in the body, for outFile.
    assert.equal((body.match(/writeFileSync/g) ?? []).length, 1);
    assert.match(body, /writeFileSync\(outFile/);
  });
});
