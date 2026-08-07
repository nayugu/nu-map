// UNIT · src/core/planFolders.js — the saved-plan folder tree.
//
// Folder bugs are DATA bugs: a mis-parented record, a move that swallows a
// subtree, a search that can't see into a collapsed folder. All of it is
// reachable without a DOM, so all of it is pinned here rather than discovered
// by an advisor whose 40 plans went missing.
//
// The invariants worth naming, because each one is a way to lose data:
//   · every record renders exactly once, even when the pointers are corrupt
//     (missing parent, or a cycle where both parents exist);
//   · a move never makes a folder its own descendant;
//   · a mixed selection never moves or deletes a node twice;
//   · search reads records, not rows, so collapse state cannot hide a match;
//   · manual order is stated on the record, never inferred from array position,
//     and a library with no `order` at all sorts exactly as it did before.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DEPTH, buildTree, flattenTree, isDescendant, subtreeOf, folderSpan,
  childDepth, topmostNodes, deleteScope, planMove, applyMove, uniqueName,
  siblingNames, folderPath, buildSearchIndex, matchIds, searchScope,
  moveTargets, normalizeSearchText, orderBetween, reseedOrder,
} from "../../src/core/planFolders.js";

const F = (id, name, parentId = null) => ({ id, name, parentId });
const P = (id, name, parentId = null, extra = {}) => ({ id, name, parentId, ...extra });
const EN = { locale: "en" };

/** Advisees/{Fall 2026/{jane,sam}, Spring 2027/{}}, Templates/{tmpl}, loose */
function fixture() {
  return {
    folders: [
      F("adv", "Advisees"),
      F("fall", "Fall 2026", "adv"),
      F("spr", "Spring 2027", "adv"),
      F("tmpl", "Templates"),
    ],
    plans: [
      P("jane", "Jane Doe", "fall"),
      P("sam", "Sam Ito", "fall"),
      P("blank", "Blank UG", "tmpl"),
      P("loose", "Scratch"),
    ],
  };
}

const ids = rows => rows.map(r => r.id);
const allOpen = st => new Set(st.folders.map(f => f.id));

// ── buildTree: structure and repair ───────────────────────────────────

test("buildTree › buckets each record under its parent, absent parentId at root", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(tree.childrenOf.get(null).folders.map(f => f.id), ["adv", "tmpl"]);
  assert.deepEqual(tree.childrenOf.get(null).plans.map(p => p.id), ["loose"]);
  assert.deepEqual(tree.childrenOf.get("fall").plans.map(p => p.id), ["jane", "sam"]);
  assert.equal(tree.parentOf.get("jane"), "fall");
  assert.equal(tree.parentOf.get("loose"), null);
});

test("buildTree › depth is 0 for root folders and increments per level", () => {
  const tree = buildTree(fixture());
  assert.equal(tree.depthOf.get("adv"), 0);
  assert.equal(tree.depthOf.get("fall"), 1);
});

test("buildTree › counts are SUBTREE totals, plus a direct-child count", () => {
  const tree = buildTree(fixture());
  // Advisees holds no plans directly but 2 in its subtree, and 2 subfolders.
  assert.deepEqual(tree.counts.get("adv"), { plans: 2, folders: 2, direct: 2 });
  assert.deepEqual(tree.counts.get("fall"), { plans: 2, folders: 0, direct: 2 });
  assert.deepEqual(tree.counts.get("spr"), { plans: 0, folders: 0, direct: 0 });
});

test("buildTree › a parentId naming a deleted folder reads as root, not lost", () => {
  const tree = buildTree({ folders: [], plans: [P("p1", "Orphan", "ghost")] });
  assert.equal(tree.parentOf.get("p1"), null);
  assert.deepEqual(ids(flattenTree(tree, EN)), ["p1"]);
});

test("buildTree › a folder cycle is re-rooted so nothing beneath it vanishes", () => {
  // A→B→A: both parents EXIST, so an existence check sees nothing wrong, yet
  // neither folder is reachable from root. Without repair the folders and the
  // plan inside them would render nowhere while still occupying storage.
  const state = {
    folders: [F("a", "A", "b"), F("b", "B", "a")],
    plans: [P("p", "Inside A", "a")],
  };
  const tree = buildTree(state);
  assert.equal(tree.parentOf.get("a"), null);
  assert.equal(tree.parentOf.get("b"), null);
  const rows = flattenTree(tree, { open: allOpen(state), ...EN });
  assert.deepEqual(ids(rows).sort(), ["a", "b", "p"]);
  // The plan keeps its (now root-level) parent rather than being orphaned too.
  assert.equal(rows.find(r => r.id === "p").depth, 1);
});

test("buildTree › a self-parented folder is re-rooted", () => {
  const tree = buildTree({ folders: [F("x", "X", "x")], plans: [] });
  assert.equal(tree.parentOf.get("x"), null);
  assert.deepEqual(ids(flattenTree(tree, EN)), ["x"]);
});

test("buildTree › every record appears exactly once even with corrupt pointers", () => {
  const state = {
    folders: [F("a", "A", "b"), F("b", "B", "a"), F("c", "C", "gone"), F("d", "D")],
    plans: [P("p1", "P1", "a"), P("p2", "P2", "nope"), P("p3", "P3", "d")],
  };
  const rows = flattenTree(buildTree(state), { open: allOpen(state), ...EN });
  assert.deepEqual(ids(rows).sort(), ["a", "b", "c", "d", "p1", "p2", "p3"]);
  assert.equal(new Set(ids(rows)).size, rows.length, "no record rendered twice");
});

// ── flattenTree: order and expansion ──────────────────────────────────

test("flattenTree › folders precede plans at every level", () => {
  const state = {
    folders: [F("z", "Zebra folder")],
    plans: [P("a", "Aardvark plan")],
  };
  assert.deepEqual(ids(flattenTree(buildTree(state), EN)), ["z", "a"]);
});

test("flattenTree › collapsed folders contribute no descendant rows", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(ids(flattenTree(tree, EN)), ["adv", "tmpl", "loose"]);
  const rows = flattenTree(tree, { open: new Set(["adv"]), ...EN });
  assert.deepEqual(ids(rows), ["adv", "fall", "spr", "tmpl", "loose"]);
  // fall is open:false, so jane/sam stay hidden one level down.
  assert.equal(rows.find(r => r.id === "fall").open, false);
});

test("flattenTree › depth reflects nesting level for indentation", () => {
  const state = fixture();
  const rows = flattenTree(buildTree(state), { open: allOpen(state), ...EN });
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.adv.depth, 0);
  assert.equal(byId.fall.depth, 1);
  assert.equal(byId.jane.depth, 2);
  assert.equal(byId.loose.depth, 0);
});

test("flattenTree › natural sort keeps default plan names in creation order", () => {
  // The reason the default sort is safe to ship: Plan 1 … Plan 10 collate the
  // way they were created, so existing users see no reordering.
  const plans = ["Plan 10", "Plan 2", "Plan 1"].map((n, i) => P(`p${i}`, n));
  const rows = flattenTree(buildTree({ plans, folders: [] }), EN);
  assert.deepEqual(rows.map(r => r.item.name), ["Plan 1", "Plan 2", "Plan 10"]);
});

test("flattenTree › sortMode 'recent' orders plans by lastOpened, folders by name", () => {
  const state = {
    folders: [F("z", "Zed"), F("a", "Alpha")],
    plans: [P("old", "Old", null, { lastOpened: 100 }), P("new", "New", null, { lastOpened: 900 })],
  };
  const rows = flattenTree(buildTree(state), { sortMode: "recent", ...EN });
  assert.deepEqual(ids(rows), ["a", "z", "new", "old"]);
});

test("flattenTree › hasChildren is direct membership, so an empty folder has no twisty", () => {
  const state = { folders: [F("outer", "Outer"), F("inner", "Inner", "outer")], plans: [] };
  const rows = flattenTree(buildTree(state), { open: allOpen(state), ...EN });
  assert.equal(rows.find(r => r.id === "outer").hasChildren, true);
  assert.equal(rows.find(r => r.id === "inner").hasChildren, false);
});

// ── ancestry helpers ──────────────────────────────────────────────────

test("isDescendant › walks up transitively and counts the node itself", () => {
  const tree = buildTree(fixture());
  assert.equal(isDescendant(tree, "jane", "adv"), true);
  assert.equal(isDescendant(tree, "fall", "fall"), true);
  assert.equal(isDescendant(tree, "adv", "fall"), false);
  assert.equal(isDescendant(tree, "jane", null), false);
});

test("folderPath › inclusive slash path; root is empty", () => {
  const tree = buildTree(fixture());
  assert.equal(folderPath(tree, "fall"), "Advisees/Fall 2026");
  assert.equal(folderPath(tree, null), "");
});

test("subtreeOf › collects descendants at every depth, excluding the folder", () => {
  const tree = buildTree(fixture());
  const sub = subtreeOf(tree, "adv");
  assert.deepEqual(sub.folderIds.sort(), ["fall", "spr"]);
  assert.deepEqual(sub.planIds.sort(), ["jane", "sam"]);
});

test("folderSpan › counts FOLDER levels below a node; plans are leaves", () => {
  const tree = buildTree(fixture());
  assert.equal(folderSpan(tree, "jane"), 0, "a plan is never a folder level");
  assert.equal(folderSpan(tree, "fall"), 0, "holds plans only");
  assert.equal(folderSpan(tree, "adv"), 1, "one level of subfolders");
  assert.equal(folderSpan(tree, "spr"), 0);
});

// ── selection normalization ───────────────────────────────────────────

test("topmostNodes › drops any node whose ancestor is also selected", () => {
  const tree = buildTree(fixture());
  // Selecting a folder AND a plan inside it must move the plan once, as part
  // of the folder — not twice, landing somewhere nobody chose.
  assert.deepEqual(topmostNodes(tree, ["adv", "jane"]), ["adv"]);
  assert.deepEqual(topmostNodes(tree, ["adv", "fall", "jane", "loose"]).sort(), ["adv", "loose"]);
  assert.deepEqual(topmostNodes(tree, ["jane", "sam"]).sort(), ["jane", "sam"]);
});

test("deleteScope › deduplicates overlapping subtrees", () => {
  const tree = buildTree(fixture());
  const scope = deleteScope(tree, ["adv", "fall", "jane"]);
  assert.deepEqual(scope.folderIds.sort(), ["adv", "fall", "spr"]);
  assert.deepEqual(scope.planIds.sort(), ["jane", "sam"]);
});

test("deleteScope › a bare plan selection touches no folders", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(deleteScope(tree, ["loose"]), { folderIds: [], planIds: ["loose"] });
});

// ── moving ────────────────────────────────────────────────────────────

test("planMove › refuses a folder into its own descendant", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(planMove(tree, ["adv"], "fall"), { ok: false, reason: "cycle" });
});

test("planMove › refuses a folder into itself", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(planMove(tree, ["adv"], "adv"), { ok: false, reason: "self" });
});

test("planMove › a move into the folder something already sits in is a no-op", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(planMove(tree, ["jane"], "fall"), { ok: false, reason: "noop" });
  assert.deepEqual(planMove(tree, ["loose"], null), { ok: false, reason: "noop" });
});

test("planMove › normalizes the selection before validating", () => {
  const tree = buildTree(fixture());
  const res = planMove(tree, ["adv", "jane"], "tmpl");
  assert.equal(res.ok, true);
  assert.deepEqual(res.moving, ["adv"]);
});

test("planMove › the depth cap constrains folders only, never where a plan is filed", () => {
  // A chain of folders at depths 0…MAX_DEPTH-1, i.e. already at the cap.
  const folders = [];
  for (let i = 0; i < MAX_DEPTH; i++) folders.push(F(`f${i}`, `F${i}`, i === 0 ? null : `f${i - 1}`));
  const deepest = `f${MAX_DEPTH - 1}`;
  const state = {
    folders: [...folders, F("box", "Box"), F("boxIn", "Inner", "box"), F("solo", "Solo")],
    plans: [P("free", "Free"), P("inBox", "In box", "boxIn")],
  };
  const tree = buildTree(state);
  assert.equal(tree.depthOf.get(deepest), MAX_DEPTH - 1);

  // Filing a PLAN into the deepest folder is always allowed — refusing would
  // mean a folder you can see but cannot use.
  assert.equal(planMove(tree, ["free"], deepest).ok, true);

  // A FOLDER cannot go past the last level.
  assert.deepEqual(planMove(tree, ["solo"], deepest), { ok: false, reason: "depth" });

  // "box" is shallow itself but carries one folder level, so it overflows one
  // step earlier than a bare folder would.
  assert.equal(folderSpan(tree, "box"), 1);
  assert.deepEqual(planMove(tree, ["box"], `f${MAX_DEPTH - 2}`), { ok: false, reason: "depth" });
  assert.equal(planMove(tree, ["box"], `f${MAX_DEPTH - 3}`).ok, true, "fits exactly one level up");
});

test("childDepth › root children are depth 0", () => {
  const tree = buildTree(fixture());
  assert.equal(childDepth(tree, null), 0);
  assert.equal(childDepth(tree, "adv"), 1);
});

test("applyMove › rewrites parentId on exactly the moved records", () => {
  const state = fixture();
  const next = applyMove(state, ["jane"], "tmpl");
  assert.equal(next.plans.find(p => p.id === "jane").parentId, "tmpl");
  assert.equal(next.plans.find(p => p.id === "sam").parentId, "fall", "untouched");
  assert.notEqual(next.plans, state.plans, "returns new arrays");
});

test("applyMove › moving to root writes null, and a moved folder keeps its children", () => {
  const state = fixture();
  const next = applyMove(state, ["fall"], null);
  assert.equal(next.folders.find(f => f.id === "fall").parentId, null);
  const tree = buildTree(next);
  // Children follow implicitly — they point at the folder, not at a path.
  assert.deepEqual(tree.childrenOf.get("fall").plans.map(p => p.id), ["jane", "sam"]);
  assert.equal(tree.depthOf.get("fall"), 0);
});

test("moveTargets › offers every folder as a path, disabling illegal destinations", () => {
  const tree = buildTree(fixture());
  const targets = moveTargets(tree, ["adv"], EN);
  const byId = Object.fromEntries(targets.map(t => [t.id, t]));
  assert.deepEqual(targets.map(t => t.id), ["adv", "fall", "spr", "tmpl"]);
  assert.equal(byId.fall.path, "Advisees/Fall 2026");
  assert.equal(byId.adv.disabled, true);
  assert.equal(byId.fall.disabled, true, "own descendant");
  assert.equal(byId.fall.reason, "cycle");
  assert.equal(byId.tmpl.disabled, false);
});

// ── naming ────────────────────────────────────────────────────────────

test("uniqueName › appends the first free numeric suffix, comparing case-blind", () => {
  assert.equal(uniqueName([], "untitled folder"), "untitled folder");
  assert.equal(uniqueName(["untitled folder"], "untitled folder"), "untitled folder 2");
  assert.equal(uniqueName(["Untitled Folder", "untitled folder 2"], "untitled folder"), "untitled folder 3");
});

test("siblingNames › spans folders and plans in the same parent", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(siblingNames(tree, "adv").sort(), ["Fall 2026", "Spring 2027"]);
  assert.deepEqual(siblingNames(tree, null).sort(), ["Advisees", "Scratch", "Templates"]);
});

// ── search ────────────────────────────────────────────────────────────

test("search › finds plans inside COLLAPSED folders", () => {
  // The defining bug: filtering rows instead of records makes search silently
  // non-recursive, and a user concludes their plan was deleted.
  const tree = buildTree(fixture());
  const hits = matchIds(buildSearchIndex(tree), "jane");
  assert.deepEqual([...hits], ["jane"]);
  const rows = flattenTree(tree, { open: new Set(), matches: hits, ...EN });
  assert.deepEqual(ids(rows), ["adv", "fall", "jane"], "ancestors revealed in context");
});

test("search › ancestors keep their true depth so structure still reads", () => {
  const tree = buildTree(fixture());
  const rows = flattenTree(tree, { matches: matchIds(buildSearchIndex(tree), "sam"), ...EN });
  assert.deepEqual(rows.map(r => [r.id, r.depth]), [["adv", 0], ["fall", 1], ["sam", 2]]);
});

test("search › a matching FOLDER brings its whole subtree", () => {
  const tree = buildTree(fixture());
  const hits = matchIds(buildSearchIndex(tree), "advisees");
  const rows = flattenTree(tree, { matches: hits, ...EN });
  assert.deepEqual(ids(rows), ["adv", "fall", "jane", "sam", "spr"]);
});

test("search › terms are AND-ed and match the ancestor path in any order", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  for (const q of ["fall jane", "jane fall", "advisees jane"]) {
    assert.deepEqual([...matchIds(index, q)], ["jane"], q);
  }
  assert.equal(matchIds(index, "jane templates").size, 0);
});

// ── path-scoped search (the `/` form) ─────────────────────────────────

test("search › a slash reads the query as a PATH, not as AND-ed words", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  // Both orders match under AND; only the correct order matches as a path.
  assert.deepEqual([...matchIds(index, "fall/jane")], ["jane"]);
  assert.equal(matchIds(index, "jane/fall").size, 0);
});

test("search › path segments may skip levels, like a lenient completion", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  // "Fall 2026" sits between, and does not need spelling out.
  assert.deepEqual([...matchIds(index, "advisees/jane")], ["jane"]);
  assert.deepEqual([...matchIds(index, "advisees/fall/jane")], ["jane"]);
});

test("search › a trailing slash means everything inside that folder", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  const hits = matchIds(index, "advisees/");
  // The folder's whole subtree, but nothing outside it.
  assert.deepEqual([...hits].sort(), ["fall", "jane", "sam", "spr"]);
  assert.ok(!hits.has("adv"), "the folder itself is a container, not content");
  assert.ok(!hits.has("loose"));
});

test("search › path mode disambiguates a name that repeats across folders", () => {
  // The case flat AND cannot express: two plans with the same name.
  const state = {
    folders: [F("a", "Advisees"), F("t", "Templates")],
    plans: [P("p1", "Jane Doe", "a"), P("p2", "Jane Doe", "t")],
  };
  const index = buildSearchIndex(buildTree(state));
  assert.equal(matchIds(index, "jane").size, 2);
  assert.deepEqual([...matchIds(index, "advisees/jane")], ["p1"]);
  assert.deepEqual([...matchIds(index, "templates/jane")], ["p2"]);
});

test("search › leading and doubled slashes are noise", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  assert.deepEqual([...matchIds(index, "/advisees/jane")], ["jane"]);
  assert.deepEqual([...matchIds(index, "advisees//jane")], ["jane"]);
  assert.equal(matchIds(index, "/"), null, "a bare slash is not a filter");
});

test("search › path mode still reveals ancestors when flattened", () => {
  const tree = buildTree(fixture());
  const hits = matchIds(buildSearchIndex(tree), "fall/sam");
  assert.deepEqual(ids(flattenTree(tree, { matches: hits, ...EN })), ["adv", "fall", "sam"]);
});

test("search › folds diacritics and case", () => {
  const tree = buildTree({ folders: [], plans: [P("j", "José Ramírez")] });
  const index = buildSearchIndex(tree);
  assert.equal(matchIds(index, "jose").size, 1);
  assert.equal(matchIds(index, "RAMIREZ").size, 1);
});

test("search › the extra slotLabel text is searchable", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree, { slotLabel: id => (id === "jane" ? "Computer Science, BSCS" : "") });
  assert.deepEqual([...matchIds(index, "bscs")], ["jane"]);
});

test("search › an empty query is null, meaning no filter at all", () => {
  const tree = buildTree(fixture());
  const index = buildSearchIndex(tree);
  assert.equal(matchIds(index, ""), null);
  assert.equal(matchIds(index, "   "), null);
  assert.equal(searchScope(tree, null), null);
  assert.deepEqual(ids(flattenTree(tree, { matches: null, ...EN })), ["adv", "tmpl", "loose"]);
});

test("search › does not mutate the persisted open set", () => {
  const tree = buildTree(fixture());
  const open = new Set(["tmpl"]);
  const hits = matchIds(buildSearchIndex(tree), "jane");
  flattenTree(tree, { open, matches: hits, ...EN });
  assert.deepEqual([...open], ["tmpl"], "clearing the query must restore the tree exactly");
});

test("search › folder rows carry a matched-plan count for the badge", () => {
  const tree = buildTree(fixture());
  const hits = matchIds(buildSearchIndex(tree), "jane");
  const rows = flattenTree(tree, { matches: hits, ...EN });
  assert.equal(rows.find(r => r.id === "adv").matched, 1);
  assert.equal(rows.find(r => r.id === "adv").counts.plans, 2, "of 2 in the subtree");
});

test("search › a query matching nothing yields no rows", () => {
  const tree = buildTree(fixture());
  const hits = matchIds(buildSearchIndex(tree), "zzzz");
  assert.equal(hits.size, 0);
  assert.deepEqual(flattenTree(tree, { matches: hits, ...EN }), []);
});

test("normalizeSearchText › collapses whitespace and folds fullwidth forms", () => {
  assert.equal(normalizeSearchText("  Jane   Doe "), "jane doe");
  assert.equal(normalizeSearchText("ＰＬＡＮ"), "plan");
  assert.equal(normalizeSearchText(null), "");
});

// ── degenerate input ──────────────────────────────────────────────────

test("planFolders › an empty store yields an empty tree, not a throw", () => {
  const tree = buildTree();
  assert.deepEqual(flattenTree(tree, EN), []);
  assert.deepEqual(deleteScope(tree, []), { folderIds: [], planIds: [] });
  assert.deepEqual(planMove(tree, [], null), { ok: false, reason: "noop" });
  assert.deepEqual(moveTargets(tree, [], EN), []);
});

test("planFolders › a move naming an unknown id is rejected, not applied", () => {
  const tree = buildTree(fixture());
  assert.deepEqual(planMove(tree, ["nope"], "adv"), { ok: false, reason: "noop" });
});

// ── Manual order ──────────────────────────────────────────────────────
// Order is a persisted field, so the failure modes are data-shaped: a drop
// that renumbers siblings can tear halfway, and a library saved before manual
// ordering existed must not reshuffle when it loads.

test("manual order › rows follow `order`, not name or array position", () => {
  const tree = buildTree({ folders: [], plans: [
    P("p1", "Zebra", null, { order: 100 }),
    P("p2", "Apple", null, { order: 200 }),
    P("p3", "Mango", null, { order: 300 }),
  ] });
  const names = (mode) => flattenTree(tree, { sortMode: mode, ...EN }).map(r => r.item.name);
  assert.deepEqual(names("manual"), ["Zebra", "Apple", "Mango"]);
  // The same tree under the other modes is untouched by `order`.
  assert.deepEqual(names("name"), ["Apple", "Mango", "Zebra"]);
});

test("manual order › records without `order` fall back to name, never to a pile", () => {
  // A library that predates manual ordering, or a plan just imported from a
  // share: it must slot in predictably rather than all landing at one end in
  // arbitrary array order.
  const tree = buildTree({ folders: [], plans: [
    P("p1", "Beta"), P("p2", "Alpha"), P("p3", "Ordered", null, { order: 50 }),
  ] });
  assert.deepEqual(
    flattenTree(tree, { sortMode: "manual", ...EN }).map(r => r.item.name),
    ["Ordered", "Alpha", "Beta"],
  );
});

test("manual order › folders reorder too under manual", () => {
  // A manual library where folders refused to move would be baffling.
  const tree = buildTree({
    folders: [F("f1", "Zeta"), F("f2", "Alfa")].map((f, i) => ({ ...f, order: (2 - i) * 10 })),
    plans: [],
  });
  assert.deepEqual(
    flattenTree(tree, { sortMode: "manual", ...EN }).map(r => r.item.name),
    ["Alfa", "Zeta"],
  );
});

test("orderBetween › a drop writes ONE record, wherever it lands", () => {
  // Empty list, both ends, and the middle. None of these renumber siblings.
  assert.equal(orderBetween(null, null).order, 1024);
  assert.equal(orderBetween(null, { order: 1024 }).order, 0);
  assert.equal(orderBetween({ order: 2048 }, null).order, 3072);
  assert.equal(orderBetween({ order: 1024 }, { order: 2048 }).order, 1536);
  // Missing neighbour orders are treated as absent ends, not as 0.
  assert.equal(orderBetween({ name: "no order" }, { order: 1024 }).order, 0);
});

test("orderBetween › repeated drops into one gap stay strictly ordered", () => {
  // The property that matters: 40 consecutive drops just above the same row
  // must each land strictly between their neighbours, or rows start swapping.
  let lo = { order: 0 }, hi = { order: 1024 };
  let prev = -Infinity;
  for (let i = 0; i < 40; i++) {
    const { order, needsReseed } = orderBetween(lo, hi);
    if (needsReseed) break;
    assert.ok(order > lo.order && order < hi.order, `drop ${i} escaped its gap`);
    assert.ok(order !== prev, "two drops produced the same order");
    prev = order;
    hi = { order };   // keep dropping just above `lo`
  }
});

test("orderBetween › exhausted precision is reported, not silently collapsed", () => {
  const { needsReseed } = orderBetween({ order: 1 }, { order: 1.0000000000000002 });
  assert.equal(needsReseed, true);
});

test("reseedOrder › renumbers onto clean gaps while preserving display order", () => {
  const seeded = reseedOrder([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual([...seeded.entries()], [["a", 1024], ["b", 2048], ["c", 3072]]);
  // And the reseeded values leave room to drop between any two again.
  assert.equal(orderBetween({ order: 1024 }, { order: 2048 }).needsReseed, false);
});
