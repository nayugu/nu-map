// UNIT · which sitemap entries are degree programs, and where they are fetched.
//
// The archive cases carry the surprise. An archived edition serves its pages
// under /archive/{label}/, but its sitemap is a SNAPSHOT of the sitemap that
// edition shipped with — the <loc> entries are the live urls of the day, with
// no archive prefix and on http. Reading them literally scrapes today's
// catalog and files it under a past year, which is the one failure the whole
// edition guard exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSitemapPrograms } from "../../scripts/lib/catalog-programs.js";

const sitemap = (...locs) =>
  `<?xml version="1.0"?><urlset>${locs.map(l =>
    `<url><loc>${l}</loc><lastmod>2022-06-24</lastmod></url>`).join("")}</urlset>`;

const UG = { pathPrefix: "/undergraduate/", minSegments: 3 };

test("sitemap › a live run keeps the sitemap's own urls", () => {
  const xml = sitemap(
    "https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/",
    "https://catalog.northeastern.edu/course-descriptions/cs/",
  );
  const got = parseSitemapPrograms(xml, UG);
  assert.deepEqual(got.map(p => p.url),
    ["https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/"]);
  assert.equal(got[0].college, "science");
  assert.equal(got[0].lastmod, "2022-06-24");
});

test("sitemap › three segments is a program (the BSBA regression)", () => {
  // /undergraduate/business/business-administration-bsba/ has no department
  // level. Requiring four segments dropped Business Administration BSBA from
  // the dataset entirely.
  const xml = sitemap("https://catalog.northeastern.edu/undergraduate/business/business-administration-bsba/");
  assert.equal(parseSitemapPrograms(xml, UG).length, 1);
});

test("sitemap › concentration pages are requirement fragments, not programs", () => {
  const xml = sitemap("https://catalog.northeastern.edu/undergraduate/business/concentrations/finance/");
  assert.deepEqual(parseSitemapPrograms(xml, UG), []);
});

// ── Archive rebuilding ───────────────────────────────────────────────────────

const ARCHIVE = "https://catalog.northeastern.edu/archive/2022-2023";

test("sitemap › an archive run rebuilds every url onto its edition", () => {
  // Verbatim shape from the 2022-2023 sitemap: no archive prefix, and http.
  const xml = sitemap("http://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/");
  const got = parseSitemapPrograms(xml, { ...UG, urlBase: ARCHIVE });
  assert.deepEqual(got.map(p => p.url),
    ["https://catalog.northeastern.edu/archive/2022-2023/undergraduate/science/biology/biology-bs/"]);
  // Scheme comes from the base, so the http in the snapshot is not carried
  // into the requests we make.
  assert.ok(got[0].url.startsWith("https://"));
});

test("sitemap › archive paths classify exactly like live ones", () => {
  // The point of rebuilding rather than stripping: the paths arrive already in
  // live shape, so college, minSegments and the concentration filter need no
  // archive-specific rules to reason about.
  const xml = sitemap(
    "http://catalog.northeastern.edu/undergraduate/business/concentrations/finance/",
    "http://catalog.northeastern.edu/undergraduate/business/business-administration-bsba/",
    "http://catalog.northeastern.edu/course-descriptions/cs/",
    "http://catalog.northeastern.edu/graduate/science/biology/biology-ms/",
  );
  const got = parseSitemapPrograms(xml, { ...UG, urlBase: ARCHIVE });
  assert.equal(got.length, 1);
  assert.equal(got[0].college, "business");
  assert.equal(got[0].url, `${ARCHIVE}/undergraduate/business/business-administration-bsba/`);
});

test("sitemap › duplicates collapse after rebuilding, not before", () => {
  // http and https forms of one page are one page.
  const xml = sitemap(
    "http://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/",
    "https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs",
  );
  assert.equal(parseSitemapPrograms(xml, { ...UG, urlBase: ARCHIVE }).length, 1);
});
