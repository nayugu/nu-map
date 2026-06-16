// ═══════════════════════════════════════════════════════════════════
// PORT: IClock
// Provides the current point in time to the application core.
//
// In production this is simply new Date().  In dev/test, a simulated
// adapter can return a fixed or manually-controlled date so that
// time-sensitive features (semester tracking modes, safeStartDay
// thresholds, Banner term-past checks) can be exercised without
// waiting for real-world dates to arrive.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IClock = "clock";

/**
 * @typedef {Object} IClock
 *
 * @property {() => Date} now
 *   Returns the current point in time.  The production adapter returns
 *   `new Date()`; a dev/test adapter may return a simulated date.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   Attribution sources for this adapter.  See IAttributable.
 */
