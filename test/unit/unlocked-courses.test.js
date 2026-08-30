// UNIT · src/core/courseModel.js — unlockedCourses, the UNLOCKS list of the
// details panel. One entry per COURSE, however many edges the pair has, and
// corequisites are not one of them.
//
// Two defects it pins:
//   · a corequisite declared on both sides is two edges, so IE 4522
//     (Human-Machine Systems) printed IE 4523 (its lab) twice — 243 of the 262
//     coreq groups are mutual, so this was the ordinary case;
//   · a prerequisite named in two branches of one OR is two edges differing
//     only in a minGrade the row never shows (352 pairs).
// Corequisites have since moved out of this list entirely, onto their own line
// under the prerequisites, so the coreq cases here assert an EXCLUSION.
//
// Pure, deterministic, no I/O. Naming: "subject › condition › expected".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getConnections } from "../../src/core/planModel.js";
import { unlockedCourses, coreqPartnersOf, extractEdges } from "../../src/core/courseModel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const edge = (from, to, type = "prerequisite", extra = {}) => ({ from, to, type, ...extra });

test("unlockedCourses › same prereq in two OR branches › one entry, gates not shown", () => {
  const edges = [
    edge("ACCT5230", "ACCT5232", "prerequisite", { minGrade: "D-" }),
    edge("ACCT5230", "ACCT5232", "prerequisite", { minGrade: "C-" }),
  ];
  assert.deepEqual(unlockedCourses("ACCT5230", edges), ["ACCT5232"]);
});

test("unlockedCourses › a mutually declared corequisite › listed neither once nor twice", () => {
  // The IE 4522 / IE 4523 shape, from both ends. Coreqs belong to the panel's
  // own Coreqs line now; if they ever come back here, they come back doubled.
  const edges = [edge("IE4523", "IE4522", "corequisite"), edge("IE4522", "IE4523", "corequisite")];
  assert.deepEqual(unlockedCourses("IE4522", getConnections("IE4522", edges)), []);
  assert.deepEqual(unlockedCourses("IE4523", getConnections("IE4523", edges)), []);
});

test("unlockedCourses › a one-sided coreq › excluded in whichever direction it was declared", () => {
  assert.deepEqual(unlockedCourses("A", [edge("A", "B", "corequisite")]), []);
  assert.deepEqual(unlockedCourses("A", [edge("B", "A", "corequisite")]), []);
  assert.deepEqual(unlockedCourses("A", [edge("A", "B", "corequisite-viol")]), []);
});

test("unlockedCourses › a coreq beside a real dependent › only the dependent", () => {
  const edges = [edge("A", "LAB", "corequisite"), edge("A", "NEXT"), edge("PREV", "A")];
  assert.deepEqual(unlockedCourses("A", edges), ["NEXT"]);
});

test("unlockedCourses › incoming prerequisites › excluded (the panel prints those above)", () => {
  assert.deepEqual(unlockedCourses("ME", [edge("PREREQ", "ME"), edge("ME", "DEPENDENT")]), ["DEPENDENT"]);
});

test("unlockedCourses › junk input › self-edge, unrelated edge and empty list", () => {
  const edges = [edge("A", "A"), edge("X", "Y"), edge("A", "B")];
  assert.deepEqual(unlockedCourses("A", edges), ["B"]);
  assert.deepEqual(unlockedCourses("A", []), []);
  assert.deepEqual(unlockedCourses("A", undefined), []);
});

test("unlockedCourses › order › first appearance, and dedup does not reorder", () => {
  const edges = [edge("A", "C"), edge("A", "B"), edge("A", "C"), edge("A", "D")];
  assert.deepEqual(unlockedCourses("A", edges), ["C", "B", "D"]);
});

test("unlockedCourses › live catalog › no course is listed twice, and no coreq leaks in", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw));
  const allEdges = courses.flatMap(c =>
    extractEdges(`${(c.subject ?? "").toUpperCase()}${c.number ?? ""}`, c.prereqs, c.coreqs));

  const byId = new Map();
  for (const e of allEdges) {
    for (const end of [e.from, e.to]) {
      if (!byId.has(end)) byId.set(end, []);
      byId.get(end).push(e);
    }
  }

  let listed = 0;
  for (const [id, edges] of byId) {
    const rows = unlockedCourses(id, edges);
    assert.equal(new Set(rows).size, rows.length, `${id} lists a course more than once`);
    listed += rows.length;
    // Nothing this course must be taken WITH may appear in what it unlocks.
    const partners = new Set(coreqPartnersOf(allEdges, id));
    for (const r of rows) assert.ok(!partners.has(r), `${id} lists its corequisite ${r} under unlocks`);
  }
  // The dedup must not have emptied the list: ~7,500 prereq edges fold to
  // rather fewer rows, but the order of magnitude has to survive.
  assert.ok(listed > 5000, `expected the unlocks to survive, got ${listed}`);

  // Human-Machine Systems: the lab is its coreq and appears in neither list here.
  assert.deepEqual(unlockedCourses("IE4522", byId.get("IE4522") ?? []).filter(r => r === "IE4523"), []);
});
