/**
 * scrape-rails.js — refuse to write a run that looks like upstream breakage.
 *
 * The major scrapers run unattended on a schedule and push straight to `main`.
 * They previously wrote each program the moment it was parsed, so a markup
 * change at catalog.northeastern.edu would have committed ~1,000 gutted files
 * before anyone noticed — and unlike NUPath, there is no second source to fall
 * back on.
 *
 * This is the same guard `fetch-nupath.js` applies to its 5% mass-clear rule
 * (see CLAUDE.md): one program regressing is data drift and should land; a
 * fleet regressing is a broken parse and must not.
 *
 * The rails are deliberately about SHAPE, not correctness — correctness is
 * scripts/verify-majors.js's job, and it runs after the write. These only ask
 * "did this run collapse?".
 */

export const DEFAULT_LIMITS = {
  /** Share of previously-parsing programs allowed to vanish or empty out. */
  maxVanishedRatio: 0.05,
  /** Share of total requirement sections allowed to disappear corpus-wide. */
  maxSectionLossRatio: 0.10,
  /** Share of program pages allowed to fail fetching. */
  maxFetchFailRatio: 0.02,
  /** Share of the previously-known program count the URL list must still reach. */
  minDiscoveryRatio: 0.90,
};

/**
 * @param {object} args
 * @param {number} args.discovered      program URLs the index returned
 * @param {number} args.failed          fetches that threw
 * @param {Map<string, object>} args.results   outPath → parsed program
 * @param {Map<string, object>} args.previous  outPath → committed program
 * @param {object} [args.limits]
 * @returns {{ok: boolean, failures: string[], stats: object}}
 */
export function checkScrapeRails({ discovered, failed, results, previous, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const failures = [];

  const prevCount = previous.size;
  const sectionsOf = p => (p?.requirementSections?.length ?? 0)
                        + (p?.concentrations?.concentrationOptions?.length ?? 0);

  const prevSections = [...previous.values()].reduce((n, p) => n + sectionsOf(p), 0);
  const nowSections  = [...results.values()].reduce((n, p) => n + sectionsOf(p), 0);

  // Programs that used to parse and now produce nothing at all.
  const vanished = [...previous.keys()].filter(k => {
    if (sectionsOf(previous.get(k)) === 0) return false;   // wasn't parsing before
    return !results.has(k) || sectionsOf(results.get(k)) === 0;
  });

  const stats = {
    discovered, failed, prevCount, nowCount: results.size,
    prevSections, nowSections, vanished: vanished.length,
  };

  if (prevCount > 0 && discovered > 0 && discovered < prevCount * L.minDiscoveryRatio) {
    failures.push(`only ${discovered} program URLs discovered, against ${prevCount} previously committed ` +
                  `(floor ${Math.ceil(prevCount * L.minDiscoveryRatio)}) — the index or sitemap is likely broken`);
  }
  if (discovered > 0 && failed > discovered * L.maxFetchFailRatio) {
    failures.push(`${failed} of ${discovered} pages failed to fetch ` +
                  `(limit ${Math.ceil(discovered * L.maxFetchFailRatio)}) — the catalog may be down`);
  }
  if (prevCount > 0 && vanished.length > prevCount * L.maxVanishedRatio) {
    failures.push(`${vanished.length} programs that previously parsed now yield nothing ` +
                  `(limit ${Math.ceil(prevCount * L.maxVanishedRatio)}): ${vanished.slice(0, 5).join(', ')}…`);
  }
  if (prevSections > 0 && nowSections < prevSections * (1 - L.maxSectionLossRatio)) {
    failures.push(`requirement sections fell ${prevSections} → ${nowSections}, more than ` +
                  `${Math.round(L.maxSectionLossRatio * 100)}% — the parser is not reading this markup`);
  }

  return { ok: failures.length === 0, failures, stats };
}
