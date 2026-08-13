// INVARIANT · hundreds of random library gestures, and what must survive them.
//
// The unit tests check each tree operation alone. This checks SEQUENCES:
// move a folder into a folder, drop a plan onto its own parent, delete a
// subtree, reorder inside it, repeat a thousand times. Structural corruption
// in a file manager rarely comes from one bad call; it comes from an order of
// calls nobody wrote a case for.
//
// The invariants are the ones the whole library rests on. Each has been a
// real bug class here or in the file managers this imitates:
//   - the tree stays a TREE: no cycles, every node reachable from root;
//   - ids stay unique across folders AND plans (they share one namespace);
//   - nothing vanishes: a move never loses a node, a delete removes exactly
//     its own closure and nothing else;
//   - the depth cap is never exceeded, however a node arrives at depth;
//   - flattenTree renders every reachable node exactly once, in every sort
//     mode, and never renders a node twice.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTree, planMove, applyMove, applyReorder, deleteScope, flattenTree,
  isDescendant, topmostNodes, siblingsInOrder, SORT_MODES, MAX_DEPTH,
} from "../../src/core/planFolders.js";

/** Deterministic PRNG, so a failure is reproducible from its seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function seedState(rand) {
  const folders = [];
  const plans = [];
  for (let i = 0; i < 12; i++) {
    const parent = folders.length && rand() < 0.6
      ? folders[Math.floor(rand() * folders.length)].id : null;
    folders.push({ id: `f${i}`, name: `Folder ${i % 4}`, parentId: parent });
  }
  for (let i = 0; i < 30; i++) {
    const parent = folders.length && rand() < 0.7
      ? folders[Math.floor(rand() * folders.length)].id : null;
    plans.push({
      id: `p${i}`, name: `Plan ${i % 5}`, parentId: parent,
      lastOpened: Math.floor(rand() * 1e6),
      ...(rand() < 0.5 ? { student: `Student ${i % 6}` } : {}),
      ...(rand() < 0.5 ? { order: Math.floor(rand() * 1000) } : {}),
    });
  }
  return { folders, plans };
}

/** Every structural rule, checked from scratch against raw arrays. */
function check(state, label) {
  const { plans, folders } = state;

  const ids = [...folders.map(f => f.id), ...plans.map(p => p.id)];
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate id`);

  const folderIds = new Set(folders.map(f => f.id));
  const tree = buildTree(state);

  // Every folder reaches root by following parents — no cycles, no orphans.
  for (const f of folders) {
    const seen = new Set([f.id]);
    let a = tree.parentOf.get(f.id) ?? null;
    let hops = 0;
    while (a != null) {
      assert.ok(!seen.has(a), `${label}: cycle at ${f.id}`);
      assert.ok(folderIds.has(a), `${label}: ${f.id} parented to a non-folder`);
      seen.add(a);
      a = tree.parentOf.get(a) ?? null;
      assert.ok(++hops <= folders.length + 1, `${label}: runaway chain at ${f.id}`);
    }
  }

  // A plan may only sit at root or inside a folder that exists.
  for (const p of plans) {
    const parent = tree.parentOf.get(p.id) ?? null;
    assert.ok(parent === null || folderIds.has(parent), `${label}: plan ${p.id} orphaned`);
  }

  // The depth cap holds no matter how a folder arrived where it is.
  for (const [, d] of tree.depthOf) {
    assert.ok(d <= MAX_DEPTH - 1, `${label}: depth ${d} exceeds the cap`);
  }

  // Rendering shows every reachable node exactly once, in every sort mode.
  for (const mode of SORT_MODES) {
    const rows = flattenTree(tree, {
      open: new Set(folders.map(f => f.id)), sortMode: mode, locale: "en",
    });
    const seen = rows.map(r => r.id);
    assert.equal(new Set(seen).size, seen.length, `${label}/${mode}: a row rendered twice`);
    assert.equal(seen.length, ids.length, `${label}/${mode}: ${ids.length - seen.length} node(s) unrendered`);
  }
  return tree;
}

test("library fuzz › a thousand random gestures never corrupt the tree", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    let state = seedState(rand);
    check(state, `seed ${seed} start`);

    for (let step = 0; step < 60; step++) {
      const tree = buildTree(state);
      const all = [...state.folders.map(f => f.id), ...state.plans.map(p => p.id)];
      const pick = () => all[Math.floor(rand() * all.length)];
      const targets = [null, ...state.folders.map(f => f.id)];
      const target = targets[Math.floor(rand() * targets.length)];
      const roll = rand();

      if (roll < 0.45) {
        // MOVE — only if planMove approves it. An approved move must never
        // produce a cycle or breach the depth cap; that is the contract.
        const ids = [pick(), ...(rand() < 0.3 ? [pick()] : [])];
        const verdict = planMove(tree, ids, target);
        if (verdict.ok) {
          // Approval must never contradict the structure it claims to protect.
          for (const id of verdict.moving) {
            assert.ok(!isDescendant(tree, target, id) || !tree.folderIds.has(id),
              `seed ${seed} step ${step}: approved a cycle`);
          }
          state = { ...state, ...applyMove(state, verdict.moving, target) };
          check(state, `seed ${seed} step ${step} move`);
        }
      } else if (roll < 0.7) {
        // REORDER within a parent.
        const kind = rand() < 0.5 ? "folder" : "plan";
        const sibs = siblingsInOrder(tree, target, kind, { sortMode: "manual", locale: "en" });
        if (sibs.length > 1) {
          const moving = [sibs[Math.floor(rand() * sibs.length)].id];
          const before = rand() < 0.5 ? sibs[Math.floor(rand() * sibs.length)].id : null;
          const res = applyReorder(state, tree, moving, target, before, { sortMode: "manual", locale: "en" });
          if (res.ok) {
            state = { plans: res.plans, folders: res.folders };
            check(state, `seed ${seed} step ${step} reorder`);
          }
        }
      } else if (roll < 0.9) {
        // DELETE a selection — must remove exactly its closure, no more.
        const ids = [pick(), ...(rand() < 0.4 ? [pick()] : [])];
        const scope = deleteScope(tree, ids);
        const doomedP = new Set(scope.planIds);
        const doomedF = new Set(scope.folderIds);
        const survivors = state.plans.filter(p => !doomedP.has(p.id));
        if (survivors.length >= 1) {           // the app forbids deleting the last plan
          const before = state.plans.length + state.folders.length;
          state = {
            plans: survivors,
            folders: state.folders.filter(f => !doomedF.has(f.id)),
          };
          const removed = before - (state.plans.length + state.folders.length);
          assert.equal(removed, doomedP.size + doomedF.size,
            `seed ${seed} step ${step}: delete removed ${removed}, scoped ${doomedP.size + doomedF.size}`);
          check(state, `seed ${seed} step ${step} delete`);
        }
      } else {
        // CREATE a folder somewhere legal.
        const id = `nf${seed}_${step}`;
        const depthOk = target == null || (buildTree(state).depthOf.get(target) ?? 0) + 1 <= MAX_DEPTH - 1;
        if (depthOk) {
          state = { ...state, folders: [...state.folders, { id, name: "New", parentId: target }] };
          check(state, `seed ${seed} step ${step} create`);
        }
      }
    }
  }
});

test("library fuzz › a move never loses or duplicates a node", () => {
  const rand = rng(7);
  let state = seedState(rand);
  const census = () => [...state.folders.map(f => f.id), ...state.plans.map(p => p.id)].sort().join(",");
  const before = census();
  for (let i = 0; i < 400; i++) {
    const tree = buildTree(state);
    const all = [...state.folders.map(f => f.id), ...state.plans.map(p => p.id)];
    const ids = [all[Math.floor(rand() * all.length)]];
    const targets = [null, ...state.folders.map(f => f.id)];
    const verdict = planMove(tree, ids, targets[Math.floor(rand() * targets.length)]);
    if (verdict.ok) {
      state = { ...state, ...applyMove(state, verdict.moving, targets.find(() => true) ?? null) };
    }
  }
  // Moving is pure relocation: the census is identical however many ran.
  assert.equal(census(), before, "a move changed the SET of nodes");
});

test("library fuzz › topmostNodes always collapses a selection to its roots", () => {
  const rand = rng(99);
  const state = seedState(rand);
  const tree = buildTree(state);
  const all = [...state.folders.map(f => f.id), ...state.plans.map(p => p.id)];
  for (let i = 0; i < 300; i++) {
    const ids = Array.from({ length: 1 + Math.floor(rand() * 6) },
      () => all[Math.floor(rand() * all.length)]);
    const top = topmostNodes(tree, [...new Set(ids)]);
    // No survivor may be inside another survivor — otherwise a move would
    // relocate the same node twice and land it somewhere nobody chose.
    for (const a of top) {
      for (const b of top) {
        if (a === b) continue;
        assert.ok(!isDescendant(tree, a, b), `${a} is inside ${b} but both survived`);
      }
    }
  }
});
