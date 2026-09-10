// ═══════════════════════════════════════════════════════════════════
// Every SHIPPED program record must be a program.
//
// ── Why the rule needed a second home ───────────────────────────────
//
// `scripts/lib/non-program-pages.js` is the fix: a registrar POLICY page and a
// DEPARTMENT landing page reach the parser because the container match is
// deliberately broad, and `isProgramPage` drops them. It is correct, it is
// tested, and on 2026-09-09 it shipped anyway with half the corpus still
// carrying the shape it exists to remove.
//
// The reason is worth stating, because it is structural and not an oversight.
// The rule runs at SCRAPE time, over the tree that run is writing. There are
// two trees, scraped by two workflows on different days, and the withdrawal of
// already-committed records (scrape-majors.js, near `listCommittedPrograms`)
// can only reach the tree whose scrape is running. So "the filter has landed"
// and "the filter has been applied" are different facts, separated by up to two
// months of bimonthly cadence — and in that window nothing objected, because
// every check on this rule was written over synthetic literals.
//
// The evidence was inside the shipped files the whole time: the ghost
// `Data Science` record carries its own `metadata.verification` with
// `zeroTotal: 1`, `unenumeratedSections: 1` and a score of 0.68. Nothing read
// it. Measured when this test was written: 31 such records, all in
// `undergraduate/2027/`, each one a selectable program in the picker, a page on
// `/data`, a row in the search index and an entry in the MCP program list.
//
// ── Why here rather than in the app ─────────────────────────────────
//
// The app cannot apply the rule. `src/data/majorLoader.js` builds every option
// from the PATH STRING and never opens the file, which is what makes the
// picker cheap; `programRegistry.node.js` and `build-ai-data.js` do the same.
// Teaching all three to read `tablesPresent` would be three copies of a scrape
// decision, evaluated in a browser, on every load. The tree is the contract, so
// the tree is what gets checked — the same choice `catalog-covers-programs`
// makes for course resolvability.
//
// ── Recovery ───────────────────────────────────────────────────────
//
// A failure here is not a code fix. It means a tree holds records the scraper
// would no longer write, and the repair is to run that tree's scraper with
// `--write`, which performs the withdrawal itself. Deleting the directories by
// hand reaches the same place and skips every rail on the way.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isProgramPage } from "../../scripts/lib/non-program-pages.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const PROGRAM_ROOTS = [
  join(ROOT, "data/northeastern/programs/undergraduate"),
  join(ROOT, "data/northeastern/programs/graduate"),
];

/** Every `requirements.json` under the live (non-archive) program trees. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "requirements.json") out.push(p);
  }
  return out;
}

function records() {
  const out = [];
  let unreadable = 0;
  for (const root of PROGRAM_ROOTS) {
    for (const file of walk(root)) {
      try { out.push({ file, data: JSON.parse(readFileSync(file, "utf8")) }); }
      catch { unreadable++; }
    }
  }
  return { out, unreadable };
}

test("every shipped program record is a program", () => {
  const { out, unreadable } = records();

  // Guard the guard. A walk that finds nothing passes every assertion below
  // vacuously, which would make this the most dangerous kind of test: one that
  // reports success for having checked nothing.
  assert.equal(unreadable, 0, `${unreadable} program file(s) unreadable — fix those before trusting this`);
  assert.ok(out.length > 2000, `only ${out.length} program records found — has the tree moved?`);

  const bad = out.filter(r => !isProgramPage(r.data))
    .map(r => `${relative(ROOT, r.file)}  ${JSON.stringify(r.data?.name)} `
      + `(tablesPresent: ${r.data?.metadata?.tablesPresent})`)
    .sort();

  assert.deepEqual(bad, [],
    `${bad.length} shipped record(s) state no requirement table and name no credential, so\n`
    + `scripts/lib/non-program-pages.js would not write them today. Each one is a selectable\n`
    + `program in the picker, a page on /data, a row in the search index and an entry in the\n`
    + `MCP program list.\n\n`
    + `  ${bad.slice(0, 40).join("\n  ")}${bad.length > 40 ? `\n  …and ${bad.length - 40} more` : ""}\n\n`
    + `This is a DATA state, not a code defect, and the usual cause is that the rule changed\n`
    + `after the tree was last scraped. The two trees are scraped by two workflows on\n`
    + `different days, and each scrape's withdrawal pass can only reach its own tree.\n\n`
    + `Repair by re-running that tree's scraper, which withdraws them itself:\n\n`
    + `    node scripts/scrape-majors.js --write        # undergraduate\n`
    + `    node scripts/scrape-grad-majors.js --write   # graduate\n\n`
    + `then rebuild the bundle (npm run data:programs-bundle) so the counts stay in step.\n`
    + `Do NOT weaken isProgramPage to make this pass: the eight dual-degree pages are the\n`
    + `only records that legitimately carry no requirement table, and they are kept by the\n`
    + `credential in their titles.`);
});

test("the rule still discriminates", () => {
  // Without this, the assertion above is satisfied by an `isProgramPage` that
  // returns true unconditionally — and a corpus check that cannot fail is the
  // failure mode the mutation probe exists to find. Two synthetic records, one
  // either side of the rule, so a weakening is caught here and not only in the
  // unit test that a corpus guard should never be assumed to run beside.
  assert.equal(isProgramPage({ name: "Data Science", metadata: { tablesPresent: 0 } }), false);
  assert.equal(isProgramPage({ name: "Biology, MS (Boston)", metadata: { tablesPresent: 0 } }), true);
  assert.equal(isProgramPage({ name: "Foundation Year", metadata: { tablesPresent: 5 } }), true);
});

test("the dual-degree rescues are real, not hypothetical", () => {
  // The one population the rule keeps on its title alone. If this ever reaches
  // zero, either NEU stopped publishing dual degrees or `titleNamesCredential`
  // stopped matching them — and in the second case the corpus check above would
  // start reporting eight real programs as pages to withdraw, which is exactly
  // the direction that deletes a degree a student can be admitted to.
  const { out } = records();
  const tableless = out.filter(r => r.data?.metadata?.tablesPresent === 0);
  assert.ok(tableless.length > 0 && tableless.every(r => isProgramPage(r.data)),
    `${tableless.filter(r => !isProgramPage(r.data)).length} of ${tableless.length} table-less `
    + `records fail the rule — see the assertion above`);
  assert.ok(tableless.length <= 20,
    `${tableless.length} shipped records state no requirement table. The observed population is `
    + `the 8 dual degrees; a larger one means NEU changed the requirement markup, in which case `
    + `checkNonProgramRail is about to discard real degrees.`);
});
