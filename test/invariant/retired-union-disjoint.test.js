// INVARIANT · the two course files SHIPPED to the browser are disjoint.
//
// `derive-retired-union.js` already refuses to write an overlapping union, so
// this is not a second copy of that check — it guards the other half. The
// script's rail runs at DERIVE time and can only see the run it is part of;
// this runs on whatever is actually committed, and catches the cases the rail
// structurally cannot:
//
//   - the union written, then `catalog-courses.json` regenerated after it
//     (the two files are produced by different steps of the monthly job, and
//     nothing but step ordering keeps them consistent);
//   - a hand-edited or partially-merged artifact;
//   - a revived course — NEU does un-retire them — that came back into the
//     catalog while the union still names it.
//
// Why it matters rather than being tidiness: `mergeRetiredUnion` appends, and
// resolves a collision by keeping the CATALOG entry. So an overlap does not
// throw. It silently makes one of the two files a lie, and which record a
// student sees depends on load order — the class of bug this repo's disjoint
// storage design exists to make impossible to express.
//
// The invariant suite runs with no `npm install`, so this stays dependency-free.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const url = (p) => new URL(`../../public/northeastern/${p}`, import.meta.url);
const keyOf = (c) => `${(c.subject || "").toUpperCase().trim()}${(c.number || "").trim()}`;

const CATALOG = JSON.parse(readFileSync(url("catalog-courses.json"), "utf8"));
const UNION_PATH = url("retired-courses.json");

describe("the retired union ships disjoint from the catalog", () => {
  test("retired-courses.json exists and is an array", () => {
    // Its ABSENCE is a real failure, not a skip. The browser treats it as
    // optional so a fetch hiccup degrades gracefully, but a build that never
    // produced it would ship a planner that silently drops retired courses
    // while every test here passed by not running.
    assert.ok(existsSync(UNION_PATH),
      "public/northeastern/retired-courses.json is missing — run `node scripts/derive-retired-union.js --write`");
    assert.ok(Array.isArray(JSON.parse(readFileSync(UNION_PATH, "utf8"))),
      "the union must be a flat array, matching catalog-courses.json");
  });

  test("no key appears in both files", () => {
    const union = JSON.parse(readFileSync(UNION_PATH, "utf8"));
    const current = new Set(CATALOG.map(keyOf));
    const both = union.map(keyOf).filter(k => current.has(k));
    assert.deepEqual(both.slice(0, 20), [],
      `${both.length} course(s) are in BOTH catalog-courses.json and retired-courses.json. `
      + "mergeRetiredUnion keeps the catalog entry, so the union's copy is silently ignored "
      + "and which record wins depends on load order. Re-run derive-retired-union.js.");
  });

  test("every retired course carries a lifespan, and no scrape date", () => {
    const union = JSON.parse(readFileSync(UNION_PATH, "utf8"));
    for (const c of union) {
      const k = keyOf(c);
      assert.ok(c.lifespan, `${k} has no lifespan — the union's whole point is answering "which editions published this"`);
      assert.ok(Number.isInteger(c.lifespan.firstEdition), `${k} lifespan.firstEdition is not a year`);
      assert.ok(Number.isInteger(c.lifespan.lastEdition), `${k} lifespan.lastEdition is not a year`);
      assert.ok(c.lifespan.firstEdition <= c.lifespan.lastEdition,
        `${k} lifespan runs backwards: ${c.lifespan.firstEdition} → ${c.lifespan.lastEdition}`);
      assert.equal(c.retiredSince, undefined,
        `${k} carries retiredSince, the day OUR scrape missed it — the lifespan replaces that, and two representations drift`);
    }
  });

  test("every retired course is renderable as an ordinary course", () => {
    // A retired course goes through `normalizeCourse` like any other and is
    // drawn by the same card. `occupantCards` records the cost of a partial
    // record — "card rendering reads several of these without guarding;
    // color.slice() was the one that threw" — so a stub in this file would
    // trade a silent disappearance for a crash, which is the worse failure.
    const union = JSON.parse(readFileSync(UNION_PATH, "utf8"));
    for (const c of union) {
      const k = keyOf(c);
      assert.ok(c.subject && c.number, "a record with no subject/number cannot be keyed at all");
      assert.equal(typeof c.title, "string", `${k} has no title`);
      assert.ok(c.title.length, `${k} has an empty title — the card would draw a blank header`);
      assert.equal(typeof c.credits, "number", `${k} has no numeric credits, so it would count 0 SH toward the degree`);
    }
  });
});
