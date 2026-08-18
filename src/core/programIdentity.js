/**
 * programIdentity.js — one string that names one program.
 *
 * Needed because neither obvious candidate is unique, and both look like they are:
 *
 *   NAME        five names are shared. Four colleges publish "Interdisciplinary
 *               Studies, BS (Oakland)" and both levels publish "Pharmacy, PharmD
 *               (Boston)".
 *   sourceUrl   34 urls are shared, and by design — one catalog page can carry more
 *               than one program, which is what the variant split is. "International
 *               Business, BSIB" and "…BSIB—Exchange" are one page and two degrees.
 *
 * Together they are unique: measured over the shipped corpus, 795 programs produce 795
 * distinct pairs. Both halves come off `requirements.json`, so any layer holding a
 * program can compute this without being told a directory path or a registry id.
 *
 * It lives in core because it is a fact about program data rather than about planning
 * or scraping, and because both an adapter and a build script need the SAME answer —
 * a key computed two ways is a lookup that silently misses.
 */

/**
 * @param {{name?: string, metadata?: {sourceUrl?: string}}} program a parsed requirements.json
 * @returns {string} stable identity, or "" when the program cannot be identified
 */
export function programIdentity(program) {
  const name = program?.name ?? "";
  const url = program?.metadata?.sourceUrl ?? "";
  if (!name && !url) return "";
  return `${name} @ ${url}`;
}
