// ═══════════════════════════════════════════════════════════════════
// RESTRICTION PAGE CACHE — one gzipped file per term
//
// `getRestrictions` is one HTTP call per CRN: ~7,400 calls and ~30 minutes for
// a single term, and there was no raw cache anywhere in this repo. So every
// change to the parser cost a full re-fetch of every term — which is why the
// comma-split defect sat unnoticed, and why widening the parser to the other
// ten restriction kinds looked like a 4.5-hour job rather than a re-parse.
//
// This is the cache that makes the SECOND question about restrictions free.
//
// ── WHY ONE FILE PER TERM, and not one per page ────────────────────
//
// The probe's first cache wrote `<term>/<crn>.html`. Measured on the 1,299
// pages it had collected:
//
//   median page                                776 bytes
//   per-page gzip                              31.2% of raw
//   ONE gzipped JSON of all of them             2.7% of raw
//
// The pages are almost entirely identical boilerplate, so compressing them as
// one stream beats compressing them individually by more than 10x. Projected
// over 7,430 sections and 11 terms that is **2.2 MB in 11 files** against
// 64 MB in 82,000 — and the file count is the worse half: at a 4 KB block,
// 82,000 files of 776 bytes occupy about 330 MB of actual disk.
//
// ── WHAT IS IN IT ──────────────────────────────────────────────────
//
//   { term, generated, pages: { crn: html }, courses: { crn: courseId } }
//
// `courses` is here rather than in a sibling file because a CRN alone does not
// say which course it belongs to, and the two questions the cache exists to
// answer — does a course's sections agree, and does a course's restriction hold
// across terms — are both per-COURSE. A cache that loses that mapping can only
// answer the kind histogram.
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────
//
// Not a substitute for reading Banner for a term we have not attempted: a term
// with no cached pages is always fetched live.
//
// ⚠ This said "The scrape WRITES here and never reads" until 2026-09-16, and
// that was true when written and false afterwards — `--resume` became the
// DEFAULT and `scrape-availability.js` now calls `readTermCache` before
// fetching. Corrected here rather than left to be discovered, because a comment
// that understates what a module does is how the CI cache below went unbuilt for
// months: the sentence said caching this directory could not help, so nobody
// tried. (The same class of stale claim un-retired 19 courses the same week.)
//
// What the original sentence was protecting is still real and still holds, by a
// different mechanism: resume is only applied to COMPLETED terms, whose pages
// are frozen. A live term is re-read every time, so a stale cache cannot become
// the source. `reparse-restrictions.js` also reads, to re-derive stored fields
// without any network at all.
//
// `.cache/` is gitignored, so this is a local artifact — plus, since
// 2026-09-16, a restored `actions/cache` entry in `update-courses.yml`, which is
// what stops a failed monthly run having to re-fetch a ~21-minute term. A
// machine without it simply re-fetches, which is the status quo, not a
// regression.
// ═══════════════════════════════════════════════════════════════════

import { gzipSync, gunzipSync }                        from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, renameSync,
         existsSync, readdirSync, rmSync }             from "node:fs";
import { resolve, dirname, join }                      from "node:path";
import { fileURLToPath }                               from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Where the cache lives.
 *
 * Overridable so tests get a scratch tree. Without this they wrote fake term
 * codes into the real cache, and `cachedTerms()` then handed them straight to
 * `reparse-restrictions.js` — a test that quietly corrupts the artifact it is
 * testing. An env var rather than a parameter because every function here would
 * otherwise have to thread it, and there is exactly one cache per process.
 */
export const CACHE_DIR = process.env.NUMAP_RESTRICTION_CACHE
  ? resolve(process.env.NUMAP_RESTRICTION_CACHE)
  : resolve(ROOT, ".cache/banner/restrictions");

const filePath = (term) => join(CACHE_DIR, `${term}.json.gz`);

/** Terms with a cache file, ascending. */
export function cachedTerms() {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter(f => /^\d{6}\.json\.gz$/.test(f))
    .map(f => f.slice(0, 6))
    .sort();
}

/**
 * Read one term's cache.
 *
 * Transparently absorbs the LEGACY layout (`<term>/<crn>.html` plus an
 * `index.json` manifest) that the probe wrote before this module existed, so
 * pages already collected are not thrown away. The legacy directory is left in
 * place — `migrateLegacy` removes it, deliberately as a separate step, because
 * deleting captured pages should not be a side effect of reading them.
 *
 * @param {string} term
 * @returns {{term: string, generated: string|null, pages: Record<string,string>,
 *            courses: Record<string,string>}|null}
 */
export function readTermCache(term) {
  const p = filePath(term);
  if (existsSync(p)) {
    try {
      const doc = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));
      return {
        term,
        generated: doc.generated ?? null,
        pages:     doc.pages   ?? {},
        courses:   doc.courses ?? {},
      };
    } catch {
      // A truncated or half-written file must not look like an empty term.
      return null;
    }
  }
  return readLegacy(term);
}

function readLegacy(term) {
  const dir = join(CACHE_DIR, String(term));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith(".html"));
  if (!files.length) return null;
  const pages = {};
  for (const f of files) {
    try { pages[f.slice(0, -5)] = readFileSync(join(dir, f), "utf8"); } catch { /* skip */ }
  }
  let courses = {};
  const manifest = join(dir, "index.json");
  if (existsSync(manifest)) {
    try { courses = JSON.parse(readFileSync(manifest, "utf8")); } catch { /* none */ }
  }
  return { term, generated: null, pages, courses, legacy: true };
}

/**
 * Write one term's cache, merging over anything already there.
 *
 * Merged rather than replaced because a probe run samples a few hundred CRNs
 * while a scrape captures every one: a sampled run must not delete a full
 * capture, and vice versa. Written to a temp file and renamed, so an
 * interrupted write leaves the previous cache intact rather than a truncated
 * file that `readTermCache` would have to reject.
 *
 * @param {string} term
 * @param {Record<string,string>} pages    crn → raw html
 * @param {Record<string,string>} [courses] crn → courseId
 */
export function writeTermCache(term, pages, courses = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const prev = readTermCache(term);
  const doc = {
    term,
    generated: new Date().toISOString(),
    pages:   { ...(prev?.pages   ?? {}), ...pages },
    courses: { ...(prev?.courses ?? {}), ...courses },
  };
  const p = filePath(term);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }));
  renameSync(tmp, p);
  return { pages: Object.keys(doc.pages).length, courses: Object.keys(doc.courses).length };
}

/**
 * Fold a legacy per-page directory into the single-file form and delete it.
 * Separate from `readTermCache` on purpose: reading should never destroy.
 *
 * @returns {{term: string, pages: number}|null}
 */
export function migrateLegacy(term) {
  const legacy = readLegacy(term);
  if (!legacy) return null;
  const n = writeTermCache(term, legacy.pages, legacy.courses);
  rmSync(join(CACHE_DIR, String(term)), { recursive: true, force: true });
  return { term, pages: n.pages };
}

/** Every legacy term directory still present. */
export function legacyTerms() {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{6}$/.test(d.name))
    .map(d => d.name)
    .sort();
}
