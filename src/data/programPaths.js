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
 * The canonical program id for a program referred to by EITHER spelling.
 *
 * Two forms of the same reference exist in this app and both are load-bearing:
 *
 *   glob module path  "../../data/northeastern/programs/undergraduate/2026/
 *                      computer-information-science/computer_science_bscs_(boston)/
 *                      requirements.json"     ← what a saved plan's `major` holds
 *   registry id       "2026/computer-information-science/computer_science_bscs_(boston)"
 *                                             ← what programs-bundle.json keys on,
 *                                               and what MCP `programId` uses
 *
 * Anything that has to compare a plan's declared program against bundle data —
 * accelerated pathway eligibility is the first such thing — needs them in one
 * form, and guessing which one a caller holds is how a comparison silently never
 * matches. This is that conversion, and it is IDEMPOTENT: given a registry id it
 * returns it unchanged, so a caller never has to know which it was handed.
 *
 * Mirrors the id construction in programRegistry.node.js (graduate ids carry a
 * "grad/" prefix so the two PharmD programs cannot collide); the two must not
 * drift, which is why both derive their segments from parseMajorPathParts.
 *
 * @param {string} pathOrId
 * @returns {string|null} canonical id, or null when no year segment is present
 */
export function programIdFromPath(pathOrId) {
  const raw = String(pathOrId ?? '');
  if (!raw) return null;
  const parts = parseMajorPathParts(raw);
  if (!parts || !parts.college || !parts.folder) return null;
  // A path under .../programs/graduate/ is graduate; so is an id that already
  // carries the prefix (the idempotent case, where no directory segment exists).
  const isGrad = /\/graduate\//.test(raw) || /^grad\//.test(raw);
  const { year, college, folder } = parts;
  return isGrad ? `grad/${year}/${college}/${folder}` : `${year}/${college}/${folder}`;
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
 * right for every student who never switched.
 *
 * ⚠ This paragraph used to end "a student who did switch can pick the other
 * year explicitly", and that was FALSE for as long as it was written: the
 * option lists dedupe to exactly one year per program, so no explicit year
 * picker has ever existed. What is true is narrower — a saved program id
 * carries its year, so an id already on another edition is honoured and
 * `findCohortVersion` (majorLoader.js) offers the cohort's edition beside it
 * rather than switching underneath them. Choosing an arbitrary third edition
 * is still not something the UI can do, and nothing here should be read as
 * saying it can.
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
 * The catalog edition's own name, from the ENDING year our directories key on.
 *
 *   2026 → "2025-2026"    — the label NEU prints on every page
 *
 * One function because three places need to agree: the year selector, the
 * cohort hint beside it, and anything that later reports an edition to a human.
 * A hand-built `${y-1}-${y}` in a JSX file is how one of them ends up naming
 * the wrong academic year on a boundary.
 */
export function editionLabel(year) {
  const y = Number(year);
  // `Number.isFinite` alone is NOT enough, and the first version used it:
  // Number(null) and Number("") are both 0, so a missing year rendered as
  // "-1-0" rather than as nothing. A catalog year is a 4-digit integer or it is
  // not a year.
  return Number.isInteger(y) && y > 1000 ? `${y - 1}-${y}` : "";
}

/**
 * The same edition, in the form a narrow control can hold: `2025-26`.
 *
 * ── Why a second form rather than a smaller font ───────────────────
 *
 * The picker sits on the field's header line, and the minors sit in a grid whose
 * columns are as narrow as 120px. At the full label the control did not fit
 * beside "MINOR 1" and wrapped onto its own line — which costs back the exact
 * line moving it up was meant to save, and looks worse than where it started.
 *
 * Shrinking the type was the other option and is the wrong one: 9px is already
 * the floor here, and the year is the only information in the control. This is a
 * layout problem, so it gets a layout answer.
 *
 * The compact academic year is not an invention — it is how every registrar,
 * transcript and student writes it. Only the BUTTON uses it; the open list and
 * the cohort hint keep the full form, because neither is short of room and
 * "your cohort: 2025-2026" is a sentence rather than a label.
 */
export function editionLabelShort(year) {
  const full = editionLabel(year);
  return full ? `${full.slice(0, 4)}-${full.slice(-2)}` : "";
}

/**
 * Every edition of `path`'s program that we actually HOLD, oldest first.
 *
 * "Actually hold" is the load-bearing part. The year selector is built from
 * this and from nothing else, so it can never offer an edition that resolves to
 * no requirements file — which is the same invariant `findCohortVersion` keeps,
 * for the same reason: an offered selection that cannot be loaded and displayed
 * empties the program box and strands the student.
 *
 * Measured on the live tree: 509 of 689 undergraduate programs hold two
 * editions, 180 hold one, and all 524 graduate programs hold one. So the
 * selector is absent for a quarter of undergraduate programs and for every
 * graduate program today, and that is correct rather than a gap — one edition
 * is not a choice.
 *
 * @param {Record<string, unknown>} map
 * @param {string} path
 * @returns {{year: number, path: string}[]}
 */
export function editionsOf(map, path) {
  const canonical = resolveInMap(map, path, parseMajorPathParts) ?? path;
  const current = parseMajorPathParts(canonical);
  if (!current) return [];
  return Object.keys(map)
    .map(p => ({ p, pp: parseMajorPathParts(p) }))
    .filter(e => e.pp && e.pp.college === current.college && e.pp.folder === current.folder)
    .map(e => ({ year: e.pp.year, path: e.p }))
    .sort((a, b) => a.year - b.year);
}

/**
 * Keep one row per program, at the catalog year THIS COHORT follows.
 *
 * Requirements are frozen at the edition a student entered under, so a 2026
 * entrant must keep seeing 2026 after the 2027 edition lands. Search stays
 * exactly as short as before: this picks which year survives the dedupe, never
 * how many rows there are.
 *
 * @param {{college: string, folder: string, year: number}[]} options
 * @param {number} cohortYear
 */
export function atCohortYear(options, cohortYear) {
  return options.filter((opt, _, arr) => {
    const years = arr.filter(o => o.college === opt.college && o.folder === opt.folder).map(o => o.year);
    return opt.year === pickCatalogYear(years, cohortYear);
  });
}

/**
 * The edition of `path`'s program that THIS COHORT follows — or null when the
 * path is already on it, which is the overwhelmingly common case.
 *
 * ── Why this is not "is a newer version available" ──────────────────
 *
 * It was, from May 2026 until Sept 2026, and that predates the edition freeze.
 * Once programs were pinned per cohort the two disagreed, and the newer-only
 * reading was wrong in BOTH directions at once:
 *
 *   · it fired for students who were correctly pinned — measured at 338 of 498
 *     undergraduate majors for every cohort from fall 2023 to spring 2026, i.e.
 *     every student the app then had — and advised each of them to leave the
 *     edition they actually owe;
 *   · and it could not rescue anyone who had taken that advice, because their
 *     saved path is now AHEAD of their cohort and "newer" has nothing to offer.
 *
 * So the axis is difference from the cohort, not recency, and the switch it
 * offers may move a plan BACKWARD. That backward move is the repair path for
 * every plan the old banner pushed forward, and it is the reason this could not
 * be fixed by adding a cohort check to the newer-only version.
 *
 * ⚠ `programRegistry.node.js` reached this conclusion FIRST and went further:
 * it deleted its `newerVersionYear` flag outright, on the reasoning that
 * "moving to a newer catalog is a petition, not a suggestion an audit tool
 * should make". That is not in tension with keeping this one, and the
 * difference is the whole point — that flag was true for every student not in
 * the current year, i.e. for students who were CORRECTLY pinned, which is a
 * suggestion. This fires only when a plan is not on its cohort's edition,
 * which is a correction. The two surfaces disagreed for months because the
 * reasoning lived in a comment on one of them; hence this paragraph.
 *
 * ── The invariant ──────────────────────────────────────────────────
 *
 * The returned path is always one that `atCohortYear` keeps for the same
 * cohort. That is not incidental — this predicate and that dedupe are the same
 * rule over the same map — and it is the whole safety property: a path offered
 * here can always be DISPLAYED and re-selected. Offering a path outside the
 * list is exactly the defect that left the program box blank while the
 * requirements changed underneath the student, with no way back.
 *
 * @param {Record<string, unknown>} map  a path-keyed registry
 * @param {string} path                  the plan's saved program path
 * @param {number} cohortYear
 * @returns {string|null}
 */
/**
 * The `plan.json` key for a program, or null when it publishes none FOR THE
 * EDITION THAT PROGRAM'S REQUIREMENTS ACTUALLY RESOLVED TO.
 *
 * ── Why the plan may not be migrated on its own ────────────────────
 *
 * A Sample Plan of Study is not a document about a program, it is a document
 * about one EDITION of that program's requirements: it names that edition's
 * courses, in that edition's credit totals, satisfying that edition's
 * sections. A plan borrowed from a neighbouring year is therefore not a
 * slightly-old answer, it is an answer to a different question — and it
 * arrives looking authoritative, because the student asked for "the
 * department's plan" and was handed one.
 *
 * `samplePlanLoader` used to run `resolveInMap` over the PLAN map. That is the
 * same migration the program loader uses, and it is right there — but it is
 * right only for REQUIREMENTS, where a saved path that no longer resolves must
 * land on something rather than empty the panel. Over plans it silently
 * changed edition. Measured on the live tree: 322 of 509 multi-edition
 * undergraduate programs publish a plan in one edition and not the other, and
 * the split is not a scatter — it is all 322 in 2026 and ZERO in 2027.
 *
 * The mechanism is not deletion, and the distinction is this file's own:
 * Northeastern moved Sample Plans of Study OUT of the catalog and onto the
 * colleges' own websites, one site per college. The plans still exist; they are
 * no longer anywhere we scrape (no `planofstudy` pane, no `sc_plangrid`, not
 * even the phrase, on 768 cached pages or the live site). Absent from our data
 * is not the same fact as absent from the world, which is why the string the
 * student reads says NU Map does not have it rather than that none was
 * published. So every student on the current edition who opened that section
 * was being shown last year's plan.
 *
 * The rule instead, and the reason it takes BOTH maps: resolve against the
 * requirements map — the same resolution `loadMajor` performs, so a saved path
 * from a dropped edition follows its requirements wherever they land — and
 * then take the sibling EXACTLY. The plan's edition is then the loaded
 * requirements' edition by construction rather than by a second agreeing
 * guess, which is the only arrangement in which the two cannot drift.
 *
 * This lives here rather than in `samplePlanLoader` for the reason `editionsOf`
 * does: that file is a Vite `import.meta.glob` module and cannot be imported
 * under Node at all, so a rule kept there is a rule no unit test can reach.
 *
 * @param {Record<string, unknown>} planMap     path → plan.json loader
 * @param {Record<string, unknown>} programMap  path → requirements.json loader
 * @param {string} path
 * @returns {string|null}
 */
export function planKeyFor(planMap, programMap, path) {
  // Coerced BEFORE anything reads it: `parseMajorPathParts` calls `.split`, so
  // a caller holding `{}` (a program object rather than its path — the obvious
  // slip at this boundary) threw rather than answering "no plan". A loader that
  // throws takes the whole panel down; one that returns null loses a feature.
  const p = typeof path === "string" ? path : "";
  if (!planMap || !programMap || !p) return null;
  const canonical = resolveInMap(programMap, p, parseMajorPathParts) ?? p;
  const wanted = String(canonical).replace(/requirements\.json$/, "plan.json");
  return planMap[wanted] ? wanted : null;
}

export function findCohortVersion(map, path, cohortYear) {
  // No cohort (a plan with no entry term yet) means no opinion. `pickCatalogYear`
  // answers "newest" for NaN, which is right for BUILDING A LIST and wrong here:
  // it would prompt every such student onto an edition we cannot say is theirs.
  if (!Number.isFinite(cohortYear)) return null;

  const canonical = resolveInMap(map, path, parseMajorPathParts) ?? path;
  const current = parseMajorPathParts(canonical);
  if (!current) return null;

  // Shares `editionsOf` with the year selector deliberately: the set this
  // chooses from and the set the selector offers must be the same set, or the
  // hint can name an edition the dropdown beside it does not contain.
  const siblings = editionsOf(map, canonical);
  if (!siblings.length) return null;

  const want = pickCatalogYear(siblings.map(e => e.year), cohortYear);
  if (want == null || want === current.year) return null;
  return siblings.find(e => e.year === want)?.path ?? null;
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
