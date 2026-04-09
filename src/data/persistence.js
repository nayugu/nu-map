// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE  (localStorage adapter)
//
// Storage key is derived from institution.storagePrefix so different
// institution forks never collide in the same browser.  The suffix
// "-state-v2" is the schema version — bump it on breaking state changes.
// ═══════════════════════════════════════════════════════════════════

const STATE_SUFFIX = "-state-v2";

function storageKey(prefix) {
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
 * Persist the planner state.
 * When persist=false, only writes {persist:false} so the next load
 * knows not to restore any state.
 * @param {string}  prefix   institution.storagePrefix
 * @param {boolean} persist
 * @param {Object}  obj
 */
export function saveState(prefix, persist, obj) {
  try {
    localStorage.setItem(
      storageKey(prefix),
      JSON.stringify(persist ? { persist: true, ...obj } : { persist: false })
    );
  } catch {
    // quota exceeded — ignore silently
  }
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
