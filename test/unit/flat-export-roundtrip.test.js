// UNIT · the flat export's central promise, and its privacy promise.
//
// Export writes one ordinary plan file per selected plan and claims each one
// "opens with Load JSON on its own". That claim is worth exactly nothing
// unless it is checked: the single-plan importer hard-rejects anything whose
// `version` is not 1, so a snapshot that lost its version field would export
// happily and refuse to come back — an advisor's backup that silently is not
// one. Nothing else in the suite covers that seam.
//
// The second half is privacy. A bulk export is the heavy artifact — many
// advisees' grades in one directory — so it must make the SAME promises the
// single-plan export makes, not weaker ones.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLibraryFile, flatPlanFiles, parseLibraryFile, mergeLibrary,
  libraryToArchive, archiveToLibrary, LIBRARY_INDEX_PATH, FILE_ENVELOPE_KEYS,
} from "../../src/core/planLibraryFile.js";
import { buildTree } from "../../src/core/planFolders.js";
import { SHARE_KEYS } from "../../src/core/planSchema.js";

// ── Fixture ───────────────────────────────────────────────────────────

const FOLDERS = [
  { id: "f1", name: "Advisees", parentId: null },
  { id: "f2", name: "Jane", parentId: "f1" },
  { id: "f3", name: "Empty", parentId: "f1" },      // holds nothing
];
const PLANS = [
  { id: "p0", name: "Loose", parentId: null },
  { id: "p1", name: "Current", parentId: "f2", student: "Jane Doe" },
  { id: "p2", name: "Current", parentId: "f1", student: "Marcus Lee" }, // name clash
  { id: "p3", name: "Four-year", parentId: "f1", student: "Priya Raman" },
];

const snapshotOf = (id) => ({
  version: 1,
  exported: "2026-08-13T00:00:00.000Z",
  placements: { [`c-${id}`]: "F26" },
  grades: { [`c-${id}`]: "A" },
  specialTermPl: { w1: { typeId: "coop", company: "Acme Corp", semId: "S27" } },
  semOrders: {}, major: "undergrad/2026/computer-science/",
});

const tree = () => buildTree({ plans: PLANS, folders: FOLDERS });
const docFor = (ids, opts = {}) => buildLibraryFile(tree(), ids, snapshotOf, opts);

// ── The promise: every exported file is an importable plan file ───────

test("flat export › every file carries version 1, or it cannot be re-opened", () => {
  // importPlanJSON rejects `d.version !== 1` outright. If a plan slot ever
  // reached the export without it, the file would look fine and refuse to load.
  for (const f of flatPlanFiles(docFor(null))) {
    assert.equal(f.json.version, 1, `${f.name} would be rejected on import`);
  }
});

test("flat export › every file names itself the way the importer reads it", () => {
  const files = flatPlanFiles(docFor(null));
  const names = files.map(f => f.json.planName).sort();
  assert.deepEqual(names, ["Current", "Current", "Four-year", "Loose"]);
});

test("flat export › a file round-trips back through the single-plan door", () => {
  const [file] = flatPlanFiles(docFor(["p1"]));
  // What importPlanJSON does: strip planName, keep the rest as the slot.
  const { planName, ...body } = file.json;
  assert.equal(planName, "Current");
  assert.deepEqual(body.placements, { "c-p1": "F26" });
  assert.equal(body.version, 1);
});

test("flat export › the whole library survives export → import unchanged", () => {
  // The library door, end to end: document → parse → merge, which is what an
  // advisor actually does when moving a caseload to a new machine.
  const doc = docFor(null);
  const parsed = parseLibraryFile(JSON.parse(JSON.stringify(doc)));
  assert.ok(parsed.ok, `parse failed: ${parsed.reason}`);

  let n = 0;
  const merged = mergeLibrary(parsed, () => `new${n++}`, "Imported");
  assert.equal(merged.plans.length, PLANS.length);
  assert.equal(merged.slots.length, PLANS.length);
  // Every plan keeps its name, its student and its data.
  const byName = new Map(merged.plans.map(p => [p.name + "|" + (p.student ?? ""), p]));
  for (const p of PLANS) {
    assert.ok(byName.has(p.name + "|" + (p.student ?? "")), `lost ${p.name}`);
  }
  // Ids are re-minted, so importing a file exported from THIS browser cannot
  // overwrite the plans it came from.
  for (const p of merged.plans) assert.ok(!PLANS.some(o => o.id === p.id), "id reused");
});

// ── The advisee survives the round trip ───────────────────────────────

test("flat export › a file remembers whose plan it is", () => {
  // `student` is index-only — deliberately kept out of the plan snapshot so it
  // can never ride a share link — which means a per-plan file had nowhere to
  // put it and an advisor's entire roster evaporated on export → import.
  const files = flatPlanFiles(docFor(null));
  const byName = new Map(files.map(f => [f.json.planName + "|" + (f.json.planStudent ?? ""), f]));
  assert.ok(byName.has("Current|Jane Doe"), "Jane's plan lost its advisee");
  assert.ok(byName.has("Four-year|Priya Raman"), "Priya's plan lost its advisee");
});

test("flat export › a plan filed to nobody carries no advisee key at all", () => {
  const [loose] = flatPlanFiles(docFor(["p0"]));
  assert.equal("planStudent" in loose.json, false);
});

test("flat export › the advisee comes back through the archive's own files", () => {
  // A hand-edited zip loses the index and falls back to the entries; the
  // advisee has to survive that route too.
  const doc = docFor(null);
  const entries = libraryToArchive(doc).filter(e => e.path !== LIBRARY_INDEX_PATH);
  const rebuilt = archiveToLibrary(entries.map(e => ({ path: e.path, text: JSON.stringify(e.json) })));
  assert.ok(rebuilt.ok, `archive rebuild failed: ${rebuilt.reason}`);
  const students = rebuilt.plans.map(p => p.student ?? "").filter(Boolean).sort();
  assert.deepEqual(students, ["Jane Doe", "Marcus Lee", "Priya Raman"]);
});

test("flat export › the ADVISEE never enters a share link", () => {
  // The two envelope fields are not alike, and the difference is the whole
  // reason `student` was index-only to begin with:
  //   planName    — deliberately shared, so a recipient sees what the plan is
  //                 called. It has a share key (`pn`).
  //   planStudent — the name of the person whose plan it is. It exists in a
  //                 FILE, which already carries grades, and must never reach a
  //                 link, which goes to someone else.
  assert.ok(SHARE_KEYS.planName, "planName is expected to be shareable");
  assert.equal(SHARE_KEYS.planStudent, undefined,
    "the advisee's name is encodable into a share link — it must not be");
  assert.deepEqual([...FILE_ENVELOPE_KEYS].sort(), ["planName", "planStudent"]);
});

// ── Scope: plans only, folders contribute their contents ──────────────

test("flat export › selecting a folder exports the plans inside it, not the folder", () => {
  const files = flatPlanFiles(docFor(["f1"]));
  assert.deepEqual(files.map(f => f.json.planName).sort(),
    ["Current", "Current", "Four-year"]);
});

test("flat export › a folder holding no plans exports nothing", () => {
  assert.equal(flatPlanFiles(docFor(["f3"])).length, 0);
});

test("flat export › a folder and a plan inside it do not export it twice", () => {
  const files = flatPlanFiles(docFor(["f2", "p1"]));
  assert.equal(files.length, 1, "p1 counted twice");
});

test("flat export › names are unique even when two plans share one", () => {
  // Two advisees both with "Current" land in ONE directory. A collision here
  // is one file silently overwriting the other, at backup time.
  const names = flatPlanFiles(docFor(null)).map(f => f.name);
  assert.equal(new Set(names.map(s => s.toLowerCase())).size, names.length, names.join(", "));
});

// ── Privacy: the bulk door may never be more permissive ───────────────

test("flat export › grades are gone when the grades toggle is on", () => {
  // Mirrors PlannerContext's libraryRedact.
  const redact = (d) => { const o = { ...d }; delete o.grades; return o; };
  for (const f of flatPlanFiles(docFor(null, { redact }))) {
    assert.equal("grades" in f.json, false, `${f.name} leaked grades`);
  }
});

test("flat export › grades are present when the toggle is off", () => {
  // The guard above is only meaningful if the field is otherwise really there.
  for (const f of flatPlanFiles(docFor(null))) {
    assert.ok(f.json.grades, `${f.name} had no grades to redact — test is vacuous`);
  }
});

test("flat export › co-op employers are gone when that toggle is on", () => {
  const redact = (d) => ({
    ...d,
    specialTermPl: Object.fromEntries(Object.entries(d.specialTermPl ?? {})
      .map(([k, v]) => [k, { ...v, company: undefined }])),
  });
  for (const f of flatPlanFiles(docFor(null, { redact }))) {
    for (const w of Object.values(f.json.specialTermPl ?? {})) {
      assert.equal(w.company, undefined, `${f.name} leaked an employer`);
    }
  }
});

test("flat export › redaction cannot be defeated by exporting a folder", () => {
  // The scope path and the whole-library path must agree about privacy.
  const redact = (d) => { const o = { ...d }; delete o.grades; return o; };
  for (const ids of [null, ["f1"], ["p1"], ["f1", "p0"]]) {
    for (const f of flatPlanFiles(docFor(ids, { redact }))) {
      assert.equal("grades" in f.json, false, `leaked via ${JSON.stringify(ids)}`);
    }
  }
});

// ── Degenerate input ──────────────────────────────────────────────────

test("flat export › a plan whose slot cannot be read is dropped, not exported empty", () => {
  const doc = buildLibraryFile(tree(), null, (id) => (id === "p1" ? null : snapshotOf(id)));
  const files = flatPlanFiles(doc);
  assert.equal(files.length, PLANS.length - 1);
  assert.ok(!files.some(f => f.json.placements?.["c-p1"]), "unreadable plan exported anyway");
});

test("flat export › an empty selection produces no files at all", () => {
  assert.equal(flatPlanFiles(docFor([])).length, 0);
});
