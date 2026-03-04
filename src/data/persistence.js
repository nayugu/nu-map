// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE  (localStorage adapter)
// ═══════════════════════════════════════════════════════════════════

export const STORAGE_KEY = "ncp-state-v2";

/** Load the previously-saved planner state, or null if none. */
export function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

/**
 * Persist the planner state.
 * When persist=false, only writes {persist:false} so the next load
 * knows not to restore any state.
 */
export function saveState(persist, obj) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(persist ? { persist: true, ...obj } : { persist: false })
    );
  } catch {
    // quota exceeded — ignore silently
  }
}

/** Clear all planner persistence. */
export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
