/**
 * catalog-edition.js — scraping a FROZEN past edition of the catalog.
 *
 * catalog.northeastern.edu/archive/ publishes complete browsable CourseLeaf
 * catalogs for past years, each at `/archive/{start}-{end}/` with its own
 * sitemap and the same markup as the live site (verified 2026-08-07 for
 * 2018-2019 through 2024-2025). That matters because **requirements are locked
 * to the edition a student entered under**: a 2023 entrant follows the 2023-24
 * rules, and showing them 2026's is wrong in a way they cannot see.
 *
 * ## The failure this module exists to prevent
 *
 * Scraping an archive edition means writing ~1,000 files into a directory
 * labelled with a year. If the archive ever serves live content for a URL —
 * a redirect on a missing page, a misconfigured rewrite, an edition retired
 * mid-run — we would write TODAY's requirements into 2022's folder and then
 * show them to a 2022 student as authoritative. Nothing downstream could
 * detect it: the file would be well-formed, the program would verify, and the
 * only symptom is a student planning against the wrong degree.
 *
 * So the edition year is never inferred here. It is DECLARED by the caller
 * (`--edition 2022-2023`), and every page fetched must agree with it. The live
 * scrapers do the opposite — they read the year off the first page, because
 * there the page is the authority and the clock is not. Here the flag is the
 * authority and the page is the thing being checked.
 *
 * One page disagreeing aborts the whole run rather than skipping that program,
 * because a mismatch is evidence about the ARCHIVE, not about the program: if
 * one URL can serve the wrong edition, the ones that already passed are no
 * longer trustworthy either.
 */

/**
 * How many editions we SHIP, counting the live one.
 *
 * Sized from the longest realistic path rather than picked as a round number:
 * a 5-year co-op degree, plus a leave or an extra co-op cycle makes 6 ordinary,
 * and 7 covers that with a year of margin. A student still enrolled under an
 * edition older than this is rare enough to be an advising conversation rather
 * than a data problem.
 *
 * It lives here, in the module both readers can import, because it was defined
 * in `prune-catalog-years.js` and applied to the two PROGRAM trees only — the
 * course-edition snapshots had no cap at all, so the retired union grew with
 * every capture forever. Two windows that are meant to be the same window must
 * not be two constants.
 */
export const KEEP_YEARS = 7;

// The only I/O in this module, and it is confined to `newestEditionHeld` below: everything
// else here is pure and should stay that way, so a caller can reason about editions without
// touching a disk.
import { existsSync, readdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';

/**
 * The editions inside the window, newest first.
 *
 * Anchored to the NEWEST EDITION HELD rather than to the live catalog, and
 * deliberately: a derive step must not need the network to decide what it
 * ships, and if a capture were ever missed the anchor lags by a year, which
 * keeps one edition too many. Erring toward keeping is the recoverable
 * direction — dropping an edition removes a course from a plan that names it.
 *
 * @param {number[]} years  edition end-years present on disk, any order
 * @returns {number[]} the kept years, newest first
 */
export function editionWindow(years) {
  return [...years].sort((a, b) => b - a).slice(0, KEEP_YEARS);
}

/**
 * The newest program edition actually held on disk, for the instruments.
 *
 * ── Why this is one function and not eight ──────────────────────────
 *
 * Every script that reads the program corpus has to pick an edition, and until this existed
 * they each picked one for themselves. Audited 2026-09-10, immediately after the graduate
 * 2027 roll: **two** scripts resolved it correctly (`verify-chart`, `chart-probe`, by
 * near-identical copies of the code below) and **six** hard-coded `2026` — including
 * `corpus-ask.js` and `corpus-snapshot.js`, which CLAUDE.md names as THE way to ask a
 * question about the corpus.
 *
 * A hard-coded edition in an instrument is worse than one in a feature, and the reason is
 * the whole working method here: measurements are what decisions are made from. A pinned
 * instrument does not fail — it answers confidently about last year's catalog, in the same
 * format, with a plausible number. "Measure before designing" stops being a safeguard the
 * moment the measurement silently describes a corpus we no longer ship.
 *
 * Anchored to what is HELD rather than to the clock, for the same reason `editionWindow` is:
 * a derive must not need the network, and a run in the gap between a catalog roll and our
 * scrape of it would otherwise name an edition that does not exist here.
 *
 * Throws rather than falling back to a year. A fallback is how a missing tree becomes a
 * confident answer about the wrong one, which is the defect this replaces.
 *
 * @param {string} root   repo root
 * @param {string} tree   "undergraduate" | "graduate"
 * @param {string[]} [argv]  honours an explicit `--edition YYYY`, which pins a measurement
 *                           to a frozen edition so its answer stops moving under it
 * @returns {number}
 */
export function newestEditionHeld(root, tree = "undergraduate", argv = null) {
  if (argv) {
    const i = argv.indexOf("--edition");
    const v = argv[i + 1] ?? "";
    if (i >= 0 && /^\d{4}$/.test(v)) return Number(v);
  }
  const base = joinPath(root, "data/northeastern/programs", tree);
  const years = existsSync(base)
    ? readdirSync(base).filter(d => /^\d{4}$/.test(d)).map(Number) : [];
  if (!years.length) {
    throw new Error(
      `no program editions found under ${base} — refusing to guess a year. `
      + `An instrument that falls back to a hard-coded edition reports confidently `
      + `about a corpus we do not ship.`);
  }
  return Math.max(...years);
}

/** `2022-2023` — the archive's own directory naming. */
const EDITION_LABEL = /^(\d{4})-(\d{4})$/;

/**
 * Read `--edition 2022-2023` from argv.
 *
 * @returns {{label: string, year: number}|null} null when scraping live
 */
export function parseEditionArg(argv) {
  const i = argv.indexOf("--edition");
  if (i < 0) return null;
  const label = argv[i + 1] ?? "";
  const m = EDITION_LABEL.exec(label);
  if (!m) {
    throw new Error(`--edition expects a label like 2022-2023, got ${JSON.stringify(label)}`);
  }
  const start = parseInt(m[1], 10), end = parseInt(m[2], 10);
  if (end !== start + 1 || start < 2000 || start > 2100) {
    throw new Error(`--edition ${label} is not a plausible consecutive academic year`);
  }
  // The end year, matching parseCatalogEdition and the data/northeastern/programs/undergraduate/{year}/
  // convention: the 2022-2023 edition is stored as 2023.
  return { label, year: end };
}

/**
 * The URL prefix an edition's pages live under.
 * Live editions have none; archived ones sit beneath /archive/{label}.
 */
export function editionBasePath(edition) {
  return edition ? `/archive/${edition.label}` : "";
}

/**
 * Assert that a fetched page belongs to the edition we asked for.
 *
 * Deliberately strict about a MISSING label too. An archive page that carries
 * no edition banner is not a page we can place in time, and guessing would
 * reintroduce exactly the silent mislabelling this module prevents.
 *
 * @param {number|null} pageYear  parseCatalogEdition's reading of the page
 * @param {{label: string, year: number}} edition
 * @param {string} url            for the error message
 */
export function assertEdition(pageYear, edition, url) {
  if (pageYear === edition.year) return;
  const saw = pageYear == null ? "no edition label at all" : `the ${pageYear} edition`;
  const err = new Error(
    `Edition mismatch: asked ${edition.label} (${edition.year}) but ${url} carries ${saw}. ` +
    `Refusing to continue — if one archive URL can serve another edition, the pages ` +
    `already scraped in this run cannot be trusted either.`
  );
  // The scrapers wrap each program in a try/catch so one bad page cannot end a
  // thousand-page run, and count what it catches as a fetch failure. That is
  // right for a timeout and wrong for this: the fetch-failure rail tolerates
  // 2%, so ~11 pages could quietly carry the wrong edition into the archive
  // and the run would still be declared healthy. This flag is how the loop
  // tells the two apart.
  err.fatal = true;
  throw err;
}

/** Should this error end the whole run rather than fail one program? */
export function isFatalScrapeError(err) {
  return err?.fatal === true;
}
