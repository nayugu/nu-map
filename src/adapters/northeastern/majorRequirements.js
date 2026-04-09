// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/majorRequirements  (implements IMajorRequirements)
//
// Note: import.meta.glob() requires string literals at the call site
// (Vite static analysis).  The glob patterns must therefore remain in
// majorLoader.js / minorLoader.js.  This adapter owns only the
// path-parsing helpers so that logic isn't duplicated between the two
// loaders.
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a snake_case / hyphenated folder name into a readable label.
 * Strips location tags like "(boston)" or "(oakland)".
 *
 * @param {string} raw  - folder name, e.g. "computer_science_(boston)"
 * @returns {string}     e.g. "Computer Science"
 */
export function fmtLabel(raw) {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\([^)]*\)/g, '')
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
 *
 * @param {string} folder  - e.g. "computer_science_(boston)"
 * @returns {string}        e.g. "Boston" (empty string if no tag)
 */
export function fmtLocation(folder) {
  const m = folder.match(/\(([^)]+)\)/);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
}

/** @type {import('../../ports/IMajorRequirements.js').IMajorRequirements} */
export default { fmtLabel, fmtLocation };
