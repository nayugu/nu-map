// ═══════════════════════════════════════════════════════════════════
// MAJOR LOADER  (data adapter — bridges graduatenu/packages/api JSON files)
//
// DATA SOURCE HISTORY
// ───────────────────
// Originally, all major/minor requirement JSON files came from an
// external/graduatenu git submodule (a fork of sandboxnu/graduatenu) —
// a bootstrap shortcut with no control over schema, coverage, or cadence.
// Our own scraper (scripts/scrape-majors.js) pulls directly from
// catalog.northeastern.edu and writes to data/northeastern/programs/undergraduate/; it fully
// replaced the submodule, which has been removed. Saved plans may still
// hold old submodule paths — resolveInMap (programPaths.js) migrates them.
//
// IMPLEMENTATION NOTE
// ───────────────────
// Uses Vite's import.meta.glob for lazy, on-demand loading of the
// requirements.json files.  Only the selected major's JSON is ever
// fetched; the other paths stay as stubs.
// import.meta.glob requires static string literals at the call site.
// ═══════════════════════════════════════════════════════════════════

// Lazy stubs from our own scraper output (data/northeastern/programs/undergraduate/).
const _moduleMap = import.meta.glob(
  '../../data/northeastern/programs/undergraduate/**/requirements.json',
  { eager: false }
);

// Graduate program data (data/northeastern/programs/graduate/).
const _gradMap = import.meta.glob(
  '../../data/northeastern/programs/graduate/**/requirements.json',
  { eager: false }
);

// ── Internal helpers ─────────────────────────────────────────────

// Path parsing/resolution helpers live in programPaths.js (pure, shared
// with the Node program registry). Re-exported for existing importers.
// `atCohortYear` and `findCohortVersion` live in programPaths.js rather than
// here: both are pure functions of a path-keyed map, and this file cannot be
// imported under Node at all (`import.meta.glob` is a Vite transform), so a
// rule kept here is a rule no unit test can reach. That is not hypothetical —
// the newer-vs-cohort defect this pair replaced survived four months in a file
// nothing could test.
import { parseMajorPathParts, normalizeFolder, resolveInMap, atCohortYear, findCohortVersion,
         editionsOf, editionLabel } from './programPaths.js';
export { normalizeFolder, resolveInMap, atCohortYear };

/**
 * Which registry a path belongs to, decided by the path ITSELF.
 *
 * Not by trying `resolveInMap` against each in turn: that helper's later tiers
 * match on a normalized folder with no college, so a graduate path could
 * fuzzily land in the undergraduate map and be answered with another degree's
 * editions. The directory segment is unambiguous and free.
 */
function mapFor(path) {
  return /\/graduate\//.test(String(path)) ? _gradMap : _moduleMap;
}

/**
 * The requirements map a path belongs to, for the one other loader that has to
 * resolve against the SAME registry this one does.
 *
 * `samplePlanLoader` needs it: a plan is only ever the sibling of the
 * requirements record that actually loaded, so resolving it against a second,
 * separately-declared glob would reintroduce exactly the drift the rule exists
 * to prevent (see `planKeyFor` in programPaths.js). Exported rather than
 * re-globbed so there is one registry, not two that agree today.
 */
export function programMapFor(path) {
  return mapFor(path);
}

/**
 * Everything the year selector needs about one declared program, in one call.
 *
 * Returned together rather than as three port methods because the three answers
 * have to be consistent with each other — the offered editions, the one this
 * cohort follows, and the one currently in use are all read off the same map in
 * the same pass. Split across calls they can disagree, and the disagreement
 * shows up as a hint naming an edition the dropdown does not list.
 *
 * `cohortPath` is null when the program is already on its cohort's edition,
 * which is the common case and the one that renders no hint at all.
 *
 * @param {string} path
 * @param {number} cohortYear
 * @returns {{editions: {year:number,label:string,path:string}[],
 *            cohortPath: string|null, cohortLabel: string, currentYear: number|null}}
 */
export function programEditions(path, cohortYear) {
  const empty = { editions: [], cohortPath: null, cohortLabel: '', currentYear: null };
  if (!path) return empty;
  const map = mapFor(path);
  const canonical = resolveInMap(map, path, parseMajorPathParts) ?? path;
  const currentYear = parseMajorPathParts(canonical)?.year ?? null;
  const cohortPath = findCohortVersion(map, path, cohortYear);
  return {
    editions: editionsOf(map, canonical).map(e => ({ ...e, label: editionLabel(e.year) })),
    cohortPath,
    cohortLabel: cohortPath ? editionLabel(parseMajorPathParts(cohortPath)?.year) : '',
    currentYear,
  };
}

/**
 * One dropdown option, derived from a module-map path alone. No JSON is read.
 *
 * Extracted because the three option builders below (undergrad, graduate,
 * minor) carried a byte-identical copy of it, which is how a naming fix lands
 * in one list and not the others — the same reason `program-record.js` exists
 * on the scraper side. `describeProgramPath` needs a fourth caller of exactly
 * this logic, and adding it as a fourth copy is what forced the extraction.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 * @param {string} path
 * @returns {object|null} null when the path carries no catalog-year segment
 */
export function optionFromPath(majorRequirements, path) {
  const { fmtLabel, parseProgram } = majorRequirements;
  const parts = path.split('/');
  // Find the first segment that looks like a 4-digit catalog year
  let yearIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^\d{4}$/.test(parts[i])) { yearIdx = i; break; }
  }
  if (yearIdx < 0) return null;

  const year    = parseInt(parts[yearIdx], 10);
  const college = parts[yearIdx + 1] ?? '';
  const folder  = parts[yearIdx + 2] ?? '';
  // name/degree/acronyms are what searchRank scores against; label is the
  // catalog's own rendering of the two, e.g. "Computer Science, BSCS".
  const { name, degree, location, acronym, acronyms } = parseProgram(folder);
  const label        = degree ? `${name}, ${degree}` : name;
  const collegeLabel = fmtLabel(college);

  return { path, year, college, collegeLabel, folder, label, location, name, degree, acronym, acronyms };
}

// ── Public API ───────────────────────────────────────────────────
// Naming helpers (fmtLabel, parseProgram) come from the majorRequirements
// port passed by the caller — not imported directly from a specific adapter,
// preserving institution-agnosticism here.

let _cachedOptions      = null;
let _cachedMajorReqs    = null;
let _cachedCohort       = undefined;   // cohort catalog year the cache was built for
let _cachedGradCohort   = undefined;
let _cachedGradOptions  = null;
let _cachedGradMajorReqs = null;

/**
 * Returns the full list of available major options derived from file paths.
 * No JSON is loaded; only the Vite module registry is consulted.
 *
 * Each option: { path, year, college, collegeLabel, folder, label, location,
 *                name, degree, acronym, acronyms }
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMajorOptions(majorRequirements, cohortYear) {
  // Re-derive if the adapter changed (different institution) or the cohort did
  if (_cachedOptions && _cachedMajorReqs === majorRequirements && _cachedCohort === cohortYear) return _cachedOptions;
  _cachedCohort = cohortYear;

  _cachedMajorReqs = majorRequirements;
  _cachedOptions = atCohortYear(
    Object.keys(_moduleMap)
      .map(path => optionFromPath(majorRequirements, path))
      .filter(o => o && !o.folder.endsWith('_minor'))   // minors live in the minor search
      .sort((a, b) =>
        b.year - a.year ||
        a.college.localeCompare(b.college) ||
        a.label.localeCompare(b.label)
      ),
    cohortYear
  );

  return _cachedOptions;
}

/**
 * Group options by "YYYY — College Label" for use in <optgroup> selectors.
 * Returns an ordered Map<groupKey, options[]>.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getMajorOptionGroups(majorRequirements, cohortYear) {
  const map = new Map();
  for (const opt of getMajorOptions(majorRequirements, cohortYear)) {
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
 * The edition of this major that the cohort follows, or null when the saved
 * path is already on it. See `findCohortVersion` for why this is not "newer".
 *
 * @param {string} currentPath  - path from getMajorOptions or saved plan state
 * @param {number} cohortYear
 * @returns {string|null}
 */
export function findCohortMajorVersion(currentPath, cohortYear) {
  return findCohortVersion(_moduleMap, currentPath, cohortYear);
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
export function getGradMajorOptions(majorRequirements, cohortYear) {
  if (_cachedGradOptions && _cachedGradMajorReqs === majorRequirements && _cachedGradCohort === cohortYear) return _cachedGradOptions;
  _cachedGradCohort = cohortYear;

  _cachedGradMajorReqs = majorRequirements;
  _cachedGradOptions = atCohortYear(
    Object.keys(_gradMap)
      .map(path => optionFromPath(majorRequirements, path))
      .filter(Boolean)
      .sort((a, b) =>
        b.year - a.year ||
        a.college.localeCompare(b.college) ||
        a.label.localeCompare(b.label)
      ),
    cohortYear
  );

  return _cachedGradOptions;
}

/**
 * Group graduate options by "YYYY — College Label" for use in <optgroup> selectors.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 */
export function getGradMajorOptionGroups(majorRequirements, cohortYear) {
  const map = new Map();
  for (const opt of getGradMajorOptions(majorRequirements, cohortYear)) {
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
 * The edition of this graduate program that the cohort follows, or null.
 *
 * Fires on nothing today, because only one graduate edition is held — and that
 * is precisely why it must be right BEFORE the next one lands. The 2027
 * graduate roll turns this on for 524 programs in a single scrape.
 */
export function findCohortGradMajorVersion(currentPath, cohortYear) {
  return findCohortVersion(_gradMap, currentPath, cohortYear);
}

export async function loadGradMajor(path) {
  const canonical = canonicalizeGradMajorPath(path);
  const fn = _gradMap[canonical];
  if (!fn) throw new Error(`Graduate major not found in registry: ${path}`);
  const mod = await fn();
  return mod.default ?? mod;
}

// ── Describing a path the cohort's option list does not contain ──────────────

/**
 * The option row for ANY program path we hold, ignoring cohort entirely.
 *
 * Every other lookup here goes through the cohort-filtered list, and that is
 * the right default — it is what keeps a student's search short and pinned to
 * the edition they owe. But a filtered list is the wrong thing to RESOLVE A
 * NAME against, and using it for that is a defect with three faces:
 *
 *   · `SearchCombo` displays the selected program by finding it among its own
 *     options, so a plan whose edition is not the cohort's rendered an EMPTY
 *     box over fully-loaded requirements — reachable with no banner involved,
 *     from a share link or by editing the entry term;
 *   · `myPrograms` labels the declared programmes the same way, and
 *     `matchesEligibility` keys on that label, so 4 of the 6 published pathway
 *     eligibility rules silently stopped matching;
 *   · and both failed SILENTLY, degrading to "" rather than to a question.
 *
 * A name is a fact about a program, not about who is allowed to pick it. This
 * answers the name; the option list goes on deciding what is offered.
 *
 * @param {import('../ports/IMajorRequirements.js').IMajorRequirements} majorRequirements
 * @param {string} path  a saved-plan path, in any of the three trees
 * @returns {object|null}
 */
export function describeProgramPath(majorRequirements, path) {
  if (!path) return null;
  const canonical = resolveInMap(_moduleMap, path, parseMajorPathParts)
                 ?? resolveInMap(_gradMap,   path, parseMajorPathParts)
                 ?? path;
  const option = optionFromPath(majorRequirements, canonical);
  if (!option) return null;
  // Keyed on the path the CALLER asked about, not the one we resolved to.
  //
  // `SearchCombo` matches this against the value it was handed, and a saved
  // plan's path frequently is not canonical: a student who entered under an
  // edition we no longer hold has `.../2025/...`, which `resolveInMap` answers
  // with the 2026 record. Returning the canonical path there made the identity
  // check fail and the program box render EMPTY over a perfectly loaded
  // program — the same blank box this whole change set out to fix, reappearing
  // for exactly the students most likely to have an old plan. The name is
  // resolved from the canonical record; the identity stays the caller's.
  return { ...option, path };
}
