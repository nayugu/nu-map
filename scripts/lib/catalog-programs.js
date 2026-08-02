/**
 * catalog-programs.js — discovering which catalog pages are degree programs.
 *
 * Shared by scrape-majors.js and scrape-grad-majors.js, which differ only in a
 * URL prefix.
 *
 * ## Why the sitemap, not /azindex/
 *
 * Both scrapers used to walk `catalog.northeastern.edu/azindex/`. That path is
 * explicitly `Disallow`ed in the catalog's robots.txt, so every run was a
 * violation. `/sitemap.xml` is allowed (robots.txt even advertises it), lists
 * the same program pages, and carries a `<lastmod>` per URL that the
 * verification harness uses as a free change signal.
 *
 * ## Why >= 3 path segments
 *
 * The undergrad scraper required >= 4 (`/undergraduate/{college}/{dept}/{degree}/`)
 * on the assumption that every program is department-nested. It isn't:
 * `/undergraduate/business/business-administration-bsba/` has three, which is
 * why **Business Administration BSBA — Boston and Oakland — was missing from
 * the dataset entirely**, along with Business Administration and Law. The grad
 * scraper already used >= 3. Non-program pages that slip through this looser
 * filter are rejected later by the "no requirement tables" check, which is the
 * correct place to reject them: by content, not by URL shape.
 */

/** Concentration detail pages are requirement fragments, not standalone programs. */
const CONCENTRATION_PATH = /\/(?:under)?graduate\/[^/]+\/concentrations\//;

/**
 * Extract program entries from a sitemap.xml body.
 *
 * @param {string} xml        raw sitemap.xml
 * @param {object} profile
 * @param {string} profile.pathPrefix     e.g. "/undergraduate/"
 * @param {number} [profile.minSegments=3]
 * @returns {{url: string, college: string, lastmod: string|null, name: string}[]}
 */
export function parseSitemapPrograms(xml, { pathPrefix, minSegments = 3 }) {
  const seen = new Set();
  const programs = [];

  // <url><loc>…</loc><lastmod>…</lastmod></url> — order within <url> is fixed
  // by the sitemap spec, so a non-greedy pair match is safe here.
  const entry = /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g;

  for (const [, rawLoc, rawMod] of xml.matchAll(entry)) {
    const loc = rawLoc.trim();
    let path;
    try { path = new URL(loc).pathname; } catch { continue; }

    if (!path.startsWith(pathPrefix)) continue;
    if (CONCENTRATION_PATH.test(path)) continue;

    const parts = path.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < minSegments) continue;

    const url = loc.replace(/\/?$/, '/');
    if (seen.has(url)) continue;
    seen.add(url);

    programs.push({
      url,
      college: parts[1] ?? 'unknown',
      lastmod: rawMod?.trim() || null,
      // The AZ index used to supply a label here, but it was never read —
      // scrapeProgram takes the name from the page's <h1>.
      name: '',
    });
  }

  return programs;
}
