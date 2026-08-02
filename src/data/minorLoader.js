// ═══════════════════════════════════════════════════════════════════
// MINOR LOADER  (data adapter — bridges graduatenu minor JSON files)
//
// DATA SOURCE HISTORY
// ───────────────────
// Same history as majorLoader.js: minor data originally came from an
// external/graduatenu submodule (since removed). The scraper
// (scripts/scrape-majors.js) outputs minors alongside majors into
// src/data/majors/ — any folder ending in _minor is a minor program.
// ═══════════════════════════════════════════════════════════════════

import { resolveInMap } from './majorLoader.js';

// Scraped minors live alongside scraped majors; folder names end with _minor.
const _moduleMap = import.meta.glob(
  './majors/**/*_minor/parsed.initial.json',
  { eager: false }
);

// ── Internal helpers ─────────────────────────────────────────────

function parseMinorPathParts(path) {
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

  const { fmtLabel, parseProgram } = majorRequirements;
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
    );

  return _cachedOptions;
}

/**
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMinorOptionGroups(majorRequirements) {
  const map = new Map();
  for (const opt of getMinorOptions(majorRequirements)) {
    const key = `${opt.year} · ${opt.collegeLabel}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(opt);
  }
  return map;
}

/** Resolve a saved minor path to its current registry path, or null. */
export function resolveMinorPath(path) {
  return resolveInMap(_moduleMap, path, parseMinorPathParts);
}

export function canonicalizeMinorPath(path) {
  return resolveMinorPath(path) ?? path;
}

export async function loadMinor(path) {
  const canonical = canonicalizeMinorPath(path);
  const fn = _moduleMap[canonical];
  if (!fn) throw new Error(`Minor not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}
