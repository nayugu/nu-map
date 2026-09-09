// UNIT · findCohortVersion — which edition of a program a cohort is offered.
//
// The function this replaced asked "is a NEWER version available", which was
// written before catalog editions were frozen per cohort and became wrong the
// moment they were. Measured on the live tree the day it was found: it fired
// for 338 of 498 undergraduate majors for every cohort from fall 2023 to
// spring 2026 — every student the app had — and each firing advised the
// student to leave the edition they actually owe. Clicking Switch loaded the
// other edition's requirements and emptied the program box, because the
// offered path was not in that cohort's option list.
//
// So the tests here are about two properties, and the second is the one that
// makes the first safe:
//
//   1. the DIRECTION is "differs from the cohort", not "is newer" — a plan
//      ahead of its cohort must be offered the way back;
//   2. the offered path is always one `atCohortYear` keeps, so it can always
//      be displayed and re-selected.
//
// Property 2 is asserted by CONSTRUCTION over every (map, cohort, path) triple
// below rather than by a hand-picked example, because that is the property a
// future edit is most likely to break silently: nothing about returning an
// unlistable path throws, logs, or fails a render.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findCohortVersion, atCohortYear, parseMajorPathParts, cohortCatalogYear,
         editionsOf, editionLabel }
  from "../../src/data/programPaths.js";

const P = (year, college = "khoury", folder = "cs_bscs_(boston)") =>
  `../../data/northeastern/programs/undergraduate/${year}/${college}/${folder}/requirements.json`;

/** A path-keyed registry, the shape import.meta.glob produces. */
const mapOf = (...paths) => Object.fromEntries(paths.map(p => [p, () => {}]));

/** The option rows `atCohortYear` filters, derived from the same map. */
const optionsOf = (map) => Object.keys(map).map(p => ({ path: p, ...parseMajorPathParts(p) }));

/**
 * Property 2, as an assertion any test can call: whatever is offered must be
 * something that cohort's own dropdown contains.
 */
function assertOfferIsSelectable(map, path, cohort) {
  const offer = findCohortVersion(map, path, cohort);
  if (offer === null) return null;
  const listed = atCohortYear(optionsOf(map), cohort).map(o => o.path);
  assert.ok(listed.includes(offer),
    `offered a path the cohort-${cohort} dropdown does not contain:\n` +
    `  offered: ${offer}\n  listed:  ${listed.join("\n           ")}`);
  return offer;
}

describe("editionLabel", () => {
  test("names the academic year, not the directory year", () => {
    // Directories key on the ENDING year; NEU prints the span. Getting this
    // backwards labels every edition one academic year wrong, everywhere.
    assert.equal(editionLabel(2026), "2025-2026");
    assert.equal(editionLabel(2027), "2026-2027");
    assert.equal(editionLabel("2026"), "2025-2026");   // a path segment is a string
  });

  test("a non-year is empty, never 'NaN-NaN'", () => {
    for (const bad of [undefined, null, "", "soon", NaN]) assert.equal(editionLabel(bad), "");
  });
});

describe("editionsOf · what the selector may offer", () => {
  const map = mapOf(P(2026), P(2027), P(2026, "science", "math_bs"), P(2028));

  test("only this program's editions, oldest first", () => {
    assert.deepEqual(editionsOf(map, P(2027)).map(e => e.year), [2026, 2027, 2028]);
    assert.deepEqual(editionsOf(map, P(2026, "science", "math_bs")).map(e => e.year), [2026]);
  });

  test("every offered edition is a path that EXISTS in the registry", () => {
    // The safety property the whole feature rests on. An option that resolves
    // to no requirements file empties the program box, which is the defect this
    // panel was repaired for — so the selector is built from the registry
    // itself and can never invent a year.
    for (const e of editionsOf(map, P(2026))) {
      assert.ok(map[e.path], `offered ${e.path}, which is not in the map`);
      assert.equal(parseMajorPathParts(e.path).year, e.year, "year and path disagree");
    }
  });

  test("a path in no registry offers nothing", () => {
    assert.deepEqual(editionsOf(map, "not/a/path"), []);
    assert.deepEqual(editionsOf({}, P(2026)), []);
  });

  test("what the selector offers is what findCohortVersion may return", () => {
    // These two must agree or the hint names an edition the dropdown beside it
    // does not list. They share `editionsOf` for exactly this reason.
    for (const cohort of [2023, 2026, 2027, 2028, 2031]) {
      const offer = findCohortVersion(map, P(2027), cohort);
      if (offer === null) continue;
      assert.ok(editionsOf(map, P(2027)).some(e => e.path === offer),
        `cohort ${cohort}: the hint offers ${offer}, absent from the selector`);
    }
  });
});

describe("findCohortVersion · direction", () => {
  const TWO = mapOf(P(2026), P(2027));

  test("a correctly pinned plan is offered nothing", () => {
    // The 338-of-498 case. Silence here is the entire fix.
    assert.equal(findCohortVersion(TWO, P(2026), 2026), null);
    assert.equal(findCohortVersion(TWO, P(2027), 2027), null);
  });

  test("a plan BEHIND its cohort is offered the newer edition", () => {
    assert.equal(assertOfferIsSelectable(TWO, P(2026), 2027), P(2027));
  });

  test("a plan AHEAD of its cohort is offered the older edition", () => {
    // The rescue path. A newer-only check returns null here, which is why the
    // old function could not be repaired by bolting a cohort test onto it —
    // it strands precisely the students it damaged.
    assert.equal(assertOfferIsSelectable(TWO, P(2027), 2026), P(2026));
  });

  test("a cohort older than anything held is offered the oldest, not the newest", () => {
    // pickCatalogYear's documented fallback: the closest honest answer for a
    // student who predates our archive is the earliest edition we have.
    assert.equal(assertOfferIsSelectable(TWO, P(2027), 2024), P(2026));
  });

  test("a cohort newer than anything held is offered the newest", () => {
    assert.equal(assertOfferIsSelectable(TWO, P(2026), 2031), P(2027));
  });
});

describe("findCohortVersion · refusing to guess", () => {
  const TWO = mapOf(P(2026), P(2027));

  test("no cohort year means no opinion", () => {
    // A plan with no entry term yet. pickCatalogYear answers "newest" for NaN
    // because that is right when BUILDING A LIST; acting on it here would
    // prompt every such student onto an edition we cannot say is theirs.
    for (const bad of [NaN, undefined, null, "2027", Infinity]) {
      assert.equal(findCohortVersion(TWO, P(2026), bad), null, `cohort ${String(bad)}`);
    }
  });

  test("a single held edition offers nothing, whatever the cohort", () => {
    // Graduate today. The function must be inert until a second edition lands —
    // and this is the case that will change under it, silently, on the next
    // graduate roll.
    const ONE = mapOf(P(2026));
    for (const cohort of [2020, 2026, 2027, 2031]) {
      assert.equal(findCohortVersion(ONE, P(2026), cohort), null, `cohort ${cohort}`);
    }
  });

  test("a path in no registry offers nothing", () => {
    assert.equal(findCohortVersion(mapOf(P(2026), P(2027)), "not/a/path", 2027), null);
    assert.equal(findCohortVersion({}, P(2026), 2027), null);
  });

  test("a DIFFERENT program's editions are never offered", () => {
    // The predicate is (college, folder) exact, matching the dropdown's dedupe.
    // A folder-blind version would offer a student a different degree entirely.
    const map = mapOf(P(2026, "khoury", "cs_bscs_(boston)"), P(2027, "khoury", "ds_bs_(boston)"));
    assert.equal(findCohortVersion(map, P(2026, "khoury", "cs_bscs_(boston)"), 2027), null);
  });

  test("the same folder in a different college is never offered", () => {
    const map = mapOf(P(2026, "khoury", "cs_bscs_(boston)"), P(2027, "science", "cs_bscs_(boston)"));
    assert.equal(findCohortVersion(map, P(2026, "khoury", "cs_bscs_(boston)"), 2027), null);
  });
});

describe("findCohortVersion · the offer is always selectable", () => {
  // Property 2 by construction. Three editions rather than two, because the
  // interesting failures need a middle: a cohort whose pick is neither the
  // newest nor the oldest is where "offer the newest" and "offer the cohort's"
  // finally disagree, and a two-edition map cannot tell them apart.
  const THREE = mapOf(P(2026), P(2027), P(2028));

  test("over every (saved edition × cohort) pair we could hold", () => {
    let offers = 0;
    for (const saved of [2026, 2027, 2028]) {
      for (const cohort of [2023, 2026, 2027, 2028, 2030]) {
        if (assertOfferIsSelectable(THREE, P(saved), cohort) !== null) offers++;
      }
    }
    // A guard on the guard: if a refactor made this return null everywhere the
    // loop above would pass for free and prove nothing.
    assert.ok(offers >= 9, `expected the sweep to exercise real offers, got ${offers}`);
  });

  test("switching, then re-asking, is a fixed point", () => {
    // The plan the student ends on must not be offered another move — that
    // would be a banner that reappears the instant it is obeyed.
    for (const saved of [2026, 2027, 2028]) {
      for (const cohort of [2023, 2026, 2027, 2028, 2030]) {
        const offer = findCohortVersion(THREE, P(saved), cohort);
        if (offer === null) continue;
        assert.equal(findCohortVersion(THREE, offer, cohort), null,
          `cohort ${cohort} was offered ${offer} and then offered another move`);
      }
    }
  });
});

describe("findCohortVersion · through cohortCatalogYear", () => {
  const TWO = mapOf(P(2026), P(2027));

  test("the entry SEMESTER decides, not the year alone", () => {
    // A fall-2026 entrant follows 2027; a spring-2026 entrant follows 2026.
    // Both are "2026" to a reader who only looks at the number, and they are
    // owed different editions.
    assert.equal(findCohortVersion(TWO, P(2026), cohortCatalogYear("fall", 2026)), P(2027));
    assert.equal(findCohortVersion(TWO, P(2026), cohortCatalogYear("spring", 2026)), null);
  });

  test("every cohort the app currently has is offered nothing on a 2026 plan", () => {
    // The regression this whole change exists to prevent, stated as the app's
    // own population: fall 2023 through spring 2026, all correctly pinned.
    for (const [sem, yr] of [["fall", 2023], ["fall", 2024], ["fall", 2025], ["spring", 2026]]) {
      assert.equal(findCohortVersion(TWO, P(2026), cohortCatalogYear(sem, yr)), null,
        `${sem} ${yr} was told to leave its own catalog edition`);
    }
  });
});
