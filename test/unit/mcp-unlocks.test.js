// UNIT · src/adapters/mcp/plannerQueryAdapter.js — `relationships.unlocks`.
//
// The API half of a defect the details panel fixed first. `relationships`
// answers two lists at once, and a corequisite edge left in the unlocks index
// came back in BOTH of them:
//
//     ARCH 2330 → { unlocks: [{ courseId: "ARCH2331", type: "corequisite" }],
//                   coreqs:  ["ARCH2331"] }
//
// Measured over the live catalog before the fix: 461 courses carried a
// corequisite in `unlocks`, and 444 of them named a class the same response had
// already named. A reader — a person or a model — sees the class twice and has
// no way to tell it is one class.
//
// The panel reached this first (see core/courseModel.js `unlockedCourses`): a
// corequisite is a symmetric same-term relation, not something a course
// unlocks. These tests hold the two consumers to the same answer.
//
// Pure, deterministic, no ports. `buildUnlocksIndex` and `coreqEdgesOf` are
// exported precisely so this needs none of the adapter's eight dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildUnlocksIndex, coreqEdgesOf } from "../../src/adapters/mcp/plannerQueryAdapter.js";
import { coreqPartnersOf, unlockedCourses, extractEdges } from "../../src/core/courseModel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// `extractEdges` reads {subject, number} and points the edge FROM the named
// course TO the one declaring it — the prereq unlocks the course that needs it.
const course = (id, { prereqs = null, coreqs = null } = {}) => ({ id, prereqs, coreqs });
const req = (subject, number, extra = {}) => ({ subject, number, ...extra });

// ── The shapes, in isolation ─────────────────────────────────────

test("unlocks › a corequisite is not something a course unlocks", () => {
  const idx = buildUnlocksIndex([
    course("ARCH2330", { coreqs: [req("ARCH", "2331")] }),
    course("ARCH2331", { coreqs: [req("ARCH", "2330")] }),
  ]);
  assert.deepEqual(idx.get("ARCH2330") ?? [], []);
  assert.deepEqual(idx.get("ARCH2331") ?? [], []);
});

test("unlocks › one entry per unlocked COURSE, not per edge", () => {
  // The same prereq named in two OR branches is two edges differing only in a
  // minGrade this index does not carry.
  const idx = buildUnlocksIndex([course("ACCT5232", {
    prereqs: ["Or", req("ACCT", "5230", { minGrade: "D-" }), req("ACCT", "5230", { minGrade: "C-" })],
  })]);
  assert.deepEqual(idx.get("ACCT5230").map(e => e.courseId), ["ACCT5232"]);
});

test("unlocks › `concurrent` survives if ANY branch allows it", () => {
  // "could taking this unlock that" — one permitting branch is enough, and the
  // answer must not depend on which edge came first.
  const both = (first, second) => buildUnlocksIndex([course("B1", {
    prereqs: ["Or", req("A", "1", first ? { concurrent: true } : {}),
                    req("A", "1", second ? { concurrent: true } : {})],
  })]).get("A1")[0];
  assert.equal(both(true, false).concurrent, true);
  assert.equal(both(false, true).concurrent, true, "order must not decide it");
  assert.equal(both(false, false).concurrent, undefined, "and it is not invented");
});

test("unlocks › a course that names ITSELF as a prerequisite unlocks nothing", () => {
  // Six courses in the live catalog do this (SPNS 1101, 1102, 2101, 2102,
  // 3101 …). Left in, the response says taking SPNS 1101 unlocks SPNS 1101 —
  // the same class again, in the one list it should never be in.
  const idx = buildUnlocksIndex([course("SPNS1101", {
    prereqs: [req("SPNS", "1101"), req("SPNS", "1102")],
  })]);
  assert.deepEqual((idx.get("SPNS1101") ?? []).map(e => e.courseId), []);
  assert.deepEqual(idx.get("SPNS1102").map(e => e.courseId), ["SPNS1101"]);
});

test("unlocks › junk courses are skipped rather than thrown on", () => {
  for (const input of [null, undefined, [], [null], [{}], [course("X")]]) {
    assert.ok(buildUnlocksIndex(input) instanceof Map, `threw or returned junk for ${JSON.stringify(input)}`);
  }
  assert.deepEqual(coreqEdgesOf(null), []);
});

// ── Against the live catalog ─────────────────────────────────────

test("unlocks › live catalog › no response names the same class twice", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = (Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw)))
    .map(c => ({ ...c, id: `${(c.subject ?? "").toUpperCase()}${c.number ?? ""}` }));

  const idx = buildUnlocksIndex(courses);
  const coreqEdges = coreqEdgesOf(courses);

  let withUnlocks = 0, withCoreqs = 0;
  for (const c of courses) {
    const unlocks = idx.get(c.id) ?? [];
    const coreqs = coreqPartnersOf(coreqEdges, c.id);
    if (unlocks.length) withUnlocks++;
    if (coreqs.length) withCoreqs++;

    const ids = unlocks.map(u => u.courseId);
    assert.equal(new Set(ids).size, ids.length, `${c.id} lists a course twice under unlocks`);
    assert.ok(!ids.includes(c.id), `${c.id} unlocks itself`);
    // THE defect: one class, two lists, one response.
    for (const id of ids) {
      assert.ok(!coreqs.includes(id),
        `${c.id} names ${id} under BOTH unlocks and coreqs`);
    }
  }
  // The exclusion must not have emptied either list.
  assert.ok(withUnlocks > 1000, `expected unlocks to survive, got ${withUnlocks}`);
  assert.ok(withCoreqs > 400, `expected coreqs to survive, got ${withCoreqs}`);
});

test("unlocks › live catalog › the API and the panel agree on what a course unlocks", () => {
  // Two consumers, two code paths, one answer. They drifted once — the panel
  // dropped corequisites and the adapter kept them — and nothing was watching.
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = (Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw)))
    .map(c => ({ ...c, id: `${(c.subject ?? "").toUpperCase()}${c.number ?? ""}` }));

  const idx = buildUnlocksIndex(courses);
  const allEdges = courses.flatMap(c => extractEdges(c.id, c.prereqs, c.coreqs));
  const byFrom = new Map();
  for (const e of allEdges) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e);
  }

  const disagreed = [];
  for (const c of courses) {
    const api = (idx.get(c.id) ?? []).map(u => u.courseId).sort();
    const panel = unlockedCourses(c.id, byFrom.get(c.id) ?? []).slice().sort();
    if (api.join() !== panel.join()) disagreed.push(c.id);
  }
  assert.deepEqual(disagreed.slice(0, 5), [],
    `${disagreed.length} courses where the API and the panel disagree`);
});
