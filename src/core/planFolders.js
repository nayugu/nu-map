/**
 * planFolders.js — the folder tree for saved plans. Pure; no React, no storage.
 *
 * ## Why pointers and not paths
 *
 * Two flat arrays with `parentId` pointers, NOT a nested structure and NOT a
 * materialized `path` string. Both alternatives were considered and lose:
 *
 *   - Nested storage makes every move a deep splice and breaks the flat-array
 *     consumers that already exist (`plans.find`, `bulkDeletePlans`, the
 *     studentType backfill effect).
 *   - A `path` string on each plan cannot represent an EMPTY folder — the
 *     folder would exist only while something referenced it, so "New Folder →
 *     name it → drag plans in" is impossible, and that sequence is the whole
 *     interaction. It also makes rename an N-record write that can tear.
 *
 * Pointers give empty folders for free, make a move a single-field write, and
 * leave the plan index shape backward compatible: a record with no `parentId`
 * reads as root, so there is no migration.
 *
 * ## The tree is derived, never stored
 *
 * `buildTree` is the only place that turns pointers into structure, and it
 * REPAIRS as it reads rather than trusting the data:
 *
 *   1. a `parentId` naming a folder that no longer exists reads as root
 *      (recursive delete in another tab can leave these behind);
 *   2. a folder whose ancestor chain never reaches root — a cycle — is
 *      re-rooted. This is the subtle one: in an A→B→A cycle both parents
 *      exist, so an existence check sees nothing wrong, yet neither folder is
 *      reachable from root and everything beneath them would silently vanish
 *      from the tree while still occupying storage. Read-time reachability is
 *      what makes the structure unloseable.
 *
 * ## Order is explicit, never implicit
 *
 * Rows sort by name (natural, locale-aware) or recency — there is no `order`
 * field and no drag-to-reorder. Implicit array order cannot work here: `plans`
 * is ONE flat array interleaving every folder's children, so a plan dropped
 * into a folder would land at whatever position the global array implied,
 * which is effectively random. Explicit sorting means "where did it go" always
 * has an answer. Natural sort also makes the default names (`Plan 1`, `Plan 2`,
 * … `Plan 10`) collate into creation order, so existing users see no reordering
 * when folders ship.
 *
 * ## Search matches records, never rows
 *
 * `matchIds` runs over every plan and folder at every depth. Filtering the
 * flattened rows instead would make search silently NON-recursive — a
 * collapsed folder contributes no rows, so nothing inside it could ever match,
 * and a user would type a name, see nothing, and conclude the plan was
 * deleted. Expansion state is an input to rendering only; it never limits what
 * search can find.
 */

/** Deepest allowed depth index (root children are depth 0), so 8 levels. */
export const MAX_DEPTH = 8;

const EMPTY_BUCKET = Object.freeze({ folders: [], plans: [] });
const ZERO_COUNTS  = Object.freeze({ plans: 0, folders: 0, direct: 0 });

/**
 * Fold a string to its searchable form: strip diacritics so `jose` finds
 * `José`, fold width so fullwidth Latin matches, lowercase, collapse spaces.
 * Substring matching (no tokenizing) is what makes CJK queries work.
 */
export function normalizeSearchText(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── Tree construction ─────────────────────────────────────────────────

/**
 * Resolve each folder's EFFECTIVE parent, repairing missing parents and
 * cycles. Detection reads the original pointers only (never the partially
 * repaired map), so the result does not depend on iteration order.
 */
function effectiveParents(folders) {
  const ids = new Set(folders.map(f => f.id));
  const raw = new Map(folders.map(f => [f.id, ids.has(f.parentId) ? f.parentId : null]));
  const eff = new Map();
  for (const id of raw.keys()) {
    const seen = new Set([id]);
    let a = raw.get(id);
    let rooted = true;
    while (a != null) {
      if (seen.has(a)) { rooted = false; break; }
      seen.add(a);
      a = raw.get(a);
    }
    // Not rooted ⇒ this folder sits on or below a cycle. Surface it at root
    // so the user can see and fix it instead of losing it.
    eff.set(id, rooted ? raw.get(id) : null);
  }
  return eff;
}

/** Subtree totals + direct child count for one folder, memoized. */
function countsOf(childrenOf, id, memo) {
  const hit = memo.get(id);
  if (hit) return hit;
  const b = childrenOf.get(id) ?? EMPTY_BUCKET;
  let plans = b.plans.length;
  let folders = b.folders.length;
  for (const f of b.folders) {
    const c = countsOf(childrenOf, f.id, memo);
    plans += c.plans;
    folders += c.folders;
  }
  const out = { plans, folders, direct: b.plans.length + b.folders.length };
  memo.set(id, out);
  return out;
}

/**
 * Derive the tree from the two flat arrays. Cheap enough to call on every
 * render (one pass per record); memoize it upstream anyway since the rows,
 * search index and keyboard navigation all read from it.
 *
 * @param {{plans?: Array, folders?: Array}} state
 * @returns {{
 *   plans: Array, folders: Array,
 *   folderIds: Set<string>, byId: Map<string, object>,
 *   parentOf: Map<string, string|null>,
 *   childrenOf: Map<string|null, {folders: Array, plans: Array}>,
 *   depthOf: Map<string, number>,
 *   counts: Map<string, {plans: number, folders: number, direct: number}>,
 * }}
 */
export function buildTree({ plans = [], folders = [] } = {}) {
  const eff = effectiveParents(folders);
  const folderIds = new Set(folders.map(f => f.id));

  const childrenOf = new Map();
  const bucket = k => {
    let b = childrenOf.get(k);
    if (!b) { b = { folders: [], plans: [] }; childrenOf.set(k, b); }
    return b;
  };
  bucket(null);

  const parentOf = new Map();
  const byId = new Map();

  for (const f of folders) {
    const p = eff.get(f.id) ?? null;
    parentOf.set(f.id, p);
    byId.set(f.id, f);
    bucket(p).folders.push(f);
  }
  for (const p of plans) {
    // A plan can never be part of a cycle, so existence is the only check.
    const parent = folderIds.has(p.parentId) ? p.parentId : null;
    parentOf.set(p.id, parent);
    byId.set(p.id, p);
    bucket(parent).plans.push(p);
  }

  const depthOf = new Map();
  const walkDepth = (parentId, depth) => {
    for (const f of (childrenOf.get(parentId) ?? EMPTY_BUCKET).folders) {
      depthOf.set(f.id, depth);
      walkDepth(f.id, depth + 1);
    }
  };
  walkDepth(null, 0);

  const counts = new Map();
  const memo = new Map();
  for (const f of folders) counts.set(f.id, countsOf(childrenOf, f.id, memo));

  return { plans, folders, folderIds, byId, parentOf, childrenOf, depthOf, counts };
}

/** Depth a child of `folderId` would occupy (0 when dropping at root). */
export function childDepth(tree, folderId) {
  return folderId == null ? 0 : (tree.depthOf.get(folderId) ?? 0) + 1;
}

/**
 * Deepest FOLDER level below a node. Plans are leaves and never count, because
 * `MAX_DEPTH` caps how deep folders may nest — not where a plan may be filed.
 * Refusing to drop a plan into a folder that already exists would be absurd.
 */
export function folderSpan(tree, id) {
  if (!tree.folderIds.has(id)) return 0;
  let span = 0;
  for (const f of (tree.childrenOf.get(id) ?? EMPTY_BUCKET).folders) {
    span = Math.max(span, 1 + folderSpan(tree, f.id));
  }
  return span;
}

/** Is `id` at or below `ancestorId`? (`id === ancestorId` counts.) */
export function isDescendant(tree, id, ancestorId) {
  if (id == null || ancestorId == null) return false;
  for (let a = id; a != null; a = tree.parentOf.get(a) ?? null) {
    if (a === ancestorId) return true;
  }
  return false;
}

/** Slash path of a folder, inclusive. `null` → "" (root has no name). */
export function folderPath(tree, id, { sep = "/" } = {}) {
  const parts = [];
  for (let a = id; a != null; a = tree.parentOf.get(a) ?? null) {
    const rec = tree.byId.get(a);
    if (!rec) break;
    parts.unshift(rec.name ?? "");
  }
  return parts.join(sep);
}

/** Every folder and plan at or below `folderId`, excluding the folder itself. */
export function subtreeOf(tree, folderId) {
  const folderIds = [];
  const planIds = [];
  const stack = [folderId];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const b = tree.childrenOf.get(id) ?? EMPTY_BUCKET;
    for (const p of b.plans) planIds.push(p.id);
    for (const f of b.folders) { folderIds.push(f.id); stack.push(f.id); }
  }
  return { folderIds, planIds };
}

// ── Selection normalization ───────────────────────────────────────────

/**
 * Keep only nodes with no selected ancestor.
 *
 * Moving a folder implicitly moves its contents, so a selection holding both a
 * folder and something inside it would otherwise move that child twice — once
 * as itself and again inside its parent — landing it somewhere nobody chose.
 * Delete has the same problem in reverse: the union of subtrees must be
 * deduplicated before it can be counted against the "one plan must survive"
 * invariant.
 */
export function topmostNodes(tree, ids) {
  const sel = new Set(ids);
  return [...ids].filter(id => {
    for (let a = tree.parentOf.get(id) ?? null; a != null; a = tree.parentOf.get(a) ?? null) {
      if (sel.has(a)) return false;
    }
    return true;
  });
}

/**
 * Everything a delete of `ids` would actually remove, deduplicated across
 * overlapping subtrees.
 * @returns {{folderIds: string[], planIds: string[]}}
 */
export function deleteScope(tree, ids) {
  const folderIds = new Set();
  const planIds = new Set();
  for (const id of topmostNodes(tree, ids)) {
    if (tree.folderIds.has(id)) {
      folderIds.add(id);
      const sub = subtreeOf(tree, id);
      for (const f of sub.folderIds) folderIds.add(f);
      for (const p of sub.planIds) planIds.add(p);
    } else {
      planIds.add(id);
    }
  }
  return { folderIds: [...folderIds], planIds: [...planIds] };
}

// ── Moving ────────────────────────────────────────────────────────────

/**
 * Validate a move of `ids` into `targetId` (null = root).
 *
 * The depth check measures the moved folder's own SUBTREE, not just the node:
 * a folder two levels deep dropped near the cap overflows even though the
 * folder itself is shallow. Plans are exempt — see `folderSpan`.
 *
 * @returns {{ok: true, moving: string[]}|{ok: false, reason: 'self'|'cycle'|'depth'|'noop'}}
 */
export function planMove(tree, ids, targetId) {
  const moving = topmostNodes(tree, ids).filter(id => tree.byId.has(id));
  if (moving.length === 0) return { ok: false, reason: "noop" };

  for (const id of moving) {
    if (id === targetId) return { ok: false, reason: "self" };
    // A folder cannot become its own descendant.
    if (tree.folderIds.has(id) && isDescendant(tree, targetId, id)) {
      return { ok: false, reason: "cycle" };
    }
  }

  const base = childDepth(tree, targetId);
  for (const id of moving) {
    if (!tree.folderIds.has(id)) continue;
    if (base + folderSpan(tree, id) > MAX_DEPTH - 1) return { ok: false, reason: "depth" };
  }

  // Everything already sits directly in the target: nothing to do.
  if (moving.every(id => (tree.parentOf.get(id) ?? null) === (targetId ?? null))) {
    return { ok: false, reason: "noop" };
  }
  return { ok: true, moving };
}

/**
 * Apply a validated move, returning new arrays. Pure: callers set state with
 * the results.
 */
export function applyMove({ plans = [], folders = [] }, moving, targetId) {
  const set = new Set(moving);
  const to = targetId ?? null;
  return {
    plans:   plans.map(p   => (set.has(p.id) ? { ...p, parentId: to } : p)),
    folders: folders.map(f => (set.has(f.id) ? { ...f, parentId: to } : f)),
  };
}

/** Finder's collision behaviour: "untitled folder", "untitled folder 2", … */
export function uniqueName(existingNames, base) {
  const taken = new Set([...existingNames].map(normalizeSearchText));
  if (!taken.has(normalizeSearchText(base))) return base;
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(normalizeSearchText(candidate))) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** Names of the direct children of `parentId` — feeds `uniqueName`. */
export function siblingNames(tree, parentId) {
  const b = tree.childrenOf.get(parentId ?? null) ?? EMPTY_BUCKET;
  return [...b.folders, ...b.plans].map(n => n.name ?? "");
}

// ── Search ────────────────────────────────────────────────────────────

/**
 * Precompute one searchable haystack per record.
 *
 * Built once per plans/folders change, NOT per keystroke: `slotLabel` reads a
 * plan's saved slot out of localStorage, which is synchronous, and the old
 * header search did that for every plan on every character typed.
 *
 * @param {object} tree
 * @param {{slotLabel?: (planId: string) => string}} [opts]
 */
export function buildSearchIndex(tree, { slotLabel = null } = {}) {
  const index = new Map();
  for (const [id, rec] of tree.byId) {
    const isFolder = tree.folderIds.has(id);
    // The ancestor path is searchable, so "fall jane" finds
    // Advisees/Fall 2026/Jane Doe without knowing where it lives.
    const parentId = tree.parentOf.get(id) ?? null;
    const path = folderPath(tree, parentId, { sep: " " });
    const extra = !isFolder && slotLabel ? slotLabel(id) : "";
    const ancestors = [];
    for (let a = parentId; a != null; a = tree.parentOf.get(a) ?? null) {
      const anc = tree.byId.get(a);
      if (!anc) break;
      ancestors.unshift(normalizeSearchText(anc.name));
    }
    index.set(id, {
      kind: isFolder ? "folder" : "plan",
      hay: normalizeSearchText(`${rec.name ?? ""} ${extra} ${path}`),
      // Path matching needs the segments kept apart; `hay` has them mashed
      // together and cannot tell "Fall/Jane" from "Jane/Fall".
      ancestors,
      name: normalizeSearchText(`${rec.name ?? ""} ${extra}`),
    });
  }
  return index;
}

/**
 * Do `segs` match this record's location, shell-path style?
 *
 * Every segment but the last must match an ancestor, IN ORDER but not
 * necessarily adjacently — so `advisees/jane` works without spelling out the
 * "Fall 2026" in between, exactly like a lenient path completion. The last
 * segment matches the record's own name; when it is empty (a trailing slash)
 * there is no name constraint, which makes `advisees/` mean "everything in
 * Advisees".
 */
function matchesPath(rec, segs) {
  const last = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  if (last && !rec.name.includes(last)) return false;
  let i = 0;
  for (const seg of dirs) {
    let found = false;
    while (i < rec.ancestors.length) {
      if (rec.ancestors[i++].includes(seg)) { found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Ids matching `query`.
 *
 * Two modes. Without a slash, whitespace-separated terms are AND-ed against
 * name + program + path, so word order does not matter. With a slash the query
 * is read as a PATH — `advisees/fall/jane` — which is what disambiguates a
 * name that repeats across folders, the case a flat AND cannot express.
 *
 * @returns {Set<string>|null} null when the query is empty (= no filter)
 */
export function matchIds(index, query) {
  const raw = String(query ?? "");
  const hits = new Set();

  if (raw.includes("/")) {
    // Leading and repeated slashes are noise ("/x", "a//b"); a single trailing
    // slash is meaningful, so keep the final empty segment when there is one.
    const parts = raw.split("/").map(normalizeSearchText);
    const segs = parts.filter((p, i) => p !== "" || i === parts.length - 1);
    if (segs.length === 0 || (segs.length === 1 && segs[0] === "")) return null;
    for (const [id, rec] of index) if (matchesPath(rec, segs)) hits.add(id);
    return hits;
  }

  const terms = normalizeSearchText(raw).split(" ").filter(Boolean);
  if (terms.length === 0) return null;
  for (const [id, rec] of index) {
    if (terms.every(t => rec.hay.includes(t))) hits.add(id);
  }
  return hits;
}

/**
 * Expand a match set into everything that should stay visible.
 *
 * A hit pulls in two directions: UP to its ancestors, so you can see where it
 * lives; and — for a folder — DOWN over its whole subtree, because a folder's
 * content is its children and a bare matching folder row would say nothing.
 */
export function searchScope(tree, matches) {
  if (!matches) return null;
  const keep = new Set(matches);

  for (const id of matches) {
    for (let a = tree.parentOf.get(id) ?? null; a != null; a = tree.parentOf.get(a) ?? null) {
      // Safe to stop: an ancestor already in `keep` is either a match (whose
      // own chain this loop walks in its turn) or was added by a chain that
      // ran all the way to root.
      if (keep.has(a)) break;
      keep.add(a);
    }
  }

  const stack = [...matches].filter(id => tree.folderIds.has(id));
  const done = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (done.has(id)) continue;
    done.add(id);
    const b = tree.childrenOf.get(id) ?? EMPTY_BUCKET;
    for (const p of b.plans) keep.add(p.id);
    for (const f of b.folders) { keep.add(f.id); stack.push(f.id); }
  }
  return keep;
}

/** Per-folder count of matching plans in its subtree (the "3 of 12" badge). */
function matchedPlanCounts(tree, matches) {
  const out = new Map();
  const visit = id => {
    if (out.has(id)) return out.get(id);
    const b = tree.childrenOf.get(id) ?? EMPTY_BUCKET;
    let n = b.plans.reduce((acc, p) => acc + (matches.has(p.id) ? 1 : 0), 0);
    out.set(id, 0);
    for (const f of b.folders) n += visit(f.id);
    out.set(id, n);
    return n;
  };
  for (const f of tree.folders) visit(f.id);
  return out;
}

// ── Flattening to rows ────────────────────────────────────────────────

function comparators(sortMode, locale) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byName = (a, b) => collator.compare(a.name ?? "", b.name ?? "");
  // Folders always sort by name — "recently opened" is meaningless for a
  // container, and a folder that jumps around is disorienting.
  const plansCmp = sortMode === "recent"
    ? (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0) || byName(a, b)
    : byName;
  return { byName, plansCmp };
}

/**
 * Depth-first rows for rendering. Folders precede plans at each level.
 *
 * @param {object} tree from buildTree
 * @param {object} [opts]
 * @param {Set<string>} [opts.open] persisted expansion; ignored while searching
 * @param {'name'|'recent'} [opts.sortMode]
 * @param {Set<string>|null} [opts.matches] from matchIds
 * @param {string} [opts.locale]
 * @returns {Array<{kind:'folder'|'plan', id:string, depth:number, item:object,
 *                  open?:boolean, hasChildren?:boolean, counts?:object, matched?:number}>}
 */
export function flattenTree(tree, { open = null, sortMode = "name", matches = null, locale } = {}) {
  const scope = searchScope(tree, matches);
  const matched = matches ? matchedPlanCounts(tree, matches) : null;
  const { byName, plansCmp } = comparators(sortMode, locale);
  const openSet = open ?? new Set();
  const rows = [];

  const walk = (parentId, depth) => {
    const b = tree.childrenOf.get(parentId) ?? EMPTY_BUCKET;
    for (const f of [...b.folders].sort(byName)) {
      if (scope && !scope.has(f.id)) continue;
      const c = tree.counts.get(f.id) ?? ZERO_COUNTS;
      // Search force-opens every folder it kept, without touching the
      // persisted `open` set — so clearing the query restores the tree
      // exactly, with no save/restore bookkeeping.
      const isOpen = scope ? true : openSet.has(f.id);
      rows.push({
        kind: "folder", id: f.id, depth, item: f,
        open: isOpen, hasChildren: c.direct > 0, counts: c,
        ...(matched ? { matched: matched.get(f.id) ?? 0 } : {}),
      });
      if (isOpen) walk(f.id, depth + 1);
    }
    for (const p of [...b.plans].sort(plansCmp)) {
      if (scope && !scope.has(p.id)) continue;
      rows.push({ kind: "plan", id: p.id, depth, item: p });
    }
  };
  walk(null, 0);
  return rows;
}

/**
 * Folders as a flat list of `{id, name, path, depth, disabled}`, for a
 * "Move to…" menu. `movingIds` disables the nodes a move would reject, so the
 * menu cannot offer an illegal destination.
 */
export function moveTargets(tree, movingIds = [], { locale } = {}) {
  const { byName } = comparators("name", locale);
  const ids = [...movingIds];
  const out = [];
  const walk = (parentId, depth) => {
    for (const f of [...(tree.childrenOf.get(parentId) ?? EMPTY_BUCKET).folders].sort(byName)) {
      const verdict = ids.length ? planMove(tree, ids, f.id) : { ok: true };
      out.push({
        id: f.id, name: f.name ?? "", depth,
        path: folderPath(tree, f.id),
        disabled: !verdict.ok,
        reason: verdict.ok ? null : verdict.reason,
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
