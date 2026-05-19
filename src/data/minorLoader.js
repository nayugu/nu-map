// ═══════════════════════════════════════════════════════════════════
// MINOR LOADER  (data adapter — bridges graduatenu minor JSON files)
//
// DATA SOURCE HISTORY
// ───────────────────
// Same history as majorLoader.js: minor data originally came from the
// external/graduatenu submodule for speed of development. Unlike majors,
// minors have not yet been migrated to our own scraper — all minor data
// still comes from the external submodule.
//
// When scripts/scrape-majors.js is extended to cover minors, add a
// _scrapedMap glob pointing to src/data/minors/ and merge it in the
// same way majorLoader.js does (scraped wins on collision).
// ═══════════════════════════════════════════════════════════════════

// All minor data still comes from the external/graduatenu submodule.
// Pending: migrate to own scraper (see majorLoader.js for the pattern).
const _moduleMap = import.meta.glob(
  '../../external/graduatenu/packages/api/src/minor/minors/**/parsed.initial.json',
  { eager: false }
);

// ── Public API ───────────────────────────────────────────────────
// Path-parsing helpers (fmtLabel, fmtLocation) come from the
// majorRequirements port passed by the caller — same port as majors.

let _cachedOptions   = null;
let _cachedMajorReqs = null;

/**
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMinorOptions(majorRequirements) {
  if (_cachedOptions && _cachedMajorReqs === majorRequirements) return _cachedOptions;

  const { fmtLabel, fmtLocation } = majorRequirements;
  _cachedMajorReqs = majorRequirements;
  _cachedOptions = Object.keys(_moduleMap)
    .map(path => {
      const parts = path.split('/');
      let yearIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
      }
      if (yearIdx < 0) return null;

      const year         = parseInt(parts[yearIdx], 10);
      const college      = parts[yearIdx + 1] ?? '';
      const folder       = parts[yearIdx + 2] ?? '';
      const label        = fmtLabel(folder);
      const location     = fmtLocation(folder);
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
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMinorOptionGroups(majorRequirements) {
  const map = new Map();
  for (const opt of getMinorOptions(majorRequirements)) {
    const key = `${opt.year} — ${opt.collegeLabel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(opt);
  }
  return map;
}

export function canonicalizeMinorPath(path) {
  if (_moduleMap[path]) return path;
  const migrated = path.replace(/^\.\.\/\.\.\/graduatenu\//, '../../external/graduatenu/');
  return _moduleMap[migrated] ? migrated : path;
}

export async function loadMinor(path) {
  const canonical = canonicalizeMinorPath(path);
  const fn = _moduleMap[canonical];
  if (!fn) throw new Error(`Minor not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}
