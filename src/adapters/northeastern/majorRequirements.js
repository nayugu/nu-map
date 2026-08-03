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
// The scraper fully replaced the submodule, which has been removed;
// scraped data is now the sole source (see majorLoader.js).
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

// Label formatting lives in programNaming.js (pure, shared with the Node
// program registry). Re-exported so existing importers keep working.
import { fmtLabel, fmtLocation, fmtProgramLabel, parseProgram } from './programNaming.js';
export { fmtLabel, fmtLocation, fmtProgramLabel, parseProgram };

// Self-reference passed to loaders so they can call the naming helpers
const _self = { fmtLabel, fmtLocation, fmtProgramLabel, parseProgram };

/** @type {import('../../ports/IMajorRequirements.js').IMajorRequirements} */
export default {
  fmtLabel,
  fmtLocation,
  fmtProgramLabel,
  parseProgram,

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getMajorOptions(cohortYear) { return _getMajorOptions(_self, cohortYear); },

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getMinorOptions(cohortYear) { return _getMinorOptions(_self, cohortYear); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getMajorOptionGroups(cohortYear) { return _getMajorOptionGroups(_self, cohortYear); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getMinorOptionGroups(cohortYear) { return _getMinorOptionGroups(_self, cohortYear); },

  /** @returns {Promise<object>} Raw graduatenu Major2 JSON */
  loadMajor(path) { return _loadMajor(path); },

  /** @returns {Promise<object>} Raw graduatenu minor JSON */
  loadMinor(path) { return _loadMinor(path); },

  /** @returns {import('../../ports/IMajorRequirements.js').ProgramOption[]} */
  getGradMajorOptions(cohortYear) { return _getGradMajorOptions(_self, cohortYear); },

  /** @returns {Map<string, import('../../ports/IMajorRequirements.js').ProgramOption[]>} */
  getGradMajorOptionGroups(cohortYear) { return _getGradMajorOptionGroups(_self, cohortYear); },

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
        usedFor: "major/minor requirement definitions",
      },
    ];
  },
};
