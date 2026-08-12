// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE  (localStorage adapter)
//
// Storage key is derived from institution.storagePrefix so different
// institution forks never collide in the same browser.  The suffix
// "-state-v2" is the schema version — bump it on breaking state changes.
// ═══════════════════════════════════════════════════════════════════

const STATE_SUFFIX = "-state-v2";

/**
 * Build a namespaced localStorage key for the main plan state.
 * Exported so Header/LoadingScreen can remove the key without importing
 * the full persistence module's internal helpers.
 * @param {string} prefix  institution.storagePrefix  (e.g. "ncp")
 */
export function storageKey(prefix) {
  return `${prefix}${STATE_SUFFIX}`;
}

/**
 * Load the previously-saved planner state, or null if none.
 * @param {string} prefix  institution.storagePrefix  (e.g. "ncp")
 */
export function loadSaved(prefix) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(prefix)) || "null");
  } catch {
    return null;
  }
}

/**
 * Was a thrown storage error a quota exhaustion, as opposed to storage being
 * unavailable altogether (Safari private mode, blocked third-party storage)?
 *
 * The two need different words: a full store loses the NEXT edit and the user
 * can fix it by deleting plans, while an unavailable store never saved anything
 * and the only honest advice is "export a file". The name is the only reliable
 * signal — the numeric `code` 22 is legacy and Firefox throws its own
 * `NS_ERROR_DOM_QUOTA_REACHED`.
 * @param {unknown} err
 * @returns {'quota'|'unavailable'}
 */
export function classifyStorageError(err) {
  const name = err?.name ?? "";
  if (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err?.code === 22
  ) return "quota";
  return "unavailable";
}

/**
 * Write one key, reporting whether it landed.
 *
 * Every `setItem` in this app used to be wrapped in a bare `catch {}`. That is
 * the right *recovery* — a failed mirror write must never take down the render —
 * but it was also the whole error path, so a full 5 MB store looked exactly
 * like a healthy one: edits kept appearing on screen and silently stopped being
 * saved. The user only found out on reload, with no way to know which edits
 * survived. Callers now get a verdict they can surface.
 *
 * @param {string} k
 * @param {string} v
 * @returns {{ok: true}|{ok: false, kind: 'quota'|'unavailable', error: unknown}}
 */
export function writeKey(k, v) {
  try {
    localStorage.setItem(k, v);
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: classifyStorageError(err), error: err };
  }
}

/**
 * Persist the planner state.
 * When persist=false, only writes {persist:false} so the next load
 * knows not to restore any state.
 * @param {string}  prefix   institution.storagePrefix
 * @param {boolean} persist
 * @param {Object}  obj
 * @returns {{ok: boolean, kind?: 'quota'|'unavailable', error?: unknown}}
 *   The verdict, so the caller can tell the user the plan stopped saving.
 */
export function saveState(prefix, persist, obj) {
  return writeKey(
    storageKey(prefix),
    JSON.stringify(persist ? { persist: true, ...obj } : { persist: false })
  );
}

/**
 * Clear all planner persistence for the given institution.
 * @param {string} prefix  institution.storagePrefix
 */
export function clearState(prefix) {
  try {
    localStorage.removeItem(storageKey(prefix));
  } catch {}
}
