// ═══════════════════════════════════════════════════════════════════
// MAJOR LOADER  (data adapter — bridges graduatenu/packages/api JSON files)
//
// DATA SOURCE HISTORY
// ───────────────────
// Originally, all major/minor requirement JSON files came from the
// external/graduatenu git submodule (a fork of sandboxnu/graduatenu).
// This let us bootstrap quickly — the data was already there.
// The downside: we had no control over schema, coverage, or update cadence,
// and the submodule introduced a hard external dependency.
//
// We later built our own scraper (scripts/scrape-majors.js) that pulls
// directly from catalog.northeastern.edu and writes to src/data/majors/.
// Our scraped files take precedence over the external submodule on collision
// (same year/college/program path). The submodule remains as a fallback for
// programs not yet covered by the scraper.
//
// Goal: fully migrate to scraped data so the external submodule can be removed.
//
// IMPLEMENTATION NOTE
// ───────────────────
// Uses Vite's import.meta.glob for lazy, on-demand loading of the
// parsed.initial.json files.  Only the selected major's JSON is ever
// fetched; the other 1400+ paths stay as stubs.
// import.meta.glob requires static string literals at the call site.
// ═══════════════════════════════════════════════════════════════════

// Lazy stubs from the legacy external/graduatenu submodule (fallback).
const _externalMap = import.meta.glob(
  '../../external/graduatenu/packages/api/src/major/majors/**/parsed.initial.json',
  { eager: false }
);

// Lazy stubs from our own scraper output (src/data/majors/).
// import.meta.glob requires static string literals — two separate calls, merged below.
const _scrapedMap = import.meta.glob(
  './majors/**/parsed.initial.json',
  { eager: false }
);

// Scraped entries win on collision — own data preferred over external submodule.
const _moduleMap = { ..._externalMap, ..._scrapedMap };

// Graduate program data (src/data/grad-majors/).
const _gradMap = import.meta.glob(
  './grad-majors/**/parsed.initial.json',
  { eager: false }
);

// ── Internal helpers ─────────────────────────────────────────────

/**
 * Parse the year/college/folder segments out of a module map path.
 * Returns null if no 4-digit year segment is found.
 */
function parseMajorPathParts(path) {
  const parts = path.split('/');
  let yearIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
  }
  if (yearIdx < 0) return null;
  return {
    year:    parseInt(parts[yearIdx], 10),
    college: parts[yearIdx + 1] ?? '',
    folder:  parts[yearIdx + 2] ?? '',
  };
}

/**
 * Normalize a program folder slug so cosmetic catalog renames still match:
 * lowercases, maps "&"→"and", and strips everything but the alphanumeric core
 * (underscores, parentheses, the "_(boston)" campus suffix, spacing, commas).
 */
export function normalizeFolder(folder) {
  return folder
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Resolve a (possibly stale) saved path to the best CURRENT registry path,
 * or null if no plausible match exists. Tiers, newest year wins at each:
 *   1. exact path                          — program unchanged
 *   2. legacy submodule prefix             — paths from before the reorg
 *   3. same college + folder               — catalog-year bump
 *   4. same folder, any college            — program moved colleges
 *   5. normalized folder (± college)       — program slug renamed
 *
 * @param {Record<string, unknown>} map  - a Vite import.meta.glob module map
 * @param {string} path
 * @param {(p: string) => {year:number,college:string,folder:string}|null} parse
 * @returns {string|null}
 */
export function resolveInMap(map, path, parse) {
  if (map[path]) return path;
  const migrated = path.replace(/^\.\.\/\.\.\/graduatenu\//, '../../external/graduatenu/');
  if (map[migrated]) return migrated;

  const want = parse(path);
  if (!want) return null;

  const entries = Object.keys(map)
    .map(p => ({ p, pp: parse(p) }))
    .filter(e => e.pp);

  const newestWhere = (pred) => {
    let best = null, bestYear = -Infinity;
    for (const { p, pp } of entries) {
      if (pred(pp) && pp.year > bestYear) { bestYear = pp.year; best = p; }
    }
    return best;
  };

  const wantNorm = normalizeFolder(want.folder);
  return (
    newestWhere(pp => pp.college === want.college && pp.folder === want.folder) ||
    newestWhere(pp => pp.folder === want.folder) ||
    newestWhere(pp => pp.college === want.college && normalizeFolder(pp.folder) === wantNorm) ||
    newestWhere(pp => normalizeFolder(pp.folder) === wantNorm) ||
    null
  );
}

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

  const { fmtLabel, fmtLocation } = majorRequirements;
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
      const label       = fmtLabel(folder);
      const location    = fmtLocation(folder);
      const collegeLabel = fmtLabel(college);

      return { path, year, college, collegeLabel, folder, label, location };
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
    const key = `${opt.year} — ${opt.collegeLabel}`;
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

  const { fmtLabel, fmtLocation } = majorRequirements;
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
      const label       = fmtLabel(folder);
      const location    = fmtLocation(folder);
      const collegeLabel = fmtLabel(college);

      return { path, year, college, collegeLabel, folder, label, location };
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
    const key = `${opt.year} — ${opt.collegeLabel}`;
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
