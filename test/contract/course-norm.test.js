// CONTRACT · src/adapters/northeastern/courseNorm.js
// This is the single normalization transform the browser adapter, the Node MCP
// server, and the Cloudflare worker all import — if its output shape drifts, all
// three break together. Tested against a captured raw record (fixtures/banner/)
// plus the edge cases the app relies on. Pure; deterministic (2024 term codes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCourse, mergeHistoryAndOffering } from "../../src/adapters/northeastern/courseNorm.js";
import { readJson } from "../helpers/paths.js";

const raw = readJson("test/fixtures/banner/cs2100.raw.json");

test("normalizeCourse › captured Banner record › maps to the internal Course shape", () => {
  const c = normalizeCourse(raw);
  assert.equal(c.id, "CS2100");
  assert.equal(c.subject, "CS");          // upper-cased
  assert.equal(c.number, "2100");
  assert.equal(c.code, "CS 2100");
  assert.equal(c.title, "Program Design and Implementation 1"); // from `name`
  assert.equal(c.sh, 4);                   // from `creditHours`
  assert.equal(c.scheduleType, "Lecture");
  assert.equal(c.desc, "Builds on prior introductory programming experience."); // trimmed
});

test("normalizeCourse › section term codes › derived birth term + offered semTypes", () => {
  const c = normalizeCourse(raw);
  assert.equal(c.birthTermCode, 202410);                 // earliest confirmed term
  assert.deepEqual([...c.terms].sort(), ["fall", "spring"]); // 202410/202510 fall, 202530 spring
  assert.deepEqual(c.termHistory, { 202410: true, 202510: true, 202530: true });
});

test("normalizeCourse › prereqs/coreqs under alternate keys › carried through", () => {
  const c = normalizeCourse(raw);
  assert.deepEqual(c.prereqs, [{ subject: "CS", number: "2000" }]); // from `prerequisites`
  assert.deepEqual(c.coreqs, [{ subject: "CS", number: "2101" }]);  // from `corequisites`
});

test("normalizeCourse › nuPath present › becomes attributes", () => {
  assert.deepEqual(normalizeCourse(raw).attributes, ["AD", "ND"]);
});

test("normalizeCourse › nuPath absent › falls back to the supplement map", () => {
  const bare = { subject: "MATH", number: "1341", sections: [] };
  const c = normalizeCourse(bare, {}, { MATH1341: ["FQ"] });
  assert.deepEqual(c.attributes, ["FQ"]);
});

test("normalizeCourse › missing subject or number › returns null", () => {
  assert.equal(normalizeCourse({ number: "2100" }), null);
  assert.equal(normalizeCourse({ subject: "CS" }), null);
});

test("normalizeCourse › no credit field › defaults to 4 sh", () => {
  assert.equal(normalizeCourse({ subject: "CS", number: "0000", sections: [] }).sh, 4);
});

test("normalizeCourse › restriction-only description › sanitized to empty", () => {
  const c = normalizeCourse({ subject: "CS", number: "0001", description: "Graduate students only", sections: [] });
  assert.equal(c.desc, "");
});

// ── The retirement marker ──────────────────────────────────────────
//
// `normalizeCourse` builds an EXPLICIT object, so a field the scrape writes
// and this function does not list is silently dropped. For `retired` that is
// not a missing badge, it is a wrong one: `effectiveOffered` answers
// `{ offered: true, source: "no-data" }` for any course with no term history —
// correct for the 3,250 ordinary courses in that state — so a retired course
// with the flag stripped reads as offered in every term, and CHART schedules a
// course NEU no longer teaches into a future semester.

test("normalizeCourse › a retired course carries its marker into the app", () => {
  const c = normalizeCourse({
    subject: "DGTR", number: "5000", title: "Gone", sections: [],
    retired: true, retiredSince: "2026-10-01",
  });
  assert.equal(c.retired, true,
    "the flag was dropped at normalisation, so the app cannot tell a removed course from one "
    + "we simply have no history for");
  assert.equal(c.retiredSince, "2026-10-01");
});

test("normalizeCourse › an ordinary course carries NO marker at all", () => {
  // Absent rather than `false`, so `course.retired` is falsy without every
  // consumer having to know the difference — and so the 7,000-odd ordinary
  // courses do not each grow a field.
  const c = normalizeCourse({ subject: "CS", number: "2500", title: "Fundies", sections: [] });
  assert.ok(!("retired" in c));
  assert.ok(!("retiredSince" in c));
});

test("normalizeCourse › a retired course stays PLACEABLE", () => {
  // The marker must not become a block. A probability of 0 is the only value
  // that refuses a placement, so feeding retirement into the offering verdict
  // would turn the untickable requirement row into a refused plan — the same
  // defect in a louder coat. The whole point of retaining the course is that a
  // student on the older catalog can still satisfy the requirement with it.
  const c = normalizeCourse({
    subject: "DGTR", number: "5000", title: "Gone", sections: [], retired: true,
  });
  assert.deepEqual(c.termHistory, {}, "no history is the shape it shares with 41% of the catalog");
  assert.equal(c.sh, 4, "it still has credit, so it can still answer a credit requirement");
  assert.ok(Array.isArray(c.prereqs));
});

test("normalizeCourse › a junk marker does not invent a retirement", () => {
  for (const bad of [false, 0, "", null, undefined]) {
    const c = normalizeCourse({ subject: "CS", number: "2500", sections: [], retired: bad });
    assert.ok(!("retired" in c), `retired: ${JSON.stringify(bad)} must not mark the course`);
  }
  // Marked but with no usable date: the marker is the load-bearing part, so it
  // survives, and the date degrades to null rather than to a fabricated one.
  const c = normalizeCourse({ subject: "CS", number: "2500", sections: [], retired: true });
  assert.equal(c.retired, true);
  assert.equal(c.retiredSince, null);
});

test("mergeHistoryAndOffering › merges only past terms and reattaches offering", () => {
  const [c] = mergeHistoryAndOffering(
    [normalizeCourse(raw)],
    { CS2100: { 202410: false, 202430: false, 209910: false } }, // 209910 = far-future fall, must be ignored
    { CS2100: { fallProb: 0.9 } }
  );
  // Past false entries merged in; the far-future entry filtered out entirely.
  assert.equal(c.termHistory[202410], false);
  assert.ok(!("209910" in c.termHistory));
  assert.deepEqual(c.offering, { fallProb: 0.9 });
});
