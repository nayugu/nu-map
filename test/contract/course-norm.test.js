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
