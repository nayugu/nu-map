// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/courseCatalog.node  (Node.js, fs-based)
//
// The Node counterpart of courseCatalog.js: loads the same scraped data
// files from disk instead of over HTTP and normalizes them through the
// shared courseNorm module, so a course looks byte-identical whether it
// was loaded in the browser or by the MCP server.
//
// Also loads the Node-only extras the browser never fetches:
//   term-details.json  — per-term section/pattern detail (heavy)
//   change-log.json    — scrape run history
//   data-meta.json     — last-updated stamp shown in the app header
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCourse, mergeHistoryAndOffering } from "./courseNorm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PUB  = join(ROOT, "public/northeastern");

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function mtimeIso(path) {
  try { return statSync(path).mtime.toISOString(); } catch { return null; }
}

/**
 * Return the URL for the official Northeastern course catalog page for a course.
 * Links to the subject section; the registrar does not offer per-course deep links.
 */
export function courseUrl(course) {
  return `https://catalog.northeastern.edu/course-descriptions/${course.subject.toLowerCase()}/`;
}

/**
 * Load and normalize the full catalog from disk.
 * Mirrors courseCatalog.fetchAll() step for step (nuPath supplement gate,
 * past-terms-only history merge, offering attach).
 *
 * @returns {{
 *   courses: object[],
 *   courseMap: Record<string, object>,
 *   termDetails: Record<string, object>,
 *   subjectColleges: Record<string, string>,
 *   meta: object,
 * }}
 */
export function loadCatalog() {
  const catalogPath = join(PUB, "catalog-courses.json");
  const catalogJson = readJson(catalogPath);
  if (!catalogJson) throw new Error(`Could not load course catalog from ${catalogPath}`);
  const raw = Array.isArray(catalogJson) ? catalogJson : Object.values(catalogJson).flat();

  const subjectColleges = readJson(join(PUB, "subject-colleges.json")) ?? {};

  // Back-fill nuPath from all-courses.json only when the build-time merge
  // looks like it hasn't run (same <10% coverage gate as the browser).
  const nuPathCoverage = raw.filter(c => c.nuPath?.length > 0).length / raw.length;
  const nuPathSupp = {};
  if (nuPathCoverage < 0.10) {
    const allCourses = readJson(join(PUB, "all-courses.json"));
    if (Array.isArray(allCourses)) {
      for (const c of allCourses) {
        const id = `${(c.subject || "").toUpperCase().trim()}${(c.number || "").trim()}`;
        if (id && c.nuPath?.length) nuPathSupp[id] = c.nuPath;
      }
    }
  }

  const normalized = raw.map(r => normalizeCourse(r, subjectColleges, nuPathSupp)).filter(Boolean);

  const history  = readJson(join(PUB, "term-history.json"));
  const offering = readJson(join(PUB, "offering-summary.json"));
  const courses  = mergeHistoryAndOffering(normalized, history, offering);

  const courseMap = {};
  for (const c of courses) courseMap[c.id] = c;

  const termDetails = readJson(join(PUB, "term-details.json")) ?? {};
  const changeLog   = readJson(join(PUB, "change-log.json"));
  const dataMeta    = readJson(join(ROOT, "public/data-meta.json"));

  const meta = {
    lastUpdated: dataMeta?.lastUpdated ?? null,
    files: Object.fromEntries(
      ["catalog-courses.json", "term-history.json", "term-details.json",
       "offering-summary.json", "subject-colleges.json"]
        .map(f => [f, mtimeIso(join(PUB, f))])
    ),
    recentScrapeRuns: (changeLog?.runs ?? []).slice(0, 5),
  };

  return { courses, courseMap, termDetails, subjectColleges, meta };
}
