// UNIT · src/core/libraryBackup.js + src/data/persistence.js
//
// These two modules are the last line between a student and losing their whole
// degree plan. A plan lives only in this browser's localStorage: no account, no
// server copy, and share links/codes are transfers rather than backups. So the
// exported file IS the backup, and both of its failure modes are SILENT —
//
//   · an export that quietly omits a plan (the user finds out at restore time,
//     when it is already too late to go back and get it);
//   · a restore that overwrites a plan that is still live (the recovery tool
//     destroying the thing it was run to protect).
//
// Neither is visible by using the app, so they are tested here rather than
// trusted. The tests are deliberately hostile: malformed bundles, prototype
// pollution, id collisions, dangling folder parents, and a store that refuses
// every write.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLibraryBundle, parseLibraryBundle,
  LIBRARY_BUNDLE_KIND, LIBRARY_BUNDLE_VERSION,
} from "../../src/core/libraryBackup.js";
import { classifyStorageError, writeKey, saveState, storageKey } from "../../src/data/persistence.js";

// ── Helpers ──────────────────────────────────────────────────────────
const PLANS = [
  { id: "default", name: "Plan A", parentId: null, studentType: "undergrad" },
  { id: "p2", name: "Plan B", parentId: "f1", studentType: "graduate" },
  { id: "p3", name: "Plan C", parentId: "f1" },
];
const FOLDERS = [
  { id: "f1", name: "Drafts", parentId: null },
  { id: "f2", name: "Nested", parentId: "f1" },
];
const slots = {
  default: { placements: { fall2026: ["CS 2500"] }, grades: { "CS 2500": "A" } },
  p2:      { placements: {}, major: "CS", specialTermPl: { s1: { company: "Acme" } } },
  p3:      { placements: { spring2027: ["MATH 1341"] } },
};
const readAll = (id) => slots[id] ?? null;

const roundTrip = (bundle, opts) => parseLibraryBundle(JSON.parse(JSON.stringify(bundle)), opts);

// ── buildLibraryBundle ───────────────────────────────────────────────

test("backup › a bundle carries every plan, its data, and the folder tree", () => {
  const { bundle, skipped } = buildLibraryBundle({
    plans: PLANS, folders: FOLDERS, activePlanId: "default",
    readSlot: readAll, exportedAt: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(bundle.kind, LIBRARY_BUNDLE_KIND);
  assert.equal(bundle.version, LIBRARY_BUNDLE_VERSION);
  assert.equal(bundle.plans.length, 3);
  assert.equal(bundle.folders.length, 2);
  assert.deepEqual(skipped, []);
  // The whole point of the file: the actual plan CONTENT has to be in it.
  assert.deepEqual(bundle.plans[0].data.placements, { fall2026: ["CS 2500"] });
  // Folder membership rides on the index, so it must be preserved per entry.
  assert.equal(bundle.plans[1].parentId, "f1");
  assert.equal(bundle.plans[1].studentType, "graduate");
  // A missing studentType defaults rather than travelling as undefined.
  assert.equal(bundle.plans[2].studentType, "undergrad");
});

test("backup › a plan with an unreadable slot is REPORTED, never silently dropped", () => {
  // This is the quota-truncated-slot case. A backup that omits it without
  // saying so claims a completeness it does not have.
  const { bundle, skipped } = buildLibraryBundle({
    plans: PLANS, folders: FOLDERS,
    readSlot: (id) => (id === "p2" ? null : readAll(id)),
  });
  assert.equal(bundle.plans.length, 2);
  assert.deepEqual(skipped, [{ id: "p2", name: "Plan B" }]);
  assert.deepEqual(bundle.skipped, skipped, "the file itself must record the omission");
});

test("backup › privateGrades strips grades from EVERY plan, not just the open one", () => {
  const withGrades = {
    ...slots,
    p2: { ...slots.p2, grades: { "CS 3000": "B" } },
  };
  const { bundle } = buildLibraryBundle({
    plans: PLANS, folders: FOLDERS, privateGrades: true,
    readSlot: (id) => withGrades[id] ?? null,
  });
  for (const e of bundle.plans) {
    assert.ok(!("grades" in e.data), `${e.id} still carries grades`);
  }
});

test("backup › redaction does NOT mutate the caller's live plan object", () => {
  // Exporting must never edit the running app's state. Redacting in place would
  // delete the user's own grades out from under them as a side effect of
  // pressing an Export button.
  const live = { placements: {}, grades: { "CS 2500": "A" }, specialTermPl: { s1: { company: "Acme" } } };
  buildLibraryBundle({
    plans: [{ id: "x", name: "X" }],
    privateGrades: true, privateCoop: true,
    redactCoop: () => ({ s1: {} }),
    readSlot: () => live,
  });
  assert.deepEqual(live.grades, { "CS 2500": "A" }, "grades were deleted from live state");
  assert.deepEqual(live.specialTermPl, { s1: { company: "Acme" } }, "co-op detail was redacted in live state");
});

test("backup › an empty library still produces a valid, parseable file", () => {
  const { bundle } = buildLibraryBundle({ plans: [], folders: [], readSlot: () => null });
  assert.equal(bundle.kind, LIBRARY_BUNDLE_KIND);
  assert.deepEqual(bundle.plans, []);
  // It is not restorable, but it must be RECOGNISED — reported as empty rather
  // than as a corrupt file, which would send the user hunting for the wrong bug.
  assert.deepEqual(parseLibraryBundle(bundle), { ok: false, reason: "empty" });
});

// ── parseLibraryBundle: the safety property ──────────────────────────

test("backup › restore REMAPS every id, so it can never overwrite a live plan", () => {
  // The property that makes restore non-destructive. If ids came back verbatim,
  // restoring into a browser that still holds "default" would clobber it.
  const { bundle } = buildLibraryBundle({
    plans: PLANS, folders: FOLDERS, readSlot: readAll,
  });
  const r = roundTrip(bundle, { stamp: 111 });
  assert.ok(r.ok);
  const ids = r.plans.map(p => p.id);
  for (const original of ["default", "p2", "p3"]) {
    assert.ok(!ids.includes(original), `id ${original} survived the restore verbatim`);
  }
  for (const f of r.folders) {
    assert.ok(!["f1", "f2"].includes(f.id), `folder id ${f.id} survived verbatim`);
  }
  assert.equal(new Set(ids).size, 3, "remapped ids must stay distinct");
});

test("backup › the folder tree survives remapping, parents included", () => {
  const { bundle } = buildLibraryBundle({ plans: PLANS, folders: FOLDERS, readSlot: readAll });
  const r = roundTrip(bundle, { stamp: 222 });
  const byName = Object.fromEntries(r.folders.map(f => [f.name, f]));
  assert.equal(byName.Drafts.parentId, null);
  // "Nested" was inside "Drafts" — the relationship has to be re-pointed at the
  // NEW Drafts id, not left pointing at the old one.
  assert.equal(byName.Nested.parentId, byName.Drafts.id);
  // Plans keep their folder too.
  const inDrafts = r.plans.filter(p => p.parentId === byName.Drafts.id);
  assert.equal(inDrafts.length, 2, "Plan B and Plan C should both land back in Drafts");
});

test("backup › a folder parent that isn't in the bundle becomes null, not dangling", () => {
  // A dangling parentId would make the row invisible in the tree — the plan
  // would be "restored" and yet nowhere the user can see it, which is
  // indistinguishable from the restore having failed.
  const r = parseLibraryBundle({
    kind: LIBRARY_BUNDLE_KIND, version: 1,
    folders: [{ id: "f1", name: "Orphan", parentId: "ghost" }],
    plans: [{ id: "p1", name: "P", parentId: "alsoGhost", data: { placements: {} } }],
  }, { stamp: 333 });
  assert.ok(r.ok);
  assert.equal(r.folders[0].parentId, null);
  assert.equal(r.plans[0].parentId, null);
});

// ── parseLibraryBundle: hostile input ────────────────────────────────

test("backup › junk and near-miss inputs are refused, not half-applied", () => {
  const cases = [
    [null, "not-a-bundle"],
    [undefined, "not-a-bundle"],
    ["a string", "not-a-bundle"],
    [42, "not-a-bundle"],
    [[], "not-a-bundle"],
    [{}, "not-a-bundle"],
    // A single-plan export. It has version:1 and looks plausible, which is
    // exactly why the discriminator exists — without it this would restore as
    // one plan whose data is a `plans` array.
    [{ version: 1, placements: {} }, "not-a-bundle"],
    // Right marker, missing body.
    [{ kind: LIBRARY_BUNDLE_KIND }, "not-a-bundle"],
    [{ kind: LIBRARY_BUNDLE_KIND, plans: "nope" }, "not-a-bundle"],
    // Right shape, nothing restorable in it.
    [{ kind: LIBRARY_BUNDLE_KIND, plans: [] }, "empty"],
    [{ kind: LIBRARY_BUNDLE_KIND, plans: [null, 7, "x", {}, { data: null }] }, "empty"],
  ];
  for (const [input, reason] of cases) {
    const r = parseLibraryBundle(input);
    assert.equal(r.ok, false, `${JSON.stringify(input)} should be refused`);
    assert.equal(r.reason, reason, `${JSON.stringify(input)} → wrong reason`);
  }
});

test("backup › a partly-corrupt bundle restores what it can and counts the rest", () => {
  // Degrade to less information, never to wrong information: nine good plans
  // must not be thrown away because one entry is broken.
  const r = parseLibraryBundle({
    kind: LIBRARY_BUNDLE_KIND, version: 1, folders: [],
    plans: [
      { id: "a", name: "Good", data: { placements: {} } },
      { id: "b", name: "Broken", data: null },
      null,
      { id: "c", name: "AlsoGood", data: { placements: {} } },
    ],
  }, { stamp: 444 });
  assert.ok(r.ok);
  assert.equal(r.plans.length, 2);
  assert.equal(r.failed, 2);
  assert.deepEqual(r.plans.map(p => p.name), ["Good", "AlsoGood"]);
});

test("backup › a blank or whitespace name falls back instead of restoring a nameless row", () => {
  const r = parseLibraryBundle({
    kind: LIBRARY_BUNDLE_KIND, version: 1,
    plans: [
      { id: "a", name: "", data: { placements: {} } },
      { id: "b", name: "   ", data: { placements: {} } },
      { id: "c", data: { placements: {} } },
      { id: "d", name: 99, data: { placements: {} } },
    ],
  }, { stamp: 555, fallbackName: "My Plan" });
  assert.ok(r.ok);
  assert.deepEqual(r.plans.map(p => p.name), ["My Plan", "My Plan", "My Plan", "My Plan"]);
});

test("backup › duplicate ids in one bundle stay distinct after remapping", () => {
  // A hand-edited or concatenated file can repeat an id. Remapping by INDEX
  // rather than by source id is what keeps these from collapsing into one plan
  // and silently losing the other.
  const r = parseLibraryBundle({
    kind: LIBRARY_BUNDLE_KIND, version: 1,
    plans: [
      { id: "same", name: "First", data: { placements: { a: ["X"] } } },
      { id: "same", name: "Second", data: { placements: { b: ["Y"] } } },
    ],
  }, { stamp: 666 });
  assert.ok(r.ok);
  assert.equal(r.plans.length, 2);
  assert.notEqual(r.plans[0].id, r.plans[1].id);
  assert.deepEqual(r.plans[1].data.placements, { b: ["Y"] });
});

test("backup › a __proto__ key in the file cannot pollute Object.prototype", () => {
  // JSON.parse does not honour __proto__ as a setter, but the bundle is walked
  // and re-emitted, so this pins the behaviour rather than assuming it.
  const raw = JSON.parse(`{
    "kind": ${JSON.stringify(LIBRARY_BUNDLE_KIND)},
    "version": 1,
    "plans": [{ "id": "a", "name": "P", "data": { "placements": {} } }],
    "folders": [{ "id": "f", "name": "F", "parentId": null }],
    "__proto__": { "polluted": true }
  }`);
  const r = parseLibraryBundle(raw, { stamp: 777 });
  assert.ok(r.ok);
  assert.equal({}.polluted, undefined, "Object.prototype was polluted");
  assert.equal(r.plans[0].polluted, undefined);
});

test("backup › a full export→restore round trip preserves plan content exactly", () => {
  const { bundle } = buildLibraryBundle({
    plans: PLANS, folders: FOLDERS, activePlanId: "default", readSlot: readAll,
  });
  const r = roundTrip(bundle, { stamp: 888 });
  assert.ok(r.ok);
  const byName = Object.fromEntries(r.plans.map(p => [p.name, p]));
  assert.deepEqual(byName["Plan A"].data.placements, { fall2026: ["CS 2500"] });
  // Grades are the most sensitive thing here and were historically dropped at
  // one door or another. A local file backup is the one door that keeps them.
  assert.deepEqual(byName["Plan A"].data.grades, { "CS 2500": "A" });
  assert.deepEqual(byName["Plan C"].data.placements, { spring2027: ["MATH 1341"] });
  assert.equal(byName["Plan B"].studentType, "graduate");
});

// ── persistence: the failure had to become observable ────────────────

test("persistence › a quota error is told apart from storage being unavailable", () => {
  // The two need different advice: a full store can be fixed by deleting plans,
  // an unavailable one never saved anything and only a file will help.
  const quota = new Error("full"); quota.name = "QuotaExceededError";
  const firefox = new Error("full"); firefox.name = "NS_ERROR_DOM_QUOTA_REACHED";
  const legacy = Object.assign(new Error("full"), { name: "Whatever", code: 22 });
  const blocked = new Error("denied"); blocked.name = "SecurityError";

  assert.equal(classifyStorageError(quota), "quota");
  assert.equal(classifyStorageError(firefox), "quota");
  assert.equal(classifyStorageError(legacy), "quota");
  assert.equal(classifyStorageError(blocked), "unavailable");
  // Must not throw on junk — it runs inside a catch block.
  assert.equal(classifyStorageError(null), "unavailable");
  assert.equal(classifyStorageError(undefined), "unavailable");
  assert.equal(classifyStorageError("string"), "unavailable");
});

test("persistence › writeKey reports failure instead of swallowing it", () => {
  const original = globalThis.localStorage;
  try {
    const store = new Map();
    globalThis.localStorage = {
      setItem: (k, v) => {
        if (k.includes("boom")) {
          const e = new Error("full"); e.name = "QuotaExceededError"; throw e;
        }
        store.set(k, v);
      },
      getItem: (k) => store.get(k) ?? null,
      removeItem: (k) => store.delete(k),
    };

    assert.deepEqual(writeKey("ok", "1"), { ok: true });
    assert.equal(store.get("ok"), "1");

    const bad = writeKey("boom", "1");
    assert.equal(bad.ok, false);
    assert.equal(bad.kind, "quota", "a full store must be reported as such");
    assert.ok(bad.error, "the original error is kept for diagnosis");

    // saveState is the state-v2 door and must pass the verdict through — this
    // was a bare `catch {}`, so a full store looked exactly like a healthy one.
    const good = saveState("ncp", true, { placements: {} });
    assert.equal(good.ok, true);
    assert.ok(store.get(storageKey("ncp")), "a successful save must actually write");
    assert.match(store.get(storageKey("ncp")), /"persist":true/);

    // persist=false writes the opt-out marker rather than the plan.
    saveState("ncp", false, { placements: { fall2026: ["CS 2500"] } });
    assert.equal(store.get(storageKey("ncp")), '{"persist":false}');
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test("persistence › a store that throws on EVERY write never throws to the caller", () => {
  // Recovery is unchanged: reporting the failure must not turn a failed mirror
  // write into a crashed render.
  const original = globalThis.localStorage;
  try {
    globalThis.localStorage = {
      setItem: () => { throw new Error("nope"); },
      getItem: () => null,
      removeItem: () => {},
    };
    assert.doesNotThrow(() => {
      const r = writeKey("k", "v");
      assert.equal(r.ok, false);
      assert.equal(r.kind, "unavailable");
    });
    assert.doesNotThrow(() => {
      assert.equal(saveState("ncp", true, {}).ok, false);
    });
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});
