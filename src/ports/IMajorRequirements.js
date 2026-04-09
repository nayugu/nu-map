// ═══════════════════════════════════════════════════════════════════
// PORT: IMajorRequirements
// Path-parsing helpers for the major/minor requirement data source.
// Full fetchMajor/fetchMinor I/O stays in the loaders (Vite glob constraint).
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IMajorRequirements = "majorRequirements";

/**
 * @typedef {Object} IMajorRequirements
 * @property {function(string): string} fmtLabel    - Convert a raw folder name to display label
 *                                                    e.g. "computer_science_(boston)" → "Computer Science"
 * @property {function(string): string} fmtLocation - Extract location tag from folder name
 *                                                    e.g. "computer_science_(boston)" → "Boston"
 *
 * Note: import.meta.glob() requires string literals at the call site (Vite static analysis).
 * Glob patterns must remain in majorLoader.js / minorLoader.js. This port owns the
 * path-parsing logic only.
 *
 * Future fields (Stage 2):
 *   fetchMajorList(): Promise<MajorOption[]>
 *   fetchMajor(path: string): Promise<Major>
 *   fetchMinorList(): Promise<MinorOption[]>
 *   fetchMinor(path: string): Promise<Minor>
 */
