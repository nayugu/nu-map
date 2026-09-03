// INVARIANT · Milestone A's three guards (docs/catalog-editions-design.md §8).
//
//   1. the union is DERIVED and never hand-edited;
//   2. a retired course never gains a SUBSTITUTE;
//   3. `fidelity` is respected wherever an empty field is read.
//
// Separate from retired-union-disjoint.test.js, which guards the relationship
// between the two shipped files. These guard the CONTENT of the union against
// the three specific ways this feature is expected to rot.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { deriveRetiredUnion } from "../../scripts/derive-retired-union.js";
import { keyOfCourse } from "../../scripts/lib/course-retention.js";
import { FIRST_FULL_FIDELITY_EDITION } from "../../scripts/lib/catalog-course-parser.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const EDITIONS = join(ROOT, "data/northeastern/catalog/editions");
const union = JSON.parse(readFileSync(join(ROOT, "public/northeastern/retired-courses.json"), "utf8"));

describe("Milestone A · guard 1 — the union is derived, never hand-edited", () => {
  test("re-deriving from the committed inputs reproduces the shipped file exactly", () => {
    // The strongest form this guard can take: both inputs are committed, so the
    // output is a pure function of the repository and can simply be recomputed.
    //
    // What it catches is a hand edit, and a hand edit here is more tempting than
    // it sounds — the file is a flat array of readable course records, and
    // "just add the one course a student complained about" would work, ship,
    // and then be silently deleted by the next monthly derive with nobody
    // able to say what had been lost. Deriving is the contract; this enforces it.
    const catalog = JSON.parse(
      readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
    const snapshots = readdirSync(EDITIONS)
      .filter(n => /^\d{4}$/.test(n))
      .map(Number).sort((a, b) => a - b)
      .map(year => ({ year, path: join(EDITIONS, String(year), "catalog-courses.json") }))
      .filter(e => existsSync(e.path))
      .map(({ year, path }) => ({ year, rows: JSON.parse(readFileSync(path, "utf8")) }));

    assert.ok(snapshots.length,
      "no frozen editions on disk — the union cannot be derived, so this proves nothing");

    const { retired } = deriveRetiredUnion(catalog, snapshots);
    assert.equal(retired.length, union.length,
      `re-deriving gives ${retired.length} courses, the shipped file has ${union.length}. `
      + "Run `node scripts/derive-retired-union.js --write`.");
    assert.deepEqual(
      retired.map(keyOfCourse), union.map(keyOfCourse),
      "the shipped union does not match a fresh derivation — it has been hand-edited, "
      + "or an input changed without re-deriving");
  });
});

describe("Milestone A · guard 2 — retirement states a fact, never a replacement", () => {
  // NEU publishes NO policy for a discontinued required course; the catalog
  // hands it to an advisor. So naming a successor would be our invention
  // wearing the registrar's authority, and a student could take it and find it
  // does not count.
  //
  // The temptation is concrete and arrived with the first real roll: 974
  // removals against 923 additions is suspiciously balanced, and some of it IS
  // renumbering. Matching those up by title or by number is a five-line change
  // that would look like an improvement.
  const FORBIDDEN = [
    "substitute", "substitutes", "substitutedBy", "replacedBy", "replacement",
    "successor", "supersededBy", "renamedTo", "equivalentTo", "seeInstead",
  ];

  test("no union record names a successor", () => {
    for (const c of union) {
      for (const f of FORBIDDEN) {
        assert.equal(c[f], undefined,
          `${keyOfCourse(c)} carries \`${f}\`. Retirement states that a course is gone; `
          + "which course replaces it is an advising decision NEU does not publish.");
      }
    }
  });

  test("the student's own substitutions are untouched by this", () => {
    // Guarding the fact, not the word. A student-entered substitution is a
    // different thing entirely — their choice, recorded in their own plan — and
    // a guard that banned the concept outright would be wrong. This asserts the
    // union carries no `substitutions` key of its own, which is what keeps the
    // two from being confused.
    for (const c of union) {
      assert.equal(c.substitutions, undefined,
        `${keyOfCourse(c)} carries \`substitutions\` — that belongs to a student's plan, not a course`);
    }
  });
});

describe("Milestone A · guard 3 — fidelity travels with the record", () => {
  test("every record says which fidelity its edition had", () => {
    // Editions before 2022 publish title + credits + description and nothing
    // else: no Prerequisite(s), no Corequisite(s), no Attribute(s) lines exist
    // on the page. A record from one has `prereqs: []` meaning "this edition
    // did not publish prerequisites", NEVER "this course has none". Reading the
    // first as the second schedules a course before what it requires.
    for (const c of union) {
      assert.ok(["full", "descriptive"].includes(c.lifespan?.fidelity),
        `${keyOfCourse(c)} has no lifespan.fidelity, so a consumer cannot tell an empty `
        + "field from an unpublished one");
    }
  });

  test("fidelity agrees with the edition that supplied the record", () => {
    for (const c of union) {
      const expected = c.lifespan.lastEdition >= FIRST_FULL_FIDELITY_EDITION ? "full" : "descriptive";
      assert.equal(c.lifespan.fidelity, expected,
        `${keyOfCourse(c)} is from edition ${c.lifespan.lastEdition} but claims `
        + `fidelity "${c.lifespan.fidelity}"`);
    }
  });

  test("TRIPWIRE — a descriptive-era record must not reach the union unnoticed", () => {
    // Today every frozen edition is `full`, so the two tests above cannot fail
    // for the reason they exist. That makes this the honest one: it records
    // that the descriptive case is UNEXERCISED, and fails the moment it stops
    // being — which is the moment somebody has to go and check that no consumer
    // is reading an empty field as a fact.
    //
    // Without it the backfill lands, `prereqs: []` starts meaning two different
    // things, every test still passes, and the planner quietly begins
    // scheduling courses before their prerequisites.
    const descriptive = union.filter(c => c.lifespan?.fidelity === "descriptive");
    assert.deepEqual(descriptive.map(keyOfCourse), [],
      `${descriptive.length} record(s) now come from a descriptive-era edition (pre-`
      + `${FIRST_FULL_FIDELITY_EDITION}). That is expected once editions 2016–2021 are `
      + "backfilled, and it is NOT automatically safe: every consumer that reads an "
      + "empty prereqs/coreqs/nuPath array off a union record must first be checked to "
      + "treat it as UNPUBLISHED rather than as none. Audit those, then update this test.");
  });
});
