// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/majorRequirements  (implements IMajorRequirements)
//
// Default: simple title-case conversion, no location extraction.
// Handles snake_case and hyphenated folder names.
//
// Override when your data source uses location-tagged folder names
// like "computer_science_(boston)" that need special parsing.
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a snake_case / hyphenated folder name to a readable label.
 * Short all-lowercase words (≤3 chars) are uppercased as acronyms.
 *
 * @param {string} raw  - e.g. "computer_science" or "bs-cs"
 * @returns {string}     e.g. "Computer Science"
 */
export function fmtLabel(raw) {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.length <= 3 && w === w.toLowerCase()
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Extract a location tag from a folder name.
 * Generic default: no location concept — always returns empty string.
 *
 * @returns {string} ""
 */
export function fmtLocation() { return ''; }

/** @type {import('../../ports/IMajorRequirements.js').IMajorRequirements} */
export default {
  fmtLabel,
  fmtLocation,

  /** No program data in generic adapter — returns empty list. */
  getMajorOptions() { return Promise.resolve([]); },

  /** No program data in generic adapter — returns empty list. */
  getMinorOptions() { return Promise.resolve([]); },

  auditMajor(_id, _plan, _courseMap) {
    throw new Error("auditMajor() not implemented in generic adapter.");
  },

  auditMinor(_id, _plan, _courseMap) {
    throw new Error("auditMinor() not implemented in generic adapter.");
  },
};
