// ═══════════════════════════════════════════════════════════════════
// PORT: IAttributable  (base interface — all ports extend this)
//
// Every port adapter must implement getSources() so the app can
// display a complete, accurate list of data sources in the About modal.
// Adapters that draw from no external sources simply return [].
//
// The About modal calls wire()'s getAllSources(), which aggregates
// across all active ports, deduplicates by id, and merges usedFor lists
// so one source that feeds multiple ports appears only once.
// ═══════════════════════════════════════════════════════════════════

/**
 * One external data source an adapter depends on.
 *
 * @typedef {Object} SourceInfo
 * @property {string}   id       - Stable unique key used for deduplication, e.g. "graduatenu".
 *                                 Must be unique across all sources returned by all ports.
 * @property {string}   label    - Repository or dataset name, e.g. "sandboxnu/graduatenu"
 * @property {string}   url      - Canonical URL for the source (GitHub repo, dataset page, etc.)
 * @property {string}   [author] - GitHub username or org name, e.g. "sandboxnu".
 *                                 Omit if attribution is to an org already in label.
 * @property {string}   usedFor  - Plain-English description of what this source provides,
 *                                 e.g. "graduation requirement definitions".
 *                                 Used in the About modal as "used for ___".
 */

/**
 * Base interface extended by all ports.
 *
 * @typedef {Object} IAttributable
 * @property {() => SourceInfo[]} getSources
 *   External data sources this adapter draws from.
 *   Return an empty array if the adapter uses no external sources.
 *   The id field must be globally unique — if two ports reference the
 *   same upstream repo, use the same id so wire().getAllSources() merges them.
 */
