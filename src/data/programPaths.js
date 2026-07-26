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
