// ═══════════════════════════════════════════════════════════════════
// LIBRARY BACKUP — the whole-library file, built and parsed.
//
// Why a file at all: a plan lives only in this browser's localStorage. No
// account, no server copy — share links and share codes are TRANSFERS, not
// backups (the code relay is client-encrypted and deleted on first claim). No
// web API can stop a user clearing site data, so a file the user holds is the
// only durable copy that exists, and the app has to be able to make one in a
// single action.
//
// This module is pure: no React, no localStorage, no DOM. Slot reads come in
// through a `readSlot` callback and the id stamp is injected, so a test can
// drive the whole round trip deterministically. That is the point — the two
// functions here are the ones whose bugs are silent (a backup that omits a
// plan, a restore that overwrites a live one), and neither is observable by
// looking at the UI.
// ═══════════════════════════════════════════════════════════════════

import { LIBRARY_BUNDLE_KIND } from "./planSchema.js";

export { LIBRARY_BUNDLE_KIND };

/** Current bundle format. Bump only on a breaking shape change. */
export const LIBRARY_BUNDLE_VERSION = 1;

/**
 * Build a whole-library backup.
 *
 * @param {object} o
 * @param {Array<{id:string,name:string,parentId?:string|null,studentType?:string,order?:number|null}>} o.plans
 *   The plan INDEX. Folder membership lives here, not in a plan's slot.
 * @param {Array<{id:string,name:string,parentId?:string|null,order?:number|null}>} [o.folders]
 * @param {string} [o.activePlanId]
 * @param {(id: string) => object|null} o.readSlot
 *   Returns a plan's saved data, or null if unreadable/missing. The caller owns
 *   the "live plan is fresher than its slot" decision — an export taken
 *   mid-edit should include the edit, not the last autosave.
 * @param {string|null} [o.institution]
 * @param {boolean} [o.privateGrades]  Drop grades from every plan in the bundle.
 * @param {boolean} [o.privateCoop]    Redact co-op employer details.
 * @param {(v:any)=>any} [o.redactCoop] Redaction function, injected to keep this pure.
 * @param {string} [o.exportedAt]      ISO timestamp, injected for determinism.
 * @returns {{bundle: object, skipped: Array<{id:string,name:string}>}}
 */
export function buildLibraryBundle({
  plans = [],
  folders = [],
  activePlanId = null,
  readSlot,
  institution = null,
  privateGrades = false,
  privateCoop = false,
  redactCoop = (v) => v,
  exportedAt = new Date().toISOString(),
} = {}) {
  const entries = [];
  const skipped = [];

  for (const p of plans) {
    const raw = readSlot(p.id);
    // A plan with no readable slot is one never opened since creation, or one
    // whose slot a quota-exceeded write truncated. It is RECORDED as skipped
    // rather than silently dropped: a backup that quietly omits a plan claims a
    // completeness it does not have, and the user would only find out when a
    // restore came back short.
    if (!raw || typeof raw !== "object") {
      skipped.push({ id: p.id, name: p.name ?? "" });
      continue;
    }
    // Copy before redacting — mutating the caller's live plan object while
    // "exporting" it would delete the user's grades from the running app.
    const data = { ...raw };
    if (privateGrades) delete data.grades;
    if (privateCoop) data.specialTermPl = redactCoop(data.specialTermPl);
    entries.push({
      id: p.id,
      name: p.name ?? "",
      parentId: p.parentId ?? null,
      studentType: p.studentType ?? "undergrad",
      order: p.order ?? null,
      data,
    });
  }

  return {
    bundle: {
      kind: LIBRARY_BUNDLE_KIND,
      version: LIBRARY_BUNDLE_VERSION,
      exported: exportedAt,
      institution,
      activePlanId,
      folders: folders.map(f => ({
        id: f.id,
        name: f.name ?? "",
        parentId: f.parentId ?? null,
        order: f.order ?? null,
      })),
      plans: entries,
      skipped,
    },
    skipped,
  };
}

/**
 * Parse a bundle into index rows and folder rows, with every id REMAPPED.
 *
 * Remapping is the safety property, not a detail. Reusing the exported ids is
 * the obvious implementation and it is destructive: restoring a backup into a
 * browser that still holds plans would overwrite same-id slots, so the recovery
 * tool itself could lose work. With remapping, the worst case of an unnecessary
 * restore is duplicate plans — and deleting those is now undoable.
 *
 * Folder parents are remapped through the same table and validated, so a
 * parentId that isn't in the bundle becomes null rather than a dangling
 * reference that would hide the row from the tree entirely.
 *
 * @param {unknown} raw           Parsed JSON (NOT a string).
 * @param {object}  [o]
 * @param {string|number} [o.stamp]  Injected id stamp, for deterministic tests.
 * @param {string} [o.fallbackName] Name for an entry that has none.
 * @returns {{ok: true, plans: Array, folders: Array, idMap: Map, folderMap: Map, failed: number}
 *          |{ok: false, reason: 'not-a-bundle'|'empty'}}
 */
export function parseLibraryBundle(raw, { stamp = Date.now(), fallbackName = "Plan" } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not-a-bundle" };
  if (raw.kind !== LIBRARY_BUNDLE_KIND) return { ok: false, reason: "not-a-bundle" };
  if (!Array.isArray(raw.plans)) return { ok: false, reason: "not-a-bundle" };

  const srcFolders = Array.isArray(raw.folders) ? raw.folders : [];
  const folderMap = new Map();
  srcFolders.forEach((f, i) => {
    if (f && typeof f.id === "string") folderMap.set(f.id, `folder_${stamp}_${i}`);
  });

  const idMap = new Map();
  const plans = [];
  let failed = 0;

  raw.plans.forEach((entry, i) => {
    // An entry without data cannot be restored into anything meaningful — a row
    // pointing at an absent slot would load as an empty plan, which looks like
    // the backup lost the work rather than never having had it.
    if (!entry || typeof entry !== "object" || !entry.data || typeof entry.data !== "object") {
      failed++;
      return;
    }
    const id = `plan_${stamp}_${i}`;
    if (typeof entry.id === "string") idMap.set(entry.id, id);
    const parentId = typeof entry.parentId === "string"
      ? folderMap.get(entry.parentId) ?? null
      : null;
    plans.push({
      id,
      name: (typeof entry.name === "string" && entry.name.trim()) ? entry.name : fallbackName,
      studentType: entry.studentType ?? entry.data.studentType ?? "undergrad",
      parentId,
      data: entry.data,
    });
  });

  if (plans.length === 0) return { ok: false, reason: "empty" };

  const folders = srcFolders
    .filter(f => f && folderMap.has(f.id))
    .map(f => ({
      id: folderMap.get(f.id),
      name: (typeof f.name === "string" && f.name.trim()) ? f.name : "untitled folder",
      parentId: typeof f.parentId === "string" ? folderMap.get(f.parentId) ?? null : null,
    }));

  return { ok: true, plans, folders, idMap, folderMap, failed };
}
