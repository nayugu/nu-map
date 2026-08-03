// Pure program-path helpers shared by the Vite loaders (majorLoader,
// minorLoader) and the Node program registry (adapters/northeastern/
// programRegistry.node.js). No I/O, no Vite APIs — keep it that way so
// both environments resolve stale paths with identical semantics.

/**
 * Parse the year/college/folder segments out of a module map path.
 * Returns null if no 4-digit year segment is found.
 */
export function parseMajorPathParts(path) {
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
 * The catalog edition a cohort follows, as its ENDING year — the same
 * label the program directories use ("2025-2026 Edition" → 2026).
 *
 * A NEU catalog edition runs fall → summer, so the entry SEMESTER matters,
 * not just the year: a fall-2025 entrant and a spring-2026 entrant are both
 * under the 2025-2026 edition (2026). Only fall shifts the label forward.
 *
 * Students follow the catalog they entered under — the catalog says so on
 * every page ("Students who enrolled in their programs prior to fall 2025
 * should consult previous versions"). We do NOT model change-of-major:
 * NEU publishes no rule for which edition a later-declared major follows,
 * and inventing one would be worse than the entry-year default, which is
 * right for every student who never switched. A student who did switch can
 * pick the other year explicitly; that stays their (and their advisor's)
 * call, and the choice is pinned by the saved program id, which carries
 * its year.
 *
 * @param {string} entSem   "fall" | "spring" | "sumA" | …
 * @param {number} entYear
 * @returns {number} the catalog edition year to prefer
 */
export function cohortCatalogYear(entSem, entYear) {
  const y = parseInt(entYear, 10);
  if (!Number.isFinite(y)) return NaN;
  return /^fall/i.test(entSem ?? '') ? y + 1 : y;
}

/**
 * Choose which available catalog year a cohort should see: the newest
 * edition that is not NEWER than the cohort's own, else the oldest we
 * hold (a student older than our archive gets the earliest we have, which
 * is the closest honest answer — never the current one).
 *
 * @param {number[]} availableYears
 * @param {number} cohortYear
 * @returns {number|undefined}
 */
export function pickCatalogYear(availableYears, cohortYear) {
  if (!availableYears?.length) return undefined;
  const sorted = [...new Set(availableYears)].sort((a, b) => a - b);
  if (!Number.isFinite(cohortYear)) return sorted[sorted.length - 1];
  let best;
  for (const y of sorted) if (y <= cohortYear) best = y;
  return best ?? sorted[0];
}

/**
 * Rewrite a program id/path onto a different catalog edition, leaving every
 * other segment (including a leading "grad/") untouched. Returns the input
 * unchanged when it carries no year or the year is not finite.
 *
 *   withCatalogYear("2029/khoury/cs_bscs_(boston)", 2026)
 *     → "2026/khoury/cs_bscs_(boston)"
 *
 * Used where an id arrives from a source that doesn't know the student's
 * cohort (notably MCP list_programs, which is a catalog tool with no plan).
 * If the rewritten path doesn't exist, resolveInMap's tiers take over — and
 * they now prefer the closest edition at or below the requested one.
 */
export function withCatalogYear(id, year) {
  if (!id || !Number.isFinite(year)) return id;
  return String(id).replace(/(^|\/)\d{4}(\/)/, `$1${year}$2`);
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
 *   2. same college + folder               — catalog-year bump
 *   3. same folder, any college            — program moved colleges
 *   4. normalized folder (± college)       — program slug renamed
 * Legacy submodule paths (../../graduatenu/…, ../../external/graduatenu/…)
 * carry the same year/college/folder segments, so tiers 2–4 migrate them.
 *
 * @param {Record<string, unknown>} map  - a path-keyed registry (Vite module map or plain object)
 * @param {string} path
 * @param {(p: string) => {year:number,college:string,folder:string}|null} parse
 * @returns {string|null}
 */
export function resolveInMap(map, path, parse) {
  if (map[path]) return path;

  const want = parse(path);
  if (!want) return null;

  const entries = Object.keys(map)
    .map(p => ({ p, pp: parse(p) }))
    .filter(e => e.pp);

  // Within a tier, prefer the saved id's OWN catalog edition, then the
  // closest older one, and only then the newest.
  //
  // This used to take the newest unconditionally, which was harmless while
  // one edition existed. Now that editions are frozen and retained, a saved
  // 2026 plan whose exact path stopped resolving (a folder rename, or its
  // edition aged out of retention) would have been silently relocated onto
  // the CURRENT year's requirements — the exact failure the freeze exists to
  // prevent, arriving through the back door.
  const bestWhere = (pred) => {
    let exact = null, older = null, olderYear = -Infinity, newest = null, newestYear = -Infinity;
    for (const { p, pp } of entries) {
      if (!pred(pp)) continue;
      if (pp.year === want.year) exact ??= p;
      if (pp.year <= want.year && pp.year > olderYear) { olderYear = pp.year; older = p; }
      if (pp.year > newestYear) { newestYear = pp.year; newest = p; }
    }
    return exact ?? older ?? newest;
  };

  const wantNorm = normalizeFolder(want.folder);
  return (
    bestWhere(pp => pp.college === want.college && pp.folder === want.folder) ||
    bestWhere(pp => pp.folder === want.folder) ||
    bestWhere(pp => pp.college === want.college && normalizeFolder(pp.folder) === wantNorm) ||
    bestWhere(pp => normalizeFolder(pp.folder) === wantNorm) ||
    null
  );
}
