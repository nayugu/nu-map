// ═══════════════════════════════════════════════════════════════════
// STORAGE HEALTH — the one failure in this app that cannot be undone
//
// Every plan a student builds lives in this browser and nowhere else. There is no
// account and no server copy, which is a deliberate privacy position and also means
// the failure modes are unusually final: a full store stops saving, and an evicted
// origin loses everything at once. Neither announces itself.
//
// ── What this can and cannot protect against ────────────────────────
//
// It is worth being exact, because "storage alarm" sounds like it covers more than
// it does:
//
//   AUTOMATIC EVICTION — the browser reclaiming a "best effort" origin when the disk
//     is under pressure. PREVENTABLE, and `requestPersistence` is the whole fix:
//     a persisted origin is not evicted automatically.
//   A FULL STORE — writes beginning to fail while the UI still shows the edit.
//     DETECTABLE in advance, which is what `storagePressure` is for.
//   THE USER CLEARING SITE DATA — deliberate, irreversible, and NOT interceptable by
//     any page. No alarm can help; only an exported file can, which is why
//     `libraryBackup.js` exists and why this module never claims to cover it.
//
// Saying so here rather than in a commit message, because the next person to read
// this will otherwise assume the third case is handled.
//
// ── Why the alarm is quiet by default ───────────────────────────────
//
// `navigator.storage.persisted()` is false for most origins most of the time —
// Chrome grants persistence silently on an engagement heuristic, Firefox prompts,
// Safari's support is partial. Showing a banner whenever it is false would mean
// showing it to nearly everyone, forever, about a risk that has not materialised.
// That is how a warning becomes wallpaper.
//
// So persistence is REQUESTED silently, with no UI at all, and the user is only
// interrupted when the numbers say something is actually wrong.
// ═══════════════════════════════════════════════════════════════════

/**
 * Ask the browser to keep this origin's data.
 *
 * Best-effort and fire-and-forget: a granted request removes the automatic-eviction
 * risk entirely, a denied one leaves us exactly where we were, and there is nothing
 * useful to tell the user in either case. Every call is guarded because the whole
 * `navigator.storage` surface is absent in older Safari and in some embedded
 * webviews, and a planner must not fail to load over a diagnostic.
 *
 * @returns {Promise<boolean|null>} granted, or null when the API does not exist
 */
export async function requestPersistence() {
  try {
    if (!navigator?.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/**
 * How close this origin is to its quota.
 *
 * `estimate()` is deliberately imprecise — browsers pad and round it to avoid
 * fingerprinting — so this is a pressure signal and never an exact accounting. That
 * is why the threshold below is not tight.
 *
 * @returns {Promise<{usage: number, quota: number, ratio: number}|null>}
 */
export async function storageEstimate() {
  try {
    if (!navigator?.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!(quota > 0) || !(usage >= 0)) return null;
    return { usage, quota, ratio: usage / quota };
  } catch {
    return null;
  }
}

/**
 * The share of quota at which the user is warned.
 *
 * 0.8 rather than something tighter, for two reasons that point the same way: the
 * estimate is padded, and the warning has to arrive while there is still room to act.
 * A message that appears at 0.99 is a message that appears after the first edit was
 * already lost.
 */
export const PRESSURE_RATIO = 0.8;

/**
 * Is there something worth interrupting the student about?
 *
 * `failedWrite` is the strongest signal by a distance and is checked first: it is not
 * a prediction, it is an edit that did not save. Everything else here is inference.
 *
 * Returns null when there is nothing to say, which is the overwhelmingly common case
 * and the one the caller should be cheapest about.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.failedWrite]  a write has already been rejected for quota
 * @returns {Promise<{kind: 'full'|'pressure', ratio: number|null}|null>}
 */
export async function storagePressure({ failedWrite = false } = {}) {
  if (failedWrite) return { kind: "full", ratio: null };
  const est = await storageEstimate();
  if (!est) return null;
  return est.ratio >= PRESSURE_RATIO ? { kind: "pressure", ratio: est.ratio } : null;
}
