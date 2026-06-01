// ═══════════════════════════════════════════════════════════════════
// ONE-TIME MIGRATION  nayugu.github.io  →  numap.app
//
// localStorage is origin-scoped, so data can't be copied server-side.
// Instead: on the OLD origin, a banner encodes all prefixed keys into
// a base64 blob and redirects to numap.app/?migrate=<blob>.
// On the NEW origin, this module decodes the blob, writes the keys,
// cleans the URL, and reloads so PlannerContext starts with fresh data.
// ═══════════════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'ncp-';
const OLD_HOST       = 'nayugu.github.io';
const NEW_ORIGIN     = 'https://numap.app';
const PARAM          = 'migrate';

function encode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

function decode(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

/**
 * Call before React renders.
 * If ?migrate= is present: import data into localStorage, clean URL, reload.
 * Returns true if a reload was triggered (caller should not render).
 */
export function applyMigrationIfPresent() {
  try {
    const params = new URLSearchParams(window.location.search);
    const blob = params.get(PARAM);
    if (!blob) return false;

    const entries = decode(blob);
    for (const [k, v] of Object.entries(entries)) {
      if (typeof k === 'string' && typeof v === 'string') {
        localStorage.setItem(k, v);
      }
    }

    params.delete(PARAM);
    const clean = window.location.pathname + (params.size ? '?' + params.toString() : '');
    window.history.replaceState({}, '', clean);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

const MIGRATED_KEY = `${STORAGE_PREFIX}migrated`;

/** True when running on the old domain and there is data worth migrating. */
export function hasMigratableData() {
  if (window.location.hostname !== OLD_HOST) return false;
  if (localStorage.getItem(MIGRATED_KEY) === '1') return false;
  return Object.keys(localStorage).some(k => k.startsWith(STORAGE_PREFIX));
}

/** Encode all prefixed localStorage keys and redirect to numap.app. */
export function migrateToNewDomain() {
  const entries = {};
  for (const [k, v] of Object.entries(localStorage)) {
    if (k.startsWith(STORAGE_PREFIX)) entries[k] = v;
  }
  localStorage.setItem(MIGRATED_KEY, '1');
  window.location.href = `${NEW_ORIGIN}/?${PARAM}=${encode(entries)}`;
}
