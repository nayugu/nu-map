/**
 * planLibraryFile.js — the multi-plan library file. Pure; no React, no storage.
 *
 * ## Why one JSON file and not a zip
 *
 * Measured before choosing: a worst-case plan (5 years, 55 courses, grades,
 * two co-ops, double major) serialises to ~3.6 KB, so 200 plans — a serious
 * advisor caseload — is ~555 KB. That is an ordinary download, and it cannot
 * grow without bound anyway: the whole library lives in localStorage, whose
 * ~5 MB cap bounds any export well below the size at which archiving would
 * start to matter. A zip would also cost a bundler dependency (~100 KB) in a
 * bundle already flagged oversized — about what it saves on a typical
 * caseload, paid by every user rather than by the rare bulk export. Gzip on
 * distinct plans is only 4.8×, and if that ever matters the platform's own
 * CompressionStream does it with no dependency at all.
 *
 * The zip's real advantage — separate files a human could edit — is not
 * wanted: nobody hand-edits these, and a per-file archive invites the
 * half-imported library that one atomic document makes impossible.
 *
 * ## Structure is carried, not translated
 *
 * Folders are already two flat arrays with `parentId` pointers, so the file
 * stores exactly that. Nothing is flattened into paths on the way out and
 * re-parsed on the way in — the shape that survives a round trip is the shape
 * the app already runs on, which is what makes "keep the structure" true by
 * construction instead of by careful mapping.
 *
 * ## Everything is re-identified on import
 *
 * Ids are re-minted and `parentId` remapped through the same map. Two things
 * follow that both matter: importing a file twice cannot collide with itself,
 * and importing a library exported from THIS browser cannot silently overwrite
 * the plans it came from. An id in the file is a link between records inside
 * that file and nothing more.
 */

import { deleteScope, MAX_DEPTH } from "./planFolders.js";

export const LIBRARY_FILE_VERSION = 2;
export const LIBRARY_FILE_KIND = "numap-library";

/**
 * Build the export payload.
 *
 * @param {object}   tree        from buildTree
 * @param {string[]|null} ids    selected node ids, or null for the whole library
 * @param {(planId: string) => object|null} snapshotOf
 *        the plan's saved snapshot. Returning null drops the plan rather than
 *        writing `data: null` — a plan whose slot cannot be read is not a plan
 *        we can honestly claim to have exported.
 * @param {(data: object) => object} [redact]
 *        applied to each snapshot; where the privacy toggles are honoured, so
 *        this file makes exactly the same promises the single-plan export does.
 * @returns {{version, kind, exported, folders, plans}}
 */
export function buildLibraryFile(tree, ids, snapshotOf, { redact = null, now = null } = {}) {
  // `deleteScope` is the closure of a selection — every folder and plan at or
  // below it, deduplicated across overlapping subtrees. That is precisely the
  // set an export needs, so it is reused rather than reimplemented: two
  // functions computing "what is inside this selection" would be two chances
  // to disagree about it.
  const scope = ids == null
    ? { folderIds: tree.folders.map(f => f.id), planIds: tree.plans.map(p => p.id) }
    : deleteScope(tree, ids);

  const inFolders = new Set(scope.folderIds);

  // A parent outside the exported set becomes root INSIDE the file: exporting
  // one subfolder should give you that folder, not a chain of empty ancestors
  // it happened to live under.
  const parentIn = (rec) => (inFolders.has(rec.parentId) ? rec.parentId : null);

  const folders = scope.folderIds
    .map(id => tree.byId.get(id))
    .filter(Boolean)
    .map(f => ({ id: f.id, name: f.name ?? "", parentId: parentIn(f), ...(typeof f.order === "number" ? { order: f.order } : {}) }));

  const plans = [];
  for (const id of scope.planIds) {
    const rec = tree.byId.get(id);
    if (!rec) continue;
    const snap = snapshotOf(id);
    if (!snap) continue;
    plans.push({
      id: rec.id,
      name: rec.name ?? "",
      parentId: parentIn(rec),
      ...(typeof rec.order === "number" ? { order: rec.order } : {}),
      ...(rec.student ? { student: rec.student } : {}),
      studentType: rec.studentType ?? "undergrad",
      data: redact ? redact(snap) : snap,
    });
  }

  return {
    version: LIBRARY_FILE_VERSION,
    kind: LIBRARY_FILE_KIND,
    exported: (now ?? new Date()).toISOString(),
    folders,
    plans,
  };
}

/**
 * Validate and normalise a parsed file.
 *
 * Hostile by intent: this reads a file from outside the app, so every
 * structural assumption the rest of the code makes has to be established here
 * rather than assumed. Returns a reason code instead of throwing so the caller
 * can say WHICH way the file was wrong.
 *
 * @returns {{ok: true, folders: Array, plans: Array}|{ok: false, reason: string}}
 */
export function parseLibraryFile(raw) {
  let doc = raw;
  if (typeof raw === "string") {
    try { doc = JSON.parse(raw); } catch { return { ok: false, reason: "json" }; }
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "shape" };
  if (doc.kind !== LIBRARY_FILE_KIND) return { ok: false, reason: "kind" };
  if (doc.version !== LIBRARY_FILE_VERSION) return { ok: false, reason: "version" };
  if (!Array.isArray(doc.folders) || !Array.isArray(doc.plans)) return { ok: false, reason: "shape" };
  if (doc.plans.length === 0 && doc.folders.length === 0) return { ok: false, reason: "empty" };

  // Ids must be unique ACROSS both lists: they share one namespace in the tree,
  // so a folder and a plan with the same id would collapse into one node and
  // silently lose whichever lost the race.
  const seen = new Set();
  const folders = [];
  for (const f of doc.folders) {
    if (!f || typeof f !== "object") return { ok: false, reason: "shape" };
    if (typeof f.id !== "string" || !f.id || seen.has(f.id)) return { ok: false, reason: "ids" };
    seen.add(f.id);
    folders.push({
      id: f.id,
      name: typeof f.name === "string" ? f.name : "",
      parentId: typeof f.parentId === "string" ? f.parentId : null,
      ...(typeof f.order === "number" ? { order: f.order } : {}),
    });
  }
  const plans = [];
  for (const p of doc.plans) {
    if (!p || typeof p !== "object") return { ok: false, reason: "shape" };
    if (typeof p.id !== "string" || !p.id || seen.has(p.id)) return { ok: false, reason: "ids" };
    if (!p.data || typeof p.data !== "object" || Array.isArray(p.data)) return { ok: false, reason: "plandata" };
    seen.add(p.id);
    plans.push({
      id: p.id,
      name: typeof p.name === "string" && p.name ? p.name : "Plan",
      parentId: typeof p.parentId === "string" ? p.parentId : null,
      ...(typeof p.order === "number" ? { order: p.order } : {}),
      ...(typeof p.student === "string" && p.student.trim() ? { student: p.student.trim() } : {}),
      studentType: p.studentType === "graduate" ? "graduate" : "undergrad",
      data: p.data,
    });
  }

  // A parentId may only name a FOLDER in this same file. Anything else — a
  // plan, a stranger, a folder that was not exported — reads as root, the same
  // repair buildTree performs, so a partial or hand-edited file degrades to a
  // flatter library rather than to missing plans.
  const folderIds = new Set(folders.map(f => f.id));
  for (const rec of [...folders, ...plans]) {
    if (rec.parentId != null && !folderIds.has(rec.parentId)) rec.parentId = null;
  }
  // Cycles cannot be repaired by the pointer check above (in A→B→A both
  // parents exist), so re-root anything that never reaches root.
  const raw2 = new Map(folders.map(f => [f.id, f.parentId]));
  for (const f of folders) {
    const walked = new Set([f.id]);
    let a = raw2.get(f.id);
    while (a != null) {
      if (walked.has(a)) { f.parentId = null; break; }
      walked.add(a);
      a = raw2.get(a);
    }
  }

  return { ok: true, folders, plans };
}

/** Depth of the deepest folder in a parsed file (root folders are 0). */
export function fileFolderDepth(folders) {
  const parentOf = new Map(folders.map(f => [f.id, f.parentId]));
  let max = -1;
  for (const f of folders) {
    let d = 0;
    for (let a = f.parentId; a != null; a = parentOf.get(a) ?? null) {
      if (++d > folders.length) break;      // cycles are already re-rooted
    }
    if (d > max) max = d;
  }
  return max;
}

/**
 * Merge a parsed file into the existing library, under one new folder.
 *
 * Nesting under a dated folder is what makes the import non-destructive and
 * legible: nothing existing moves, the whole import can be undone by deleting
 * one folder, and 200 arriving plans do not flood the root.
 *
 * The one exception is depth. Nesting costs a level, so a file whose folders
 * already reach the cap cannot go inside anything — there is no legal place to
 * put it. Rather than silently truncating the structure the user asked to
 * keep, the import lands at the top level and says so via `atRoot`.
 *
 * @param {{folders: Array, plans: Array}} incoming  from parseLibraryFile
 * @param {() => string} newId  id minter (injected so tests are deterministic)
 * @param {string} folderName   name for the wrapper folder
 * @returns {{folder: object|null, folders: Array, plans: Array, slots: Array<{id, data}>, atRoot: boolean}}
 */
export function mergeLibrary(incoming, newId, folderName) {
  const atRoot = fileFolderDepth(incoming.folders) + 1 > MAX_DEPTH - 1;
  const wrapper = atRoot ? null : { id: newId(), name: folderName, parentId: null };

  const idMap = new Map();
  for (const f of incoming.folders) idMap.set(f.id, newId());
  for (const p of incoming.plans) idMap.set(p.id, newId());

  const reparent = (parentId) =>
    parentId == null ? (wrapper ? wrapper.id : null) : (idMap.get(parentId) ?? (wrapper ? wrapper.id : null));

  const folders = incoming.folders.map(f => ({
    id: idMap.get(f.id), name: f.name, parentId: reparent(f.parentId),
    ...(typeof f.order === "number" ? { order: f.order } : {}),
  }));

  const plans = [];
  const slots = [];
  for (const p of incoming.plans) {
    const id = idMap.get(p.id);
    plans.push({
      id, name: p.name, parentId: reparent(p.parentId),
      ...(typeof p.order === "number" ? { order: p.order } : {}),
      ...(p.student ? { student: p.student } : {}),
      studentType: p.studentType,
    });
    slots.push({ id, data: p.data });
  }

  return { folder: wrapper, folders, plans, slots, atRoot };
}
