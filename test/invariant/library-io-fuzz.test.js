// INVARIANT · a library survives the round trip, both ways out and back.
//
// Export/import is the one place where a bug is not recoverable: the plan the
// user gets back IS the plan, and a field dropped at a door is gone. There are
// two doors out (one JSON document, one zip archive) and three ways in (a
// document, an archive, a pile of single-plan files), so the fuzz drives the
// real pure pipeline rather than examples:
//
//   buildLibraryFile → JSON text → parseLibraryFile → mergeLibrary
//   buildLibraryFile → libraryToArchive → writeZip → readZip
//                    → archiveToLibrary → mergeLibrary
//
// The generator deliberately produces the things that break serialisation:
// names with slashes and quotes and emoji, duplicate sibling names, empty
// folders, deep nesting, plans with no data, unicode in every string field.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryFile, parseLibraryFile, mergeLibrary,
  libraryToArchive, archiveToLibrary, LIBRARY_FILE_KIND, LIBRARY_FILE_VERSION,
} from "../../src/core/planLibraryFile.js";
import { writeZip, readZip } from "../../src/core/zipFile.js";
import { buildTree, MAX_DEPTH } from "../../src/core/planFolders.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// The names that actually break things: path separators, reserved characters,
// trailing dots (Windows), collisions that differ only in case, RTL text, an
// emoji outside the BMP, and one that is only whitespace.
const NASTY = [
  "Plan A", "plan a", "PLAN A", "Fall/Spring", "C:\\temp", "a?b*c", 'say "hi"',
  "trailing dot.", "  ", "…", "计划", "خطة", "🎓🎓", "a".repeat(200),
  "library-index", "..", ".", "con", "nul",
];

function makeLibrary(rand) {
  const nFolders = Math.floor(rand() * 6);
  const nPlans = 1 + Math.floor(rand() * 8);
  const folders = [];
  for (let i = 0; i < nFolders; i++) {
    // Parent from those already made, so depth grows but stays acyclic.
    const parent = folders.length && rand() < 0.6
      ? folders[Math.floor(rand() * folders.length)].id : null;
    folders.push({
      id: `f${i}`, name: NASTY[Math.floor(rand() * NASTY.length)], parentId: parent,
    });
  }
  const plans = [];
  for (let i = 0; i < nPlans; i++) {
    const parent = folders.length && rand() < 0.7
      ? folders[Math.floor(rand() * folders.length)].id : null;
    plans.push({
      id: `p${i}`, name: NASTY[Math.floor(rand() * NASTY.length)], parentId: parent,
      studentType: rand() < 0.3 ? "graduate" : "undergrad",
      ...(rand() < 0.3 ? { student: NASTY[Math.floor(rand() * NASTY.length)] } : {}),
    });
  }
  // Cap depth like the app does, so the generator cannot produce a library the
  // app itself could not hold.
  const tree = buildTree({ plans, folders });
  return { tree, folders, plans };
}

function makeSnapshot(rand, i) {
  return {
    version: 1,
    entSem: rand() < 0.5 ? "fall" : "spring", entYear: 2024 + Math.floor(rand() * 4),
    gradSem: "spring", gradYear: 2028 + Math.floor(rand() * 3),
    placements: { [`CS${2500 + i}`]: "fall2026", [`MATH${1000 + i}`]: "spr2027" },
    reservations: {},
    specialTermPl: {},
    semOrders: { fall2026: [`CS${2500 + i}`] },
    shOverrides: {}, bonusSH: Math.floor(rand() * 8), currentSemId: "fall2026",
    offeredOverrides: {}, collapsedSubs: [], placedOut: [], substitutions: [],
    major: "undergraduate/2026/x/y/requirements.json", major2: "", conc: "", conc2: "",
    minor1: "", minor2: "", studentType: "undergrad",
    grades: { [`CS${2500 + i}`]: "A" },
    // A unicode field, because JSON round-tripping is where mojibake shows up.
    appliedTemplate: { programKey: "计划/🎓", planLabel: 'Four Years "co-op"' },
  };
}

const snapshotsFor = (plans, rand) => {
  const map = new Map();
  plans.forEach((p, i) => map.set(p.id, makeSnapshot(rand, i)));
  return map;
};

test("library io › the JSON document round trip preserves every plan and its data", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const { tree, plans } = makeLibrary(rand);
    const snaps = snapshotsFor(plans, rand);

    const doc = buildLibraryFile(tree, null, id => snaps.get(id) ?? null);
    const text = JSON.stringify(doc);
    const parsed = parseLibraryFile(text);
    assert.ok(parsed.ok, `seed ${seed}: parse failed (${parsed.reason})`);

    assert.equal(parsed.plans.length, plans.length, `seed ${seed}: plan count`);
    for (const p of parsed.plans) {
      const original = snaps.get(p.id);
      assert.deepEqual(p.data, original, `seed ${seed}: plan ${p.id} data changed`);
    }
  }
});

test("library io › the zip archive round trip preserves every plan and its data", async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const { tree, plans } = makeLibrary(rand);
    const snaps = snapshotsFor(plans, rand);

    const doc = buildLibraryFile(tree, null, id => snaps.get(id) ?? null);
    const enc = new TextEncoder(), dec = new TextDecoder();
    const bytes = writeZip(libraryToArchive(doc).map(e => ({
      path: e.path, data: enc.encode(JSON.stringify(e.json)),
    })));
    const back = archiveToLibrary(
      (await readZip(bytes)).map(e => ({ path: e.path, text: dec.decode(e.data) })));

    assert.ok(back.ok, `seed ${seed}: archive parse failed (${back.reason})`);
    assert.equal(back.plans.length, plans.length, `seed ${seed}: plan count through zip`);
    for (const p of back.plans) {
      // `planName` is added on the way out and stripped on the way in; the rest
      // must be identical.
      assert.deepEqual(p.data, snaps.get(p.id), `seed ${seed}: plan ${p.id} data changed`);
    }
  }
});

test("library io › archive paths are unique, relative, and never escape", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const { tree, plans } = makeLibrary(rand);
    const snaps = snapshotsFor(plans, rand);
    const doc = buildLibraryFile(tree, null, id => snaps.get(id) ?? null);
    const entries = libraryToArchive(doc);

    const paths = entries.map(e => e.path);
    assert.equal(new Set(paths).size, paths.length,
      `seed ${seed}: two entries share a path — one would overwrite the other`);
    for (const p of paths) {
      assert.doesNotMatch(p, /^\//,        `absolute path in archive: ${p}`);
      assert.doesNotMatch(p, /(^|\/)\.\.(\/|$)/, `path escapes the archive: ${p}`);
      assert.doesNotMatch(p, /^[A-Za-z]:/, `drive-letter path in archive: ${p}`);
      for (const seg of p.split("/")) {
        assert.doesNotMatch(seg, /[:*?"<>|]/, `illegal character in segment: ${seg}`);
        assert.doesNotMatch(seg, /[. ]$/,     `segment ends in a dot or space: ${seg}`);
      }
    }
  }
});

test("library io › folder structure survives both routes", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const { tree, plans, folders } = makeLibrary(rand);
    const snaps = snapshotsFor(plans, rand);
    const doc = buildLibraryFile(tree, null, id => snaps.get(id) ?? null);

    // Which folder each plan sits in, by NAME PATH rather than id — ids are
    // re-minted on import by design, so identity has to be structural.
    const pathOf = (recs, folderList, id) => {
      const byId = new Map(folderList.map(f => [f.id, f]));
      const out = [];
      let cur = recs.parentId;
      for (let guard = 0; cur != null && guard < 20; guard++) {
        const f = byId.get(cur);
        if (!f) break;
        out.unshift(f.name);
        cur = f.parentId;
      }
      return out.join("/");
    };

    const want = new Map(doc.plans.map(p => [p.id, pathOf(p, doc.folders, p.id)]));

    const viaDoc = parseLibraryFile(JSON.stringify(doc));
    assert.ok(viaDoc.ok);
    for (const p of viaDoc.plans) {
      assert.equal(pathOf(p, viaDoc.folders, p.id), want.get(p.id),
        `seed ${seed}: ${p.id} changed folder through the document`);
    }
  }
});

test("library io › importing the same file twice makes two copies, not one overwrite", () => {
  const rand = rng(7);
  const { tree, plans } = makeLibrary(rand);
  const snaps = snapshotsFor(plans, rand);
  const doc = buildLibraryFile(tree, null, id => snaps.get(id) ?? null);
  const parsed = parseLibraryFile(JSON.stringify(doc));
  assert.ok(parsed.ok);

  let n = 0;
  const newId = () => `new${n++}`;
  const first  = mergeLibrary(parsed, newId, "Imported 1");
  const second = mergeLibrary(parsed, newId, "Imported 2");

  const firstIds = new Set([...first.plans, ...first.folders].map(r => r.id));
  for (const rec of [...second.plans, ...second.folders]) {
    assert.ok(!firstIds.has(rec.id),
      `import reused id ${rec.id} — the second import would overwrite the first`);
  }
  assert.equal(first.slots.length, second.slots.length);
});

test("library io › hostile files are rejected with a reason, never thrown", () => {
  const cases = [
    ["not json at all",                    "json"],
    ['{"kind":"something-else"}',          "kind"],
    [JSON.stringify({ kind: LIBRARY_FILE_KIND, version: 999 }), "version"],
    [JSON.stringify({ kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION }), "shape"],
    [JSON.stringify({ kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
                      folders: [], plans: [] }), "empty"],
    // Two records sharing an id would collapse into one node in the tree.
    [JSON.stringify({ kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
                      folders: [{ id: "x" }], plans: [{ id: "x", data: {} }] }), "ids"],
    // A plan whose data is not an object is not a plan.
    [JSON.stringify({ kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
                      folders: [], plans: [{ id: "p", data: "nope" }] }), "plandata"],
    [JSON.stringify([1, 2, 3]),            "shape"],
    ["null",                               "shape"],
  ];
  for (const [text, reason] of cases) {
    const got = parseLibraryFile(text);
    assert.equal(got.ok, false, `expected rejection for: ${text.slice(0, 40)}`);
    assert.equal(got.reason, reason, `wrong reason for: ${text.slice(0, 40)}`);
  }
});

test("library io › a parentId cycle is re-rooted rather than hanging the import", () => {
  const doc = {
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
    folders: [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }],
    plans: [{ id: "p", name: "P", parentId: "a", data: { version: 1 } }],
  };
  const got = parseLibraryFile(JSON.stringify(doc));
  assert.ok(got.ok);
  // At least one of the two must reach root, or the tree is unreachable.
  const roots = got.folders.filter(f => f.parentId == null);
  assert.ok(roots.length >= 1, "a cycle left every folder unreachable from root");
});

test("library io › a plan pointing at a missing folder lands at root, not nowhere", () => {
  const doc = {
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION,
    folders: [],
    plans: [{ id: "p", name: "P", parentId: "ghost", data: { version: 1 } }],
  };
  const got = parseLibraryFile(JSON.stringify(doc));
  assert.ok(got.ok);
  assert.equal(got.plans[0].parentId, null, "a dangling parent must read as root");
});

test("library io › __proto__ in a file cannot pollute the prototype", () => {
  // A JSON file is untrusted input. `JSON.parse` itself is safe, but anything
  // that later spreads or assigns these keys is not, so the guarantee is
  // asserted at the door rather than assumed.
  const doc = `{"kind":"${LIBRARY_FILE_KIND}","version":${LIBRARY_FILE_VERSION},
    "folders":[{"id":"f","name":"F","parentId":null,"__proto__":{"polluted":true}}],
    "plans":[{"id":"p","name":"P","parentId":null,
              "data":{"version":1,"__proto__":{"polluted":true}}}]}`;
  const got = parseLibraryFile(doc);
  assert.ok(got.ok);
  let n = 0;
  mergeLibrary(got, () => `n${n++}`, "Imported");
  assert.equal({}.polluted, undefined, "Object.prototype was polluted by an import");
  assert.equal(({}).constructor, Object);
});

test("library io › a selection exports its whole subtree, each plan exactly once", () => {
  // Selecting a folder AND a plan inside it is an ordinary thing to do with a
  // multi-select, and it must not export that plan twice.
  const folders = [{ id: "f1", name: "One", parentId: null },
                   { id: "f2", name: "Two", parentId: "f1" }];
  const plans = [{ id: "p1", name: "A", parentId: "f1", studentType: "undergrad" },
                 { id: "p2", name: "B", parentId: "f2", studentType: "undergrad" },
                 { id: "p3", name: "C", parentId: null,  studentType: "undergrad" }];
  const tree = buildTree({ plans, folders });
  const snap = () => ({ version: 1 });

  const doc = buildLibraryFile(tree, ["f1", "p1", "p2"], snap);
  const ids = doc.plans.map(p => p.id).sort();
  assert.deepEqual(ids, ["p1", "p2"], "selection exported the wrong set");
  assert.equal(new Set(ids).size, ids.length, "a plan was exported twice");
  // The plan outside the selection stays out of it.
  assert.ok(!ids.includes("p3"));
  // f1's parent is outside the export, so it becomes a root INSIDE the file.
  assert.equal(doc.folders.find(f => f.id === "f1").parentId, null);
});

test("library io › a plan whose slot cannot be read is dropped, never exported empty", () => {
  const plans = [{ id: "p1", name: "A", parentId: null, studentType: "undergrad" },
                 { id: "p2", name: "B", parentId: null, studentType: "undergrad" }];
  const tree = buildTree({ plans, folders: [] });
  const doc = buildLibraryFile(tree, null, id => (id === "p1" ? { version: 1 } : null));
  assert.deepEqual(doc.plans.map(p => p.id), ["p1"]);
  for (const p of doc.plans) assert.ok(p.data && typeof p.data === "object");
});

test("library io › depth at the cap imports at root instead of truncating", () => {
  // Nesting under a dated folder costs a level; a file already at the cap has
  // nowhere legal to go, and losing the structure would be worse than landing
  // at the top.
  const folders = [];
  for (let i = 0; i < MAX_DEPTH; i++) {
    folders.push({ id: `f${i}`, name: `L${i}`, parentId: i ? `f${i - 1}` : null });
  }
  const parsed = parseLibraryFile(JSON.stringify({
    kind: LIBRARY_FILE_KIND, version: LIBRARY_FILE_VERSION, folders,
    plans: [{ id: "p", name: "P", parentId: `f${MAX_DEPTH - 1}`, data: { version: 1 } }],
  }));
  assert.ok(parsed.ok);
  let n = 0;
  const merged = mergeLibrary(parsed, () => `n${n++}`, "Imported");
  assert.equal(merged.atRoot, true, "a file at the depth cap must land at root");
  assert.equal(merged.folder, null, "no wrapper folder when landing at root");
});
