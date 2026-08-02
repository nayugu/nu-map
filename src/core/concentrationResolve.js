/**
 * concentrationResolve.js — find a concentration by a title that may be stale.
 *
 * A concentration's TITLE is its identity across every boundary in the app:
 * it is what GradPanel stores in the saved plan, what share links carry, and
 * what the MCP `SET_CONCENTRATION` action takes ("Set the concentration by its
 * EXACT title from get_program"). There is no id.
 *
 * That makes an exact-match lookup brittle. When the scraper's titles changed
 * — as they did in the 2026-08 parser rewrite, where options moved from an
 * areaheader label like "Art + Design History Electives" to the real heading
 * "Concentration in Art History and Visual Studies" — every saved plan
 * silently lost its selection, because GradPanel clears `selConc` the moment
 * the title no longer resolves.
 *
 * Resolution is tiered, most-trusted first:
 *   1. exact title
 *   2. a recorded alias (the scraper carries forward the previous title)
 *   3. the display label the catalog's own menu used
 *   4. normalized comparison — case, punctuation, and the "concentration in"
 *      prefix removed
 *
 * Only tier 1 is guaranteed; the rest exist so a rename degrades to "still
 * works" instead of "selection vanished". Nothing here mutates the plan.
 */

/**
 * Strip everything that varies between phrasings of the same concentration.
 * "Concentration in Artificial Intelligence" → "artificial intelligence"
 * "Performance Concentration"                → "performance"
 */
export function normalizeConcentrationTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/ /g, ' ')
    .replace(/\b(?:concentration|option|track)\b/g, ' ')
    .replace(/\bin\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @param {object} program   a parsed program (needs .concentrations)
 * @param {string} title     the possibly-stale saved title
 * @returns {object|null}    the matching concentration option, or null
 */
export function resolveConcentration(program, title) {
  const opts = program?.concentrations?.concentrationOptions ?? [];
  if (!title || !opts.length) return null;

  const exact = opts.find(c => c.title === title);
  if (exact) return exact;

  const aliased = opts.find(c => (c.aliases ?? []).includes(title));
  if (aliased) return aliased;

  const labelled = opts.find(c => c.label === title);
  if (labelled) return labelled;

  const want = normalizeConcentrationTitle(title);
  if (!want) return null;
  return opts.find(c =>
    normalizeConcentrationTitle(c.title) === want ||
    normalizeConcentrationTitle(c.label ?? '') === want) ?? null;
}
