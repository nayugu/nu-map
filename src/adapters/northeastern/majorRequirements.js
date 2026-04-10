// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/majorRequirements  (implements IMajorRequirements)
//
// Note: import.meta.glob() requires string literals at the call site
// (Vite static analysis).  The glob patterns must therefore remain in
// majorLoader.js / minorLoader.js.  getMajorOptions() and getMinorOptions()
// are thin wrappers around those loaders.
//
// auditMajor() / auditMinor() are not yet implemented here — GradPanel
// calls loadMajor() + gradRequirements.js directly (Stage 2 migration).
// ═══════════════════════════════════════════════════════════════════
import { getMajorOptions as _getMajorOptions, getMajorOptionGroups as _getMajorOptionGroups, loadMajor as _loadMajor } from "../../data/majorLoader.js";
import { getMinorOptions as _getMinorOptions, getMinorOptionGroups as _getMinorOptionGroups, loadMinor as _loadMinor } from "../../data/minorLoader.js";

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

// Self-reference passed to loaders so they can call fmtLabel/fmtLocation
const _self = { fmtLabel, fmtLocation };

/** @type {import('../../ports/IMajorRequirements.js').IMajorRequirements} */
export default {
  fmtLabel,
  fmtLocation,

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getMajorOptions() { return _getMajorOptions(_self); },

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getMinorOptions() { return _getMinorOptions(_self); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getMajorOptionGroups() { return _getMajorOptionGroups(_self); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getMinorOptionGroups() { return _getMinorOptionGroups(_self); },

  /** @returns {Promise<object>} Raw graduatenu Major2 JSON */
  loadMajor(path) { return _loadMajor(path); },

  /** @returns {Promise<object>} Raw graduatenu minor JSON */
  loadMinor(path) { return _loadMinor(path); },

  auditMajor(_id, _plan, _courseMap) {
    throw new Error("auditMajor() not yet implemented — GradPanel uses loadMajor() + gradRequirements.js directly.");
  },

  auditMinor(_id, _plan, _courseMap) {
    throw new Error("auditMinor() not yet implemented — GradPanel uses loadMinor() + gradRequirements.js directly.");
  },
};
