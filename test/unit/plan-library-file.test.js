// The multi-plan library FILE — export payload, validation, and merge.
//
// This is the one door in the app that reads a document from OUTSIDE it, so
// the tests that matter here are the hostile ones: a truncated file, a file
// from another app, ids that collide, a parent pointing at a plan, a folder
// cycle, a tree too deep to nest. Confirming that a well-formed file
// round-trips proves almost nothing by comparison.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, MAX_DEPTH } from "../../src/core/planFolders.js";
import {
  buildLibraryFile, parseLibraryFile, mergeLibrary, fileFolderDepth,
  LIBRARY_FILE_KIND, LIBRARY_FILE_VERSION,
} from "../../src/core/planLibraryFile.js";

const F = (id, name, parentId = null) => ({ id, name, parentId });
const P = (id, name, parentId = null, extra = {}) => ({ id, name, parentId, ...extra });

/** Advisees/{Fall 2026/{jane,sam}}, Templates/{blank}, loose */
function fixture() {
  return {
    folders: [F("adv", "Advisees"), F("fall", "Fall 2026", "adv"), F("tmpl", "Templates")],
    plans: [
      P("jane", "Current", "fall", { student: "Jane Doe", studentType: "undergrad" }),
      P("sam", "Baseline", "fall", { student: "Sam Ito", studentType: "graduate" }),
      P("blank", "Blank UG", "tmpl"),
      P("loose", "Scratch"),
    ],
  };
}
const snapshotOf = (id) => ({ version: 1, placements: { CS2500: "fall2026" }, _who: id });
const ids = xs => xs.map(x => x.id).sort();

// ── Export ────────────────────────────────────────────────────────────

test("export › null ids exports the entire library, structure intact", () => {
  const tree = buildTree(fixture());
  const doc = buildLibraryFile(tree, null, snapshotOf);
  assert.equal(doc.kind, LIBRARY_FILE_KIND);
  assert.equal(doc.version, LIBRARY_FILE_VERSION);
  assert.deepEqual(ids(doc.folders), ["adv", "fall", "tmpl"]);
  assert.deepEqual(ids(doc.plans), ["blank", "jane", "loose", "sam"]);
  assert.equal(doc.folders.find(f => f.id === "fall").parentId, "adv");
});

test("export › a selected FOLDER brings everything beneath it", () => {
  const tree = buildTree(fixture());
  const doc = buildLibraryFile(tree, ["adv"], snapshotOf);
  assert.deepEqual(ids(doc.folders), ["adv", "fall"]);
  assert.deepEqual(ids(doc.plans), ["jane", "sam"]);
});

test("export › a subfolder becomes ROOT in the file, not a chain of ancestors", () => {
  // Exporting "Fall 2026" must give that folder, not an empty "Advisees"
  // wrapper it merely happened to live under.
  const tree = buildTree(fixture());
  const doc = buildLibraryFile(tree, ["fall"], snapshotOf);
  assert.deepEqual(ids(doc.folders), ["fall"]);
  assert.equal(doc.folders[0].parentId, null);
  assert.deepEqual(ids(doc.plans), ["jane", "sam"]);
});

test("export › a plan whose snapshot is unreadable is DROPPED, never written as null", () => {
  const tree = buildTree(fixture());
  const doc = buildLibraryFile(tree, null, id => (id === "sam" ? null : snapshotOf(id)));
  assert.deepEqual(ids(doc.plans), ["blank", "jane", "loose"]);
  assert.ok(doc.plans.every(p => p.data && typeof p.data === "object"));
});

test("export › redact is applied to every snapshot (the privacy toggles' door)", () => {
  const tree = buildTree(fixture());
  const withGrades = id => ({ ...snapshotOf(id), grades: { CS2500: "A" } });
  const doc = buildLibraryFile(tree, null, withGrades, {
    redact: d => { const { grades, ...rest } = d; return rest; },
  });
  assert.ok(doc.plans.length > 0);
  for (const p of doc.plans) assert.equal(p.data.grades, undefined);
  assert.ok(!JSON.stringify(doc).includes('"A"'));
});

test("export › the student rides along, and an unassigned plan carries no key", () => {
  const tree = buildTree(fixture());
  const doc = buildLibraryFile(tree, null, snapshotOf);
  assert.equal(doc.plans.find(p => p.id === "jane").student, "Jane Doe");
  assert.ok(!("student" in doc.plans.find(p => p.id === "loose")));
});

// ── Parse: hostile input ──────────────────────────────────────────────

test("parse › rejects junk, other apps, and the wrong version by REASON", () => {
  assert.equal(parseLibraryFile("not json{").reason, "json");
  assert.equal(parseLibraryFile("[1,2,3]").reason, "shape");
  assert.equal(parseLibraryFile(JSON.stringify({ kind: "something-else", version: 2 })).reason, "kind");
  assert.equal(parseLibraryFile(JSON.stringify({ kind: LIBRARY_FILE_KIND, version: 99 })).reason, "version");
  // A SINGLE-plan export must not be mistaken for a library file.
  assert.equal(parseLibraryFile(JSON.stringify({ version: 1, placements: {} })).reason, "kind");
});

test("parse › rejects a file whose lists are missing, or wholly empty", () => {
  const base = { kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION };
  assert.equal(parseLibraryFile(JSON.stringify({ ...base })).reason, "shape");
  assert.equal(parseLibraryFile(JSON.stringify({ ...base, folders: [], plans: [] })).reason, "empty");
});

test("parse › rejects duplicate ids ACROSS folders and plans, not just within", () => {
  const base = { kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION };
  const dupPlans = { ...base, folders: [], plans: [
    { id: "x", name: "a", data: {} }, { id: "x", name: "b", data: {} }] };
  assert.equal(parseLibraryFile(JSON.stringify(dupPlans)).reason, "ids");
  // The subtle one: folders and plans share ONE id namespace in the tree.
  const cross = { ...base, folders: [{ id: "x", name: "f" }], plans: [{ id: "x", name: "p", data: {} }] };
  assert.equal(parseLibraryFile(JSON.stringify(cross)).reason, "ids");
});

test("parse › a plan with no usable data is rejected, not imported empty", () => {
  const base = { kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION, folders: [] };
  for (const bad of [undefined, null, "x", 3, []]) {
    const doc = { ...base, plans: [{ id: "p", name: "n", data: bad }] };
    assert.equal(parseLibraryFile(JSON.stringify(doc)).reason, "plandata", String(bad));
  }
});

test("parse › a parent naming a plan, or a stranger, reads as root", () => {
  const doc = {
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
    folders: [{ id: "f1", name: "F", parentId: "ghost" }],
    plans: [
      { id: "p1", name: "A", parentId: "p2", data: {} },   // parent is a PLAN
      { id: "p2", name: "B", parentId: "f1", data: {} },   // legitimate
    ],
  };
  const out = parseLibraryFile(JSON.stringify(doc));
  assert.ok(out.ok);
  assert.equal(out.folders[0].parentId, null, "a missing folder reads as root");
  assert.equal(out.plans.find(p => p.id === "p1").parentId, null, "a plan is never a parent");
  assert.equal(out.plans.find(p => p.id === "p2").parentId, "f1");
});

test("parse › a folder cycle in the file is re-rooted, so nothing is lost", () => {
  const doc = {
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
    folders: [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }],
    plans: [{ id: "p", name: "P", parentId: "a", data: {} }],
  };
  const out = parseLibraryFile(JSON.stringify(doc));
  assert.ok(out.ok);
  // Both ends of the cycle reach root, and the plan inside still exists.
  const tree = buildTree({ folders: out.folders, plans: out.plans });
  assert.equal(tree.byId.size, 3);
  for (const f of out.folders) assert.equal(f.parentId, null);
});

test("parse › a self-parented folder is re-rooted", () => {
  const doc = {
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
    folders: [{ id: "a", name: "A", parentId: "a" }], plans: [{ id: "p", name: "P", data: {} }],
  };
  const out = parseLibraryFile(JSON.stringify(doc));
  assert.ok(out.ok);
  assert.equal(out.folders[0].parentId, null);
});

// ── Merge ─────────────────────────────────────────────────────────────

const mint = () => { let n = 0; return () => `new${++n}`; };

test("merge › every id is re-minted, so importing twice cannot collide", () => {
  const tree = buildTree(fixture());
  const doc = parseLibraryFile(JSON.stringify(buildLibraryFile(tree, null, snapshotOf)));
  const a = mergeLibrary(doc, mint(), "Imported");
  const b = mergeLibrary(doc, (() => { let n = 100; return () => `x${++n}`; })(), "Imported");
  const aIds = new Set([...a.folders, ...a.plans].map(r => r.id));
  for (const r of [...b.folders, ...b.plans]) assert.ok(!aIds.has(r.id));
  // and no imported id survives from the file itself
  for (const r of [...a.folders, ...a.plans]) assert.ok(!["adv", "fall", "jane", "sam"].includes(r.id));
});

test("merge › structure survives re-identification", () => {
  const tree = buildTree(fixture());
  const doc = parseLibraryFile(JSON.stringify(buildLibraryFile(tree, ["adv"], snapshotOf)));
  const m = mergeLibrary(doc, mint(), "Imported");
  const built = buildTree({
    folders: [m.folder, ...m.folders], plans: m.plans,
  });
  // Advisees sits in the wrapper; Fall sits in Advisees; both plans in Fall.
  const byName = n => [...built.byId.values()].find(r => r.name === n);
  assert.equal(built.parentOf.get(byName("Advisees").id), m.folder.id);
  assert.equal(built.parentOf.get(byName("Fall 2026").id), byName("Advisees").id);
  assert.equal(built.parentOf.get(byName("Current").id), byName("Fall 2026").id);
});

test("merge › roots attach to the wrapper folder, not to the top level", () => {
  const tree = buildTree(fixture());
  const doc = parseLibraryFile(JSON.stringify(buildLibraryFile(tree, null, snapshotOf)));
  const m = mergeLibrary(doc, mint(), "Imported");
  assert.equal(m.atRoot, false);
  const loose = m.plans.find(p => p.name === "Scratch");
  assert.equal(loose.parentId, m.folder.id, "a root plan lands INSIDE the import folder");
});

test("merge › student and studentType survive the round trip", () => {
  const tree = buildTree(fixture());
  const doc = parseLibraryFile(JSON.stringify(buildLibraryFile(tree, null, snapshotOf)));
  const m = mergeLibrary(doc, mint(), "Imported");
  const jane = m.plans.find(p => p.name === "Current");
  assert.equal(jane.student, "Jane Doe");
  assert.equal(m.plans.find(p => p.name === "Baseline").studentType, "graduate");
  assert.ok(!("student" in m.plans.find(p => p.name === "Scratch")));
});

test("merge › each plan's snapshot is carried out as a slot to write", () => {
  const tree = buildTree(fixture());
  const doc = parseLibraryFile(JSON.stringify(buildLibraryFile(tree, null, snapshotOf)));
  const m = mergeLibrary(doc, mint(), "Imported");
  assert.equal(m.slots.length, m.plans.length);
  const planIds = new Set(m.plans.map(p => p.id));
  for (const s of m.slots) {
    assert.ok(planIds.has(s.id), "a slot must belong to a plan being added");
    assert.ok(s.data && typeof s.data === "object");
  }
});

// ── Depth: the case nesting cannot serve ──────────────────────────────

test("fileFolderDepth › measures the deepest chain, root folders being 0", () => {
  assert.equal(fileFolderDepth([]), -1);
  assert.equal(fileFolderDepth([F("a", "A")]), 0);
  assert.equal(fileFolderDepth([F("a", "A"), F("b", "B", "a"), F("c", "C", "b")]), 2);
});

test("merge › a file too deep to nest lands at TOP LEVEL rather than truncating", () => {
  // A chain already at the cap cannot go inside anything: nesting costs a
  // level. Keeping the structure the user asked to keep beats folding it.
  const folders = [];
  for (let i = 0; i < MAX_DEPTH; i++) folders.push(F(`f${i}`, `F${i}`, i ? `f${i - 1}` : null));
  const doc = parseLibraryFile(JSON.stringify({
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION, folders,
    plans: [{ id: "p", name: "Deep", parentId: `f${MAX_DEPTH - 1}`, data: {} }],
  }));
  const m = mergeLibrary(doc, mint(), "Imported");
  assert.equal(m.atRoot, true);
  assert.equal(m.folder, null);
  // The chain is intact and its own root is genuinely at root.
  const built = buildTree({ folders: m.folders, plans: m.plans });
  assert.equal(m.folders.filter(f => f.parentId === null).length, 1);
  assert.equal(built.depthOf.get(m.folders[MAX_DEPTH - 1].id), MAX_DEPTH - 1);
});

test("merge › a tree that still fits is nested normally", () => {
  const folders = [];
  for (let i = 0; i < MAX_DEPTH - 1; i++) folders.push(F(`f${i}`, `F${i}`, i ? `f${i - 1}` : null));
  const doc = parseLibraryFile(JSON.stringify({
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION, folders,
    plans: [{ id: "p", name: "Deep", parentId: "f0", data: {} }],
  }));
  const m = mergeLibrary(doc, mint(), "Imported");
  assert.equal(m.atRoot, false);
  const built = buildTree({ folders: [m.folder, ...m.folders], plans: m.plans });
  assert.equal(built.depthOf.get(m.folders[MAX_DEPTH - 2].id), MAX_DEPTH - 1);
});

// ── Full round trip ───────────────────────────────────────────────────

test("round trip › export → JSON → parse → merge preserves names and shape", () => {
  const state = fixture();
  const doc = buildLibraryFile(buildTree(state), null, snapshotOf);
  const parsed = parseLibraryFile(JSON.stringify(doc));
  assert.ok(parsed.ok);
  const m = mergeLibrary(parsed, mint(), "Imported 2026-08-08");
  const namesIn = [...state.folders, ...state.plans].map(r => r.name).sort();
  const namesOut = [...m.folders, ...m.plans].map(r => r.name).sort();
  assert.deepEqual(namesOut, namesIn);
  assert.equal(m.folder.name, "Imported 2026-08-08");
});
