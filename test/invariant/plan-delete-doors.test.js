// INVARIANT · a plan is erased in exactly one place, and sort modes are
// single-sourced.
//
// Both of these are drift bugs: the code was correct when written, and a
// SECOND copy of the same decision was added later that disagreed.
//
// 1. DELETING. `deleteNodes` deliberately leaves a plan's `plan-data-<id>`
//    slot in place and tombstones it into `plan-trash`, which is the whole
//    reason ⌘Z can put a deleted plan back and why the 30-day TTL sweep is
//    the only thing that ever reclaims the storage. Two other functions —
//    `deletePlan` and `bulkDeletePlans` — called `removeItem` on the slot
//    immediately, and they were what the header dropdown and the MCP
//    `DELETE_PLAN` action used. So the same plan was recoverable for 30 days
//    when deleted in the library and unrecoverable when deleted from the
//    header. Worse, neither pushed folder history, so an OLDER history entry
//    still listed the plan: one ⌘Z in the library restored the index record
//    while its slot was already erased, and the plan reopened EMPTY. That is
//    silent data loss produced by an undo button.
//
//    A behavioural test cannot catch the next such function, because the bug
//    is the existence of a second door, not the behaviour of any one of them.
//    So this checks the shape: a plan slot may be removed in exactly ONE
//    place, and that place must be the trash sweep.
//
// 2. SORTING. The library's Sort menu, `comparators` in core, and the
//    localStorage allowlist in PlannerContext were three separate literals
//    naming the same set. `'student'` was in two of them and missing from the
//    allowlist, so an advisor could choose it, use it, and lose it on reload —
//    silently, back to 'name'. They are now one exported array; these tests
//    stop the copies coming back and stop a mode being listed without being
//    implemented.
//
// Reads source text for the structural half: the invariant is about the
// code's shape, and the invariant CI job runs with no npm install, so no
// parser is available.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTree, flattenTree, SORT_MODES } from "../../src/core/planFolders.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const CONTEXT = read("src/context/PlannerContext.jsx");
const LIBRARY = read("src/ui/PlanLibrary.jsx");
const FOLDERS = read("src/core/planFolders.js");

// ── 1. One door out ───────────────────────────────────────────────────

test("plan deletion › a plan slot is erased in exactly one place", () => {
  const hits = [...CONTEXT.matchAll(/removeItem\([^)]*plan-data-/g)];
  assert.equal(
    hits.length, 1,
    `expected exactly one place to erase a plan slot, found ${hits.length}. ` +
    "A second one means a delete door that skips the tombstone, so ⌘Z can " +
    "restore an index record whose data is already gone."
  );
});

test("plan deletion › the one erase is the expiry sweep, not a delete path", () => {
  const i = CONTEXT.search(/removeItem\([^)]*plan-data-/);
  assert.notEqual(i, -1, "no plan-slot erase found at all — this test needs updating");
  // The sweep is the only legitimate caller, and it is guarded by TRASH_TTL_MS.
  const before = CONTEXT.slice(Math.max(0, i - 900), i);
  assert.match(
    before, /TRASH_TTL_MS/,
    "the only place a plan slot may be erased is the trash TTL sweep; this " +
    "call is not inside it, so it is deleting data that undo still promises."
  );
});

test("plan deletion › no resurrected hard-delete helpers", () => {
  for (const [file, src] of [["PlannerContext.jsx", CONTEXT], ["PlanLibrary.jsx", LIBRARY]]) {
    // Definitions only — prose in comments about the removed functions is fine.
    assert.doesNotMatch(
      src, /(?:const|function)\s+(?:deletePlan|bulkDeletePlans)\b/,
      `${file} defines deletePlan/bulkDeletePlans again. Deletion goes through ` +
      "deleteNodes, which tombstones and pushes folder history."
    );
  }
});

// ── 1b. Minted plan ids cannot collide ────────────────────────────────

test("plan ids › are not minted from the clock alone", () => {
  // `plan_${Date.now()}` was safe only while plans were created one gesture
  // at a time. Duplicating a SELECTION runs synchronously, so every copy was
  // minted inside the same millisecond and got the same id — measured, 5 of
  // 5 identical. The second copy then overwrote the first's slot and the
  // index carried duplicate ids, which buildTree collapses into one node.
  //
  // Checked structurally because the failure is a race: a behavioural test
  // would have to lose it on purpose to see it.
  const mint = CONTEXT.match(/const newPlanId = [^\n]*/)?.[0];
  assert.ok(mint, "newPlanId is gone — plan ids are being minted somewhere else");
  assert.match(mint, /planIdSeq/,
    "newPlanId must mix in a monotonic counter; the clock alone repeats within a tick");

  // And nothing may go back to minting them raw.
  const raw = [...CONTEXT.matchAll(/(?:const|let)\s+\w*[Ii]d\w*\s*=\s*`plan_\$\{Date\.now\(\)\}`/g)];
  assert.deepEqual(raw.map(m => m[0]), [],
    "a plan id is being minted from Date.now() again — duplicates in one tick will collide");
});

test("plan ids › a synchronous burst of mints is unique", () => {
  // The shape of the real minter, exercised the way doDuplicate exercises it.
  let seq = 0;
  const newPlanId = () => `plan_${Date.now().toString(36)}${(seq++).toString(36)}`;
  const ids = Array.from({ length: 500 }, newPlanId);
  assert.equal(new Set(ids).size, ids.length, "ids collided within one tick");
});

// ── 2. One list of sort modes ─────────────────────────────────────────

test("sort modes › SORT_MODES is defined once, in core", () => {
  assert.match(FOLDERS, /export const SORT_MODES\s*=/, "core must own the list");
  for (const [file, src] of [["PlannerContext.jsx", CONTEXT], ["PlanLibrary.jsx", LIBRARY]]) {
    assert.doesNotMatch(
      src, /(?:const|let|var)\s+SORT_MODES\s*=/,
      `${file} redefines SORT_MODES instead of importing it — that is exactly ` +
      "how 'student' ended up implemented, offered, and unpersistable."
    );
    assert.match(src, /\bSORT_MODES\b/, `${file} should import SORT_MODES from core`);
  }
});

test("sort modes › the persistence allowlist accepts every offered mode", () => {
  // PlannerContext validates the stored value with SORT_MODES.includes(...).
  assert.match(
    CONTEXT, /SORT_MODES\.includes\(/,
    "PlannerContext must validate the persisted folder-sort against SORT_MODES"
  );
});

test("sort modes › every mode has a locale key in all 8 locales", () => {
  const locales = ["en", "ar", "es", "fr", "hi", "ja", "ko", "zh"];
  for (const loc of locales) {
    const src = read(`src/locales/${loc}.js`);
    for (const mode of SORT_MODES) {
      assert.match(
        src, new RegExp(`"folders\\.sort\\.${mode}"`),
        `${loc}.js is missing "folders.sort.${mode}" — the Sort menu renders ` +
        "the raw key when a translation is absent."
      );
    }
  }
});

// A fixture where every mode has something distinct to say: names that sort
// against recency, an explicit manual order, and two advisees.
const FIXTURE = {
  folders: [],
  plans: [
    { id: "a", name: "Delta", lastOpened: 4, order: 3072, student: "Zoe"  },
    { id: "b", name: "Alpha", lastOpened: 1, order: 4096, student: "Adam" },
    { id: "c", name: "Charlie", lastOpened: 3, order: 1024 },
    { id: "d", name: "Bravo", lastOpened: 2, order: 2048, student: "Adam" },
  ],
};

test("sort modes › every listed mode is actually implemented", () => {
  const tree = buildTree(FIXTURE);
  const orderOf = (mode) =>
    flattenTree(tree, { sortMode: mode, locale: "en" }).map(r => r.id).join(",");

  const byName = orderOf("name");
  assert.equal(byName, "b,d,c,a", "name order is the baseline this test compares against");

  for (const mode of SORT_MODES) {
    const got = orderOf(mode);
    assert.equal(
      got.split(",").sort().join(","), "a,b,c,d",
      `sortMode '${mode}' dropped or duplicated a plan`
    );
    if (mode === "name") continue;
    // The real check: an unimplemented mode falls through `comparators` to the
    // name comparator and is indistinguishable from 'name'. Each other mode is
    // built here to disagree with it, so equality means "not implemented".
    assert.notEqual(
      got, byName,
      `sortMode '${mode}' produced exactly the name ordering — it is listed in ` +
      "SORT_MODES but not handled by comparators(), so it silently does nothing."
    );
  }
});

test("sort modes › an unknown mode degrades to name rather than throwing", () => {
  const tree = buildTree(FIXTURE);
  const rows = flattenTree(tree, { sortMode: "no-such-mode", locale: "en" });
  assert.equal(rows.map(r => r.id).join(","), "b,d,c,a");
});
