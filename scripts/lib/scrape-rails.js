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
export function checkScrapeRails({ discovered, failed, results, previous, baselineCount, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const failures = [];

  const prevCount = previous.size;
  // The discovery floor must survive an EDITION ROLL. `previous` is scoped to
  // the edition being written, so the first scrape of a new catalog year has
  // none — and every prevCount-guarded rail would silently switch itself off
  // during the riskiest run of the cycle. The sitemap's size is edition-
  // independent, so the caller passes the prior edition's program count as a
  // baseline and the floor keeps applying.
  const floorBase = prevCount > 0 ? prevCount : (baselineCount ?? 0);
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

  if (floorBase > 0 && discovered > 0 && discovered < floorBase * L.minDiscoveryRatio) {
    failures.push(`only ${discovered} program URLs discovered, against ${floorBase} previously committed ` +
                  `(floor ${Math.ceil(floorBase * L.minDiscoveryRatio)}) — the index or sitemap is likely broken`);
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

/** Share of previously-published sample plans allowed to disappear in one run. */
export const MAX_PLAN_LOSS_RATIO = 0.25;

/**
 * Decide whether this run may DELETE the sample plans it no longer sees.
 *
 * Deliberately shaped differently from the rails above, and the difference is
 * the point. Those refuse the whole run, because a collapse in requirements
 * means the parse is wrong and nothing should land. A collapse in sample plans
 * is genuinely ambiguous: departments are moving plans off the catalog onto
 * their own pages (advisors, Aug 2026), so plans really will start vanishing
 * upstream, and a hard failure would eventually block every requirements
 * update for a reason that has nothing to do with requirements.
 *
 * So the run always lands; only the deletions are held. Holding them keeps a
 * plan that is one edition stale, which is a much smaller wrong than removing
 * a feature from ~388 programs because a class name changed. The warning is
 * how a human finds out which it was.
 *
 * A single program dropping its plan is normal and passes straight through —
 * only a fleet-wide drop is held.
 *
 * @param {number} nowPlans   plans this run successfully parsed
 * @param {number} prevPlans  plan files already committed for this edition
 * @returns {{deleteOk: boolean, reason: string|null}}
 */
export function checkPlanRail(nowPlans, prevPlans, ratio = MAX_PLAN_LOSS_RATIO) {
  if (prevPlans === 0) return { deleteOk: true, reason: null };
  const floor = Math.floor(prevPlans * (1 - ratio));
  if (nowPlans >= floor) return { deleteOk: true, reason: null };
  return {
    deleteOk: false,
    reason: `sample plans fell ${prevPlans} → ${nowPlans} (floor ${floor}). ` +
            `Requirements were written; existing plan.json files were KEPT rather than deleted. ` +
            `Check whether the catalog dropped its plans or the grid parser stopped matching.`,
  };
}

/**
 * ── The cross-count repairs must survive the scrape ─────────────────
 *
 * `shared: true` marks a section the demand model SKIPS — an integrative requirement, a GPA
 * re-list, one of two alternative tracks. Drop it and the degree is charged twice for the
 * same courses; measured, that took 21 of 1,078 shapes from a plan to
 * `mostly-unschedulable`.
 *
 * Most of those flags cannot be re-derived from the page (see `shared-sections.js`), so they
 * live in a committed manifest applied on every run. This rail checks the manifest still
 * FITS: a title it names that matches no section means the catalog reorganised underneath a
 * hand adjudication, and the repair silently stopped applying.
 *
 * ── Why this fails the run rather than warning ──────────────────────
 *
 * Nothing in `update-majors.yml` generates a plan, so no other guard in that workflow can
 * see the damage — the scrape, the integrity check and the verification ratchet all passed
 * on the run that dropped 21 degrees. A warning in a log nobody reads is how it stayed
 * invisible in the first place. The workflow pushes straight to main unattended, and a month
 * of stale-but-correct requirements is a far smaller wrong than a month of degrees a student
 * cannot schedule.
 *
 * The fix is always cheap and local: re-adjudicate that one entry in `shared-sections.json`.
 *
 * @param {Iterable<object>} results  freshly built records, each carrying `_sharedMissing`
 * @returns {{ok: boolean, misses: {slug: string, titles: string[]}[]}}
 */
/**
 * What to DO when the shared-section rail fires, printed by the rail itself.
 *
 * This rail stops a scheduled, unattended job, and it fires rarely enough that nobody will
 * have the context loaded when it does. A hard stop whose recovery is undocumented gets
 * recovered by whatever is fastest — deleting the manifest entry — which is the one action
 * that silently reintroduces the defect the manifest exists to prevent. So the decision is
 * spelled out at the point of failure rather than in a document that has to be found first.
 *
 * Deliberately states the WRONG answer as well as the right ones. "Delete the entry" is the
 * tempting move and it is only correct when the requirement genuinely stopped being
 * cross-counted, which is rare; the common case is a retitled section.
 */
export const SHARED_RAIL_RUNBOOK = `
    These sections are SKIPPED by the demand model. Losing the mark charges the degree
    twice for the same courses, and no other guard in this workflow can see it — nothing
    here generates a plan.

    Open the page above and decide, per title:

      • the section was RENAMED         → update the title in shared-sections.json
      • the section is GONE from the page → remove that title from the entry
      • the whole program is gone         → remove the entry
      • it is still there and still cross-counted, but we now parse it differently
                                          → fix the parser, not the manifest

    Only remove a title when the requirement genuinely stopped being cross-counted.
    Deleting the entry to make the run pass reintroduces the exact defect this rail
    exists to catch, and the next scrape will not tell you.

    Context and the measured cost of getting this wrong: scripts/lib/shared-sections.js
`;

export function checkSharedSectionsRail(results) {
  const misses = [];
  for (const rec of results ?? []) {
    const titles = rec?._sharedMissing;
    if (Array.isArray(titles) && titles.length) {
      misses.push({
        slug: rec._slug ?? rec?.name ?? '(unknown)',
        titles,
        // The catalog page, carried so the failure can be ACTED on rather than merely read.
        // This rail stops an unattended monthly job, and whoever picks it up needs the live
        // page to re-adjudicate against — without it the first step is hunting for the URL,
        // which is exactly the friction that turns a hard stop into a rubber stamp.
        url: rec?.metadata?.sourceUrl ?? null,
      });
    }
  }
  return { ok: misses.length === 0, misses };
}
