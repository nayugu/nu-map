/**
 * catalog-cache.js — polite, optionally-cached HTML fetching for the catalog
 * scrapers.
 *
 * Two jobs, both about being a good citizen of catalog.northeastern.edu:
 *
 * 1. **One global rate limit.** Each scraper used to sleep between *programs*
 *    while making unbounded extra requests inside a program (concentration
 *    pages, retries). politeFetch serialises every request through a single
 *    delay, so the real inter-request gap matches the configured one no matter
 *    how many call sites there are.
 *
 * 2. **An opt-in on-disk cache.** A full run is ~1,000 pages. Iterating on the
 *    parser without a cache means re-fetching all of them on every attempt,
 *    which is both slow and rude. With CATALOG_HTML_CACHE set, pages are read
 *    from disk when present and written when fetched.
 *
 * The cache is **off unless CATALOG_HTML_CACHE is set**, and must never be
 * enabled in CI — a scheduled run has to see the live catalog. It is a
 * development affordance only.
 *
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/scrape-majors.js --dry-run
 *
 * Cache entries never expire on their own; delete the directory to refresh.
 * `.cache/` is gitignored.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { createHash } from "crypto";

const CACHE_DIR = process.env.CATALOG_HTML_CACHE || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Filesystem-safe cache key: readable prefix + hash, so entries are greppable. */
function cacheKey(url) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 80);
  return `${slug}__${hash}.html`;
}

/**
 * Serialised, rate-limited fetch queue.
 *
 * Requests chain off a single promise so concurrent callers still leave
 * `delayMs` between actual network hits. A cache hit skips the delay entirely,
 * which is what makes cached runs fast rather than merely cheap.
 */
let queue = Promise.resolve();
let lastFetchAt = 0;

export const cacheStats = { hits: 0, misses: 0, writes: 0, retries: 0 };

/** True when the on-disk cache is active for this run. */
export function cacheEnabled() {
  return CACHE_DIR !== null;
}

export function cacheDir() {
  return CACHE_DIR;
}

/**
 * Fetch a URL as text, honouring the cache and the global rate limit.
 *
 * ## Why it retries
 *
 * A dropped socket used to lose a page for the whole run. The scrapers absorb
 * that as one fetch failure and the rails tolerate 2%, so a handful of
 * programs would quietly keep last month's data with nothing in the log to
 * distinguish it from a page that genuinely went away.
 *
 * That is merely untidy for the monthly job, which gets another go in four
 * weeks. It is not for an ARCHIVE backfill: those editions are frozen and
 * scraped once, so a transient error there writes a bundle permanently missing
 * a program. Seven pages were lost this way on the first 2024-2025 run, and
 * all seven answered 200 a minute later.
 *
 * Retries cover transport errors and 5xx — the states that mean "ask again".
 * A 4xx is a real answer about that URL and is returned immediately, so a
 * retired page still fails fast instead of costing three round trips.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.delayMs=600]   minimum gap between live requests
 * @param {string} [opts.userAgent]
 * @param {number} [opts.retries=2]     extra attempts after a transient failure
 * @returns {Promise<string>} the page HTML
 * @throws  on non-2xx, with the status in the message (callers already match on this)
 */
export function politeFetch(url, { delayMs = 600, userAgent, retries = 2 } = {}) {
  const ua = userAgent
    || "nu-map-scraper/1.0 (educational planning tool; not for commercial use)";

  const path = CACHE_DIR ? join(resolve(CACHE_DIR), cacheKey(url)) : null;

  if (path && existsSync(path)) {
    cacheStats.hits++;
    return Promise.resolve(readFileSync(path, "utf8"));
  }

  // Chain onto the queue so the delay is global, not per-call-site.
  const task = queue.then(async () => {
    const since = Date.now() - lastFetchAt;
    if (since < delayMs) await sleep(delayMs - since);
    lastFetchAt = Date.now();

    cacheStats.misses++;
    let html, lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        cacheStats.retries++;
        // Back off rather than hammering something that is already struggling.
        await sleep(delayMs * Math.pow(2, attempt));
        lastFetchAt = Date.now();
      }
      try {
        const res = await fetch(url, { headers: { "User-Agent": ua } });
        // 4xx is an answer about this URL, not a reason to ask again.
        if (!res.ok && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err.final) break;
      }
    }
    if (lastErr) throw lastErr;

    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, html, "utf8");
      cacheStats.writes++;
    }
    return html;
  });

  // Keep the queue alive after a rejection, but let the caller see the error.
  queue = task.then(() => {}, () => {});
  return task;
}

/** One-line summary for the end of a run. */
export function cacheSummary() {
  // Retries are reported because a run that needed several says something
  // about the network that a clean fetch count hides.
  const retried = cacheStats.retries ? `, ${cacheStats.retries} retried` : "";
  if (!CACHE_DIR) return `${cacheStats.misses} pages fetched (cache off)${retried}`;
  return `${cacheStats.hits} from cache, ${cacheStats.misses} fetched${retried} → ${CACHE_DIR}`;
}
