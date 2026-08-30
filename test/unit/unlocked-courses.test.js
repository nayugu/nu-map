// UNIT · src/core/courseModel.js — relatedPartners, the UNLOCKS list of the
// details panel. One row per PARTNER COURSE, however many edges the pair has.
//
// The defect it fixes: a corequisite declared on both sides is two edges, so
// IE 4522 (Human-Machine Systems) listed IE 4523 (its lab) twice, and a
// prerequisite named in two branches of one OR is two edges differing only in
// a minGrade the row never shows. Both printed the same course twice.
//
// Pure, deterministic, no I/O. Naming: "subject › condition › expected".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getConnections } from "../../src/core/planModel.js";
import { relatedPartners, extractEdges } from "../../src/core/courseModel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const edge = (from, to, type = "prerequisite", extra = {}) => ({ from, to, type, ...extra });
const ids  = list => list.map(r => r.id);

test("relatedPartners › mutually declared corequisite › the partner appears once", () => {
  // Exactly the IE 4522 / IE 4523 shape: each course names the other.
  const edges = [edge("IE4523", "IE4522", "corequisite"), edge("IE4522", "IE4523", "corequisite")];
  const rows  = relatedPartners("IE4522", getConnections("IE4522", edges));
  assert.deepEqual(rows, [{ id: "IE4523", type: "corequisite" }]);
  // …and from the lab's side too, which is a different edge order.
  assert.deepEqual(relatedPartners("IE4523", getConnections("IE4523", edges)),
    [{ id: "IE4522", type: "corequisite" }]);
});

test("relatedPartners › coreq declared on one side only › still listed, either direction", () => {
  const declaredByOther = [edge("B", "A", "corequisite")];   // B names A
  const declaredBySelf  = [edge("A", "B", "corequisite")];   // A names B
  assert.deepEqual(relatedPartners("A", declaredByOther), [{ id: "B", type: "corequisite" }]);
  assert.deepEqual(relatedPartners("A", declaredBySelf),  [{ id: "B", type: "corequisite" }]);
});

test("relatedPartners › same prereq in two OR branches › one row, gates not shown", () => {
  const edges = [
    edge("ACCT5230", "ACCT5232", "prerequisite", { minGrade: "D-" }),
    edge("ACCT5230", "ACCT5232", "prerequisite", { minGrade: "C-" }),
  ];
  assert.deepEqual(relatedPartners("ACCT5230", edges), [{ id: "ACCT5232", type: "prerequisite" }]);
});

test("relatedPartners › incoming prerequisites › excluded (the panel prints those above)", () => {
  const edges = [edge("PREREQ", "ME"), edge("ME", "DEPENDENT")];
  assert.deepEqual(ids(relatedPartners("ME", edges)), ["DEPENDENT"]);
});

test("relatedPartners › a misplaced coreq › outranks the plain edge in BOTH orders", () => {
  const plainFirst = [edge("A", "B", "corequisite"), edge("B", "A", "corequisite-viol")];
  const violFirst  = [edge("B", "A", "corequisite-viol"), edge("A", "B", "corequisite")];
  assert.deepEqual(relatedPartners("A", plainFirst), [{ id: "B", type: "corequisite-viol" }]);
  assert.deepEqual(relatedPartners("A", violFirst),  [{ id: "B", type: "corequisite-viol" }]);
});

test("relatedPartners › a pair that is both prereq and coreq › the coreq badge wins", () => {
  // Not in the live catalog (measured: 0 pairs), but the tie-break must be
  // decided by rank rather than by whichever edge the array held first.
  const prereqFirst = [edge("A", "B"), edge("A", "B", "corequisite")];
  const coreqFirst  = [edge("A", "B", "corequisite"), edge("A", "B")];
  assert.deepEqual(relatedPartners("A", prereqFirst), [{ id: "B", type: "corequisite" }]);
  assert.deepEqual(relatedPartners("A", coreqFirst),  [{ id: "B", type: "corequisite" }]);
});

test("relatedPartners › junk input › a self-edge and an unrelated edge are ignored", () => {
  const edges = [
    edge("A", "A", "corequisite"),   // a course is not its own corequisite
    edge("X", "Y"),                  // touches neither end
    edge("A", "B"),
  ];
  assert.deepEqual(ids(relatedPartners("A", edges)), ["B"]);
  assert.deepEqual(relatedPartners("A", []), []);
});

test("relatedPartners › order › first appearance, and dedup does not reorder", () => {
  const edges = [edge("A", "C"), edge("A", "B"), edge("A", "C"), edge("A", "D")];
  assert.deepEqual(ids(relatedPartners("A", edges)), ["C", "B", "D"]);
});

test("relatedPartners › live catalog › no course lists any partner twice", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw));
  const allEdges = courses.flatMap(c => {
    const id = `${(c.subject ?? "").toUpperCase()}${c.number ?? ""}`;
    return extractEdges(id, c.prereqs, c.coreqs);
  });

  // Only the courses that touch an edge — walking 8,000 × 15,000 is pointless.
  const touched = new Set(allEdges.flatMap(e => [e.from, e.to]));
  const byId = new Map();
  for (const e of allEdges) {
    for (const end of [e.from, e.to]) {
      if (!byId.has(end)) byId.set(end, []);
      byId.get(end).push(e);
    }
  }

  let coreqRows = 0;
  for (const id of touched) {
    const rows = relatedPartners(id, byId.get(id));
    const seen = new Set(rows.map(r => r.id));
    assert.equal(seen.size, rows.length, `${id} lists a partner more than once`);
    coreqRows += rows.filter(r => r.type === "corequisite").length;
  }

  // The dedup must not have deleted the relationships themselves: every coreq
  // edge is one row on each of its two ends, minus the mutual pairs that fold
  // (243 of them at time of writing, so ~500 rows survive, not ~1,010).
  assert.ok(coreqRows > 400, `expected the coreq rows to survive, got ${coreqRows}`);
  const ie = relatedPartners("IE4522", byId.get("IE4522") ?? []).filter(r => r.id === "IE4523");
  assert.deepEqual(ie, [{ id: "IE4523", type: "corequisite" }]);
});
