// INVARIANT · public/northeastern/catalog-courses.json
//
// Every {subject,number} referenced inside a course's prereqs/coreqs should
// resolve to a course that exists in the catalog. Some legitimately don't —
// discontinued courses, or grad/cross-college courses outside this catalog —
// so a committed baseline (prereq-resolution-baseline.json) records the known
// unresolved refs. The test fails only when a NEW unresolved ref appears, which
// is the signature of a scraper regression dropping a course others still cite.
// Refresh the baseline with `npm run test:baseline:update`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, readJson } from "../helpers/paths.js";

const baseline = new Set(readJson("test/invariant/prereq-resolution-baseline.json"));

function collectRefs(tree, into) {
  if (!Array.isArray(tree)) return;
  for (const tok of tree) {
    if (Array.isArray(tok)) collectRefs(tok, into);
    else if (tok && typeof tok === "object" && tok.subject && tok.number) {
      into.add(`${String(tok.subject).toUpperCase()}${tok.number}`);
    }
  }
}

test("catalog › every course has the required identity fields", () => {
  const courses = loadCatalog();
  const bad = courses.filter((c) => !c.subject || !c.number || typeof c.credits === "undefined");
  assert.equal(bad.length, 0, `${bad.length} course(s) missing subject/number/credits`);
});

test("catalog › no NEW unresolved prereq/coreq references beyond the baseline", () => {
  const courses = loadCatalog();
  const ids = new Set(courses.map((c) => `${c.subject.toUpperCase()}${c.number}`));

  const referenced = new Set();
  for (const c of courses) {
    collectRefs(c.prereqs, referenced);
    collectRefs(c.coreqs, referenced);
  }

  const newlyUnresolved = [...referenced].filter((id) => !ids.has(id) && !baseline.has(id)).sort();
  assert.deepEqual(
    newlyUnresolved,
    [],
    `New unresolved prereq/coreq reference(s) — a scrape likely dropped a course others cite.\n` +
      `If expected (e.g. a truly discontinued course), accept via \`npm run test:baseline:update\`:\n  ` +
      newlyUnresolved.join("\n  ")
  );
});
