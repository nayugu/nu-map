// INVARIANT · the archived catalog editions in data/northeastern/programs/archive/.
//
// These are FROZEN snapshots of past catalogs, and the harm they can do is
// specific: a student who entered in 2022 follows the 2022-2023 rules, so if
// live content ever lands in a past edition's folder we would show them
// requirements that are not theirs, and the file would look perfectly healthy
// while doing it. Every check below is about that — provenance, not parsing.
//
// The scraper asserts the edition per page at fetch time
// (scripts/lib/catalog-edition.js). This asserts it again on what actually
// reached disk, because those are different claims: the first says every page
// we read was the right edition, the second says every record we kept is.
//
// Committed data only — no network, no deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../helpers/paths.js";

const ARCHIVE  = join(ROOT, "data/northeastern/programs/archive");
const MANIFEST = join(ARCHIVE, "manifest.json");
const TREES    = ["undergraduate", "graduate"];

const present = existsSync(MANIFEST);
const manifest = present ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { editions: {} };

/** [{ year, label, tree, college, bundle }] for everything committed. */
function loadBundles() {
  const out = [];
  for (const tree of TREES) {
    const treeDir = join(ARCHIVE, tree);
    if (!existsSync(treeDir)) continue;
    for (const year of readdirSync(treeDir)) {
      if (!/^\d{4}$/.test(year)) continue;
      for (const file of readdirSync(join(treeDir, year))) {
        if (!file.endsWith(".json")) continue;
        out.push({
          year: Number(year),
          tree,
          college: file.replace(/\.json$/, ""),
          bundle: JSON.parse(readFileSync(join(treeDir, year, file), "utf8")),
        });
      }
    }
  }
  return out;
}

const BUNDLES = present ? loadBundles() : [];
const skip = present ? false : "no archive committed yet";

// ── Provenance ───────────────────────────────────────────────────────────────

test("archive › every record is stamped with the edition it was filed under", { skip }, () => {
  // The one that matters. A program stamped 2026 sitting in 2022/ means live
  // content reached a past edition's folder, which is invisible downstream:
  // the file parses, the program verifies, and a student plans against a
  // degree that is not theirs.
  const bad = [];
  for (const { year, tree, college, bundle } of BUNDLES) {
    for (const [slug, program] of Object.entries(bundle)) {
      if (program.yearVersion !== year) {
        bad.push(`${tree}/${year}/${college}: ${slug} carries yearVersion ${program.yearVersion}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} records filed under the wrong edition`);
});

test("archive › every sourceUrl points into that edition's archive", { skip }, () => {
  // The second, independent witness: the year could be right by luck, but the
  // url is where the content actually came from. A live url here means the
  // record was read off today's catalog whatever it says about itself.
  const bad = [];
  for (const { year, tree, college, bundle } of BUNDLES) {
    const label = manifest.editions?.[year]?.label;
    for (const [slug, program] of Object.entries(bundle)) {
      const url = program.metadata?.sourceUrl ?? "";
      if (!label) { bad.push(`${tree}/${year}: no manifest label`); break; }
      if (!url.includes(`/archive/${label}/`)) {
        bad.push(`${tree}/${year}/${college}: ${slug} → ${url || "(none)"}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} records came from outside their edition`);
});

test("archive › the manifest and the directories agree", { skip }, () => {
  // Either one drifting alone is a half-finished backfill: a directory with no
  // manifest entry is data nothing knows about, and a manifest entry with no
  // directory is a promise of data that is not there.
  const onDisk = new Map();
  for (const { year, tree } of BUNDLES) {
    if (!onDisk.has(year)) onDisk.set(year, new Set());
    onDisk.get(year).add(tree);
  }
  for (const [year, entry] of Object.entries(manifest.editions ?? {})) {
    for (const tree of TREES) {
      if (!entry[tree]) continue;
      assert.ok(onDisk.get(Number(year))?.has(tree),
        `manifest claims ${tree} for ${year} but no bundles exist`);
      const actual = BUNDLES
        .filter(b => b.year === Number(year) && b.tree === tree)
        .reduce((n, b) => n + Object.keys(b.bundle).length, 0);
      assert.equal(actual, entry[tree].programs,
        `${tree}/${year}: ${actual} programs on disk, manifest says ${entry[tree].programs}`);
    }
  }
  for (const [year, trees] of onDisk) {
    for (const tree of trees) {
      assert.ok(manifest.editions?.[year]?.[tree], `${tree}/${year} exists but is not in the manifest`);
    }
  }
});

// ── Shape ────────────────────────────────────────────────────────────────────

test("archive › editions are contiguous", { skip }, () => {
  // A gap means a student in that cohort silently falls back to a neighbouring
  // edition's rules. Better to know the gap is there than to discover it from
  // whoever entered that year.
  const years = Object.keys(manifest.editions ?? {}).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return;
  for (let i = 1; i < years.length; i++) {
    assert.equal(years[i], years[i - 1] + 1,
      `gap between the ${years[i - 1]} and ${years[i]} editions`);
  }
});

test("archive › no edition collapsed relative to its neighbour", { skip }, () => {
  // The genuinely new evidence source the archive brings: until now there was
  // no second authority for degree requirements at all (scripts/lib/
  // major-verify.js), so every check was internal consistency. Adjacent
  // editions are not a second authority either, but a program count or section
  // count that falls off a cliff between one year and the next is either a
  // real curriculum change or a parse that stopped working — and that question
  // is answerable, which it was not before.
  //
  // The threshold is deliberately loose. Programs are added and retired every
  // year and the catalog was reorganised more than once; this is here to catch
  // a parser that stopped reading a markup generation, not to police drift.
  for (const tree of TREES) {
    const years = Object.entries(manifest.editions ?? {})
      .filter(([, e]) => e[tree])
      .map(([y, e]) => ({ year: Number(y), ...e[tree] }))
      .sort((a, b) => a.year - b.year);

    for (let i = 1; i < years.length; i++) {
      const prev = years[i - 1], cur = years[i];
      assert.ok(cur.programs > prev.programs * 0.6,
        `${tree}: programs fell ${prev.programs} (${prev.year}) → ${cur.programs} (${cur.year})`);
      assert.ok(cur.sections > prev.sections * 0.5,
        `${tree}: sections fell ${prev.sections} (${prev.year}) → ${cur.sections} (${cur.year})`);
    }
  }
});

test("archive › bundle keys are sorted", { skip }, () => {
  // A frozen edition should re-scrape to a byte-identical file, which is what
  // makes `git diff` a real check on the parser. Iteration order would make
  // every re-run look like a change and hide the ones that are.
  for (const { year, tree, college, bundle } of BUNDLES) {
    const keys = Object.keys(bundle);
    assert.deepEqual(keys, [...keys].sort(), `${tree}/${year}/${college}: keys out of order`);
  }
});

test("archive › no bundle is empty and no program is hollow", { skip }, () => {
  for (const { year, tree, college, bundle } of BUNDLES) {
    const keys = Object.keys(bundle);
    assert.ok(keys.length, `${tree}/${year}/${college}: empty bundle`);
    for (const [slug, program] of Object.entries(bundle)) {
      const sections = program.requirementSections?.length ?? 0;
      const concs    = program.concentrations?.concentrationOptions?.length ?? 0;
      assert.ok(sections + concs > 0, `${tree}/${year}/${college}: ${slug} has no requirements`);
      assert.ok(program.name, `${tree}/${year}/${college}: ${slug} has no name`);
    }
  }
});

test("archive › bundles are minified", { skip }, () => {
  // Not cosmetic. Pretty-printing costs 64%, which across seven editions is
  // the difference between ~26 MB and ~72 MB in a public repo where every
  // clone pays. The live tree stays pretty because its monthly diff is how a
  // bad scrape gets noticed; a frozen edition is never diffed.
  for (const tree of TREES) {
    const treeDir = join(ARCHIVE, tree);
    if (!existsSync(treeDir)) continue;
    for (const year of readdirSync(treeDir).filter(y => /^\d{4}$/.test(y))) {
      for (const file of readdirSync(join(treeDir, year)).filter(f => f.endsWith(".json"))) {
        const raw = readFileSync(join(treeDir, year, file), "utf8");
        assert.ok(!raw.includes('\n  "'), `${tree}/${year}/${file} is pretty-printed`);
      }
    }
  }
});
