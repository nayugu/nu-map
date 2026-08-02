// ═══════════════════════════════════════════════════════════════════
// MAJOR LOADER  (data adapter — bridges graduatenu/packages/api JSON files)
//
// DATA SOURCE HISTORY
// ───────────────────
// Originally, all major/minor requirement JSON files came from an
// external/graduatenu git submodule (a fork of sandboxnu/graduatenu) —
// a bootstrap shortcut with no control over schema, coverage, or cadence.
// Our own scraper (scripts/scrape-majors.js) pulls directly from
// catalog.northeastern.edu and writes to src/data/majors/; it fully
// replaced the submodule, which has been removed. Saved plans may still
// hold old submodule paths — resolveInMap (programPaths.js) migrates them.
//
// IMPLEMENTATION NOTE
// ───────────────────
// Uses Vite's import.meta.glob for lazy, on-demand loading of the
// parsed.initial.json files.  Only the selected major's JSON is ever
// fetched; the other paths stay as stubs.
// import.meta.glob requires static string literals at the call site.
// ═══════════════════════════════════════════════════════════════════

// Lazy stubs from our own scraper output (src/data/majors/).
const _moduleMap = import.meta.glob(
  './majors/**/parsed.initial.json',
  { eager: false }
);

// Graduate program data (src/data/grad-majors/).
const _gradMap = import.meta.glob(
  './grad-majors/**/parsed.initial.json',
  { eager: false }
);

// ── Internal helpers ─────────────────────────────────────────────

// Path parsing/resolution helpers live in programPaths.js (pure, shared
// with the Node program registry). Re-exported for existing importers.
import { parseMajorPathParts, normalizeFolder, resolveInMap } from './programPaths.js';
export { normalizeFolder, resolveInMap };

// ── Public API ───────────────────────────────────────────────────
// Path-parsing helpers (fmtLabel, fmtLocation) come from the
// majorRequirements port passed by the caller — not imported directly
// from a specific adapter, preserving institution-agnosticism here.

let _cachedOptions      = null;
let _cachedMajorReqs    = null;
let _cachedGradOptions  = null;
let _cachedGradMajorReqs = null;

/**
 * Returns the full list of available major options derived from file paths.
 * No JSON is loaded; only the Vite module registry is consulted.
 *
 * Each option: { path, year, college, collegeLabel, folder, label, location }
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMajorOptions(majorRequirements) {
  // Re-derive if the adapter changed (different institution)
  if (_cachedOptions && _cachedMajorReqs === majorRequirements) return _cachedOptions;

  const { fmtLabel, parseProgram } = majorRequirements;
  _cachedMajorReqs = majorRequirements;
  _cachedOptions = Object.keys(_moduleMap)
    .map(path => {
      const parts = path.split('/');
      // Find the first segment that looks like a 4-digit catalog year
      let yearIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
      }
      if (yearIdx < 0) return null;

      const year        = parseInt(parts[yearIdx], 10);
      const college     = parts[yearIdx + 1] ?? '';
      const folder      = parts[yearIdx + 2] ?? '';
      if (folder.endsWith('_minor')) return null; // minors live in the minor search
      // name/degree/acronyms are what searchRank scores against; label is the
      // catalog's own rendering of the two, e.g. "Computer Science, BSCS".
      const { name, degree, location, acronyms } = parseProgram(folder);
      const label        = degree ? `${name}, ${degree}` : name;
      const collegeLabel = fmtLabel(college);

      return { path, year, college, collegeLabel, folder, label, location, name, degree, acronyms };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.year - a.year ||
      a.college.localeCompare(b.college) ||
      a.label.localeCompare(b.label)
    )
    .filter((opt, _, arr) =>
      arr.findIndex(o => o.college === opt.college && o.folder === opt.folder) === arr.indexOf(opt)
    );

  return _cachedOptions;
}

/**
 * Group options by "YYYY — College Label" for use in <optgroup> selectors.
 * Returns an ordered Map<groupKey, options[]>.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMajorOptionGroups(majorRequirements) {
  const map = new Map();
  for (const opt of getMajorOptions(majorRequirements)) {
    const key = `${opt.year} · ${opt.collegeLabel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(opt);
  }
  return map;
}

/**
 * Migrate a major path to a known registry entry.
 * Falls back to the newest available (college, folder) match if the exact
 * path (including year) is not found — handles saved plans from older catalog years.
 */
/** Resolve a saved undergrad major path to its current registry path, or null. */
export function resolveMajorPath(path) {
  return resolveInMap(_moduleMap, path, parseMajorPathParts);
}

export function canonicalizeMajorPath(path) {
  return resolveMajorPath(path) ?? path;
}

/**
 * Check whether a newer catalog-year version of a major exists.
 * Returns the newer path string, or null if the given path is already the latest.
 *
 * @param {string} currentPath  - path from getMajorOptions or saved plan state
 * @returns {string|null}
 */
export function findNewerMajorVersion(currentPath) {
  const canonical = canonicalizeMajorPath(currentPath);
  const current = parseMajorPathParts(canonical);
  if (!current) return null;

  let newestPath = null;
  let newestYear = current.year;

  for (const path of Object.keys(_moduleMap)) {
    const pp = parseMajorPathParts(path);
    if (!pp) continue;
    if (pp.college === current.college && pp.folder === current.folder && pp.year > newestYear) {
      newestYear = pp.year;
      newestPath = path;
    }
  }

  return newestPath;
}

export async function loadMajor(path) {
  const canonical = canonicalizeMajorPath(path);
  const fn = _moduleMap[canonical];
  if (!fn) throw new Error(`Major not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}

// ── Graduate major functions (mirror of undergrad above) ─────────────────────

/**
 * Returns the full list of available graduate major options derived from file paths.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getGradMajorOptions(majorRequirements) {
  if (_cachedGradOptions && _cachedGradMajorReqs === majorRequirements) return _cachedGradOptions;

  const { fmtLabel, parseProgram } = majorRequirements;
  _cachedGradMajorReqs = majorRequirements;
  _cachedGradOptions = Object.keys(_gradMap)
    .map(path => {
      const parts = path.split('/');
      let yearIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
      }
      if (yearIdx < 0) return null;

      const year        = parseInt(parts[yearIdx], 10);
      const college     = parts[yearIdx + 1] ?? '';
      const folder      = parts[yearIdx + 2] ?? '';
      const { name, degree, location, acronyms } = parseProgram(folder);
      const label        = degree ? `${name}, ${degree}` : name;
      const collegeLabel = fmtLabel(college);

      return { path, year, college, collegeLabel, folder, label, location, name, degree, acronyms };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.year - a.year ||
      a.college.localeCompare(b.college) ||
      a.label.localeCompare(b.label)
    )
    .filter((opt, _, arr) =>
      arr.findIndex(o => o.college === opt.college && o.folder === opt.folder) === arr.indexOf(opt)
    );

  return _cachedGradOptions;
}

/**
 * Group graduate options by "YYYY — College Label" for use in <optgroup> selectors.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getGradMajorOptionGroups(majorRequirements) {
  const map = new Map();
  for (const opt of getGradMajorOptions(majorRequirements)) {
    const key = `${opt.year} · ${opt.collegeLabel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(opt);
  }
  return map;
}

/** Resolve a saved graduate major path to its current registry path, or null. */
export function resolveGradMajorPath(path) {
  return resolveInMap(_gradMap, path, parseMajorPathParts);
}

export function canonicalizeGradMajorPath(path) {
  return resolveGradMajorPath(path) ?? path;
}

/**
 * Check whether a newer catalog-year version of a graduate major exists.
 */
export function findNewerGradMajorVersion(currentPath) {
  const canonical = canonicalizeGradMajorPath(currentPath);
  const current = parseMajorPathParts(canonical);
  if (!current) return null;

  let newestPath = null;
  let newestYear = current.year;

  for (const path of Object.keys(_gradMap)) {
    const pp = parseMajorPathParts(path);
    if (!pp) continue;
    if (pp.college === current.college && pp.folder === current.folder && pp.year > newestYear) {
      newestYear = pp.year;
      newestPath = path;
    }
  }

  return newestPath;
}

export async function loadGradMajor(path) {
  const canonical = canonicalizeGradMajorPath(path);
  const fn = _gradMap[canonical];
  if (!fn) throw new Error(`Graduate major not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}
