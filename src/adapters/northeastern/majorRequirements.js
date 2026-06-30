// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/majorRequirements  (implements IMajorRequirements)
//
// DATA SOURCE HISTORY
// ───────────────────
// Major/minor requirement JSON files originally came entirely from the
// external/graduatenu git submodule (sandboxnu/graduatenu fork). This was
// chosen for speed — the data already existed and the schema was known.
// The trade-off was no control over coverage, accuracy, or update cadence.
//
// We later built scripts/scrape-majors.js to pull major requirements
// directly from catalog.northeastern.edu, writing to src/data/majors/.
// Our scraped files now take precedence over the external submodule for
// any program both sources cover (see majorLoader.js). The external
// submodule remains as a fallback for programs not yet scraped.
//
// Minors: not yet migrated — all minor data still comes from the submodule.
//
// IMPLEMENTATION NOTES
// ────────────────────
// import.meta.glob() requires string literals at the call site (Vite static
// analysis). The glob patterns therefore live in majorLoader.js / minorLoader.js.
// getMajorOptions() and getMinorOptions() are thin wrappers around those loaders.
//
// auditMajor() / auditMinor() are not yet implemented here — GradPanel
// calls loadMajor() + gradRequirements.js directly (Stage 2 migration).
// ═══════════════════════════════════════════════════════════════════
import { getMajorOptions as _getMajorOptions, getMajorOptionGroups as _getMajorOptionGroups, loadMajor as _loadMajor, getGradMajorOptions as _getGradMajorOptions, getGradMajorOptionGroups as _getGradMajorOptionGroups, loadGradMajor as _loadGradMajor } from "../../data/majorLoader.js";
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

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getGradMajorOptions() { return _getGradMajorOptions(_self); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getGradMajorOptionGroups() { return _getGradMajorOptionGroups(_self); },

  /** @returns {Promise<object>} Raw graduate program JSON */
  loadGradMajor(path) { return _loadGradMajor(path); },

  auditMajor(_id, _plan, _courseMap) {
    throw new Error("auditMajor() not yet implemented — GradPanel uses loadMajor() + gradRequirements.js directly.");
  },

  auditMinor(_id, _plan, _courseMap) {
    throw new Error("auditMinor() not yet implemented — GradPanel uses loadMinor() + gradRequirements.js directly.");
  },

  auditGradMajor(_id, _plan, _courseMap) {
    throw new Error("auditGradMajor() not yet implemented — GradPanel uses loadGradMajor() + gradRequirements.js directly.");
  },

  getSources() {
    return [
      {
        id:      "catalog-majors",
        label:   "catalog.northeastern.edu",
        url:     "https://catalog.northeastern.edu/",
        usedFor: "major requirement definitions (scraped, preferred)",
      },
      {
        id:      "graduatenu",
        label:   "sandboxnu/graduatenu",
        url:     "https://github.com/sandboxnu/graduatenu",
        author:  "sandboxnu",
        usedFor: "major/minor requirement definitions (external submodule fallback)",
      },
    ];
  },
};
