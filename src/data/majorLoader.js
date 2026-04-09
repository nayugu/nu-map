// ═══════════════════════════════════════════════════════════════════
// MAJOR LOADER  (data adapter — bridges graduatenu/packages/api JSON files)
//
// Uses Vite's import.meta.glob for lazy, on-demand loading of the
// parsed.initial.json files in the graduatenu fork.  Only the selected
// major's JSON is ever fetched; the other 1400+ paths stay as stubs.
// ═══════════════════════════════════════════════════════════════════

// Lazy stubs for every parsed.initial.json in the graduatenu majors tree.
// Paths are relative to this file (src/data/).
const _moduleMap = import.meta.glob(
  '../../external/graduatenu/packages/api/src/major/majors/**/parsed.initial.json',
  { eager: false }
);

// ── Public API ───────────────────────────────────────────────────
// Path-parsing helpers (fmtLabel, fmtLocation) come from the
// majorRequirements port passed by the caller — not imported directly
// from a specific adapter, preserving institution-agnosticism here.

let _cachedOptions     = null;
let _cachedMajorReqs   = null;

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
 * Lazily load the Major2 JSON for a given path (from getMajorOptions).
 * Returns the parsed object (matches graduatenu Major2 schema).
 */
/**
 * Migrate a major path from before the external/ submodule reorganisation.
 * Returns the canonical path as it exists in the current registry.
 */
export function canonicalizeMajorPath(path) {
  if (_moduleMap[path]) return path;
  const migrated = path.replace(/^\.\.\/\.\.\/graduatenu\//, '../../external/graduatenu/');
  return _moduleMap[migrated] ? migrated : path;
}

export async function loadMajor(path) {
  const canonical = canonicalizeMajorPath(path);
  const fn = _moduleMap[canonical];
  if (!fn) throw new Error(`Major not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}
