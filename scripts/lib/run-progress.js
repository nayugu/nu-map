/**
 * run-progress.js — "how far in is it, and how long is left?"
 *
 * A full catalog run is 747 undergraduate pages at roughly a second each, and
 * the only thing either scraper printed was one line per page. That is fine in
 * a CI log you read afterwards and useless in a terminal you are sitting in
 * front of: with no total and no counter, "it printed something 20 seconds ago"
 * is the entire status, and the difference between healthy and wedged is
 * invisible until it either finishes or doesn't.
 *
 * So every page line now carries `[123/747  16%  1.1s/pg  ETA 7m]`.
 *
 * ── Why the rate is a rolling window, not the run average ────────────
 *
 * The two are not close. The first ~90 URLs of an undergraduate run are
 * academic-policy pages that SKIP immediately, and a real program page with
 * concentrations fetches one extra page per concentration — so the run average
 * is dragged toward the cheap prefix and under-states the remaining work for
 * most of the run. A window over the last WINDOW pages tracks what the scraper
 * is doing NOW, which is what an ETA is for.
 *
 * The ETA is still only an estimate, and it is deliberately not dressed up as
 * more: it is printed to one unit (`ETA 7m`, not `ETA 7m12s`) precisely so it
 * reads as the approximation it is.
 *
 * Shared by both scrapers rather than copied, for the reason program-record.js
 * exists: the two used to carry byte-identical loops, which is how a fix lands
 * in one path and not the other.
 */

/** How many recent pages the rate is measured over. */
const WINDOW = 40;

/**
 * @param {number} total  pages this run will visit
 * @returns {() => string} call once per page, BEFORE the work; returns the
 *   bracketed prefix for that page's log line.
 */
export function makeProgress(total) {
  const stamps = [];        // completion times of the last WINDOW pages
  let seen = 0;
  let last = Date.now();

  return function next() {
    const now = Date.now();
    // The gap that just closed belongs to the PREVIOUS page, so record it
    // before counting this one. On the first call there is no gap yet.
    if (seen > 0) {
      stamps.push(now - last);
      if (stamps.length > WINDOW) stamps.shift();
    }
    last = now;
    seen++;

    const pct = total > 0 ? Math.round((seen / total) * 100) : 0;
    const counter = `${String(seen).padStart(String(total).length)}/${total}`;

    if (!stamps.length) return `[${counter} ${String(pct).padStart(3)}%]`;

    const perPage = stamps.reduce((a, b) => a + b, 0) / stamps.length;
    const left = Math.max(0, total - seen);
    return `[${counter} ${String(pct).padStart(3)}% ${fmtRate(perPage)} ${fmtEta(left * perPage)}]`;
  };
}

const fmtRate = (ms) => `${(ms / 1000).toFixed(1)}s/pg`;

/** One unit only — this is an estimate and should not look like a promise. */
function fmtEta(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return `ETA ${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `ETA ${m}m`;
  return `ETA ${(m / 60).toFixed(1)}h`;
}
