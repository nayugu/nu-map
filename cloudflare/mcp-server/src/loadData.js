// Worker data loader — the fetch counterpart of courseCatalog.node.js.
// Pulls the scraped JSON assets from the deployed site (DATA_ORIGIN) and
// normalizes them through the SAME shared pure modules the browser and
// the Node server use, then assembles the planner query adapter.
//
// Loaded once per isolate (module-global promise); ~15 MB of JSON parsed
// on cold start, cached in memory thereafter.

import { normalizeCourse, mergeHistoryAndOffering, mergeRetiredUnion, stampCoopVariants, stampCoopPrep, stampRestrictions } from "../../../src/adapters/northeastern/courseNorm.js";
import { parseMajorPathParts, resolveInMap } from "../../../src/data/programPaths.js";
import calendar from "../../../src/adapters/northeastern/calendar.js";
import attributeSystem from "../../../src/adapters/northeastern/attributeSystem.js";
import specialTerms from "../../../src/adapters/northeastern/specialTerms.js";
import creditSystem from "../../../src/adapters/northeastern/creditSystem.js";
import * as offeringStats from "../../../src/adapters/northeastern/offeringStats.js";
import { createPlannerQuery } from "../../../src/adapters/mcp/plannerQueryAdapter.js";

function courseUrl(course) {
  return `https://catalog.northeastern.edu/course-descriptions/${course.subject.toLowerCase()}/`;
}

async function fetchJson(origin, path) {
  try {
    const res = await fetch(`${origin}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function build(origin) {
  const [catalogJson, subjectColleges, history, offering, termDetails, bundle, dataMeta, coopJson, restrJson, retiredJson] =
    await Promise.all([
      fetchJson(origin, "/northeastern/catalog-courses.json"),
      fetchJson(origin, "/northeastern/subject-colleges.json"),
      fetchJson(origin, "/northeastern/term-history.json"),
      fetchJson(origin, "/northeastern/offering-summary.json"),
      fetchJson(origin, "/northeastern/term-details.json"),
      fetchJson(origin, "/northeastern/programs-bundle.json"),
      fetchJson(origin, "/data-meta.json"),
      fetchJson(origin, "/northeastern/coop-courses.json"),
      fetchJson(origin, "/northeastern/restrictions.json"),
      fetchJson(origin, "/northeastern/retired-courses.json"),
    ]);

  if (!catalogJson) throw new Error(`Could not load catalog from ${origin}`);
  const raw = Array.isArray(catalogJson) ? catalogJson : Object.values(catalogJson).flat();
  // Courses a frozen edition published that this catalog no longer does —
  // merged here for the same reason as the stamps below: Claude must resolve
  // the same courses the browser can, or an audit over MCP reports a plan as
  // missing a course the student can see on their own board.
  const rawWithRetired = mergeRetiredUnion(raw, retiredJson);
  const normalized = rawWithRetired.map(r => normalizeCourse(r, subjectColleges ?? {}, {})).filter(Boolean);
  const courses = mergeHistoryAndOffering(normalized, history, offering);
  // Same stamps the browser applies, so a Claude audit and the panel agree.
  stampCoopVariants(courses, coopJson);
  stampCoopPrep(courses, coopJson);
  stampRestrictions(courses, restrJson);
  const courseMap = {};
  for (const c of courses) courseMap[c.id] = c;

  const catalog = {
    courses, courseMap,
    termDetails: termDetails ?? {},
    subjectColleges: subjectColleges ?? {},
    meta: {
      lastUpdated: dataMeta?.lastUpdated ?? null,
      dataOrigin: origin,
      programsGeneratedAt: bundle?.generatedAt ?? null,
    },
  };

  // Program registry from the build-time bundle (same shape as the Node
  // fs scanner, same stale-path resolution semantics).
  const programs    = bundle?.programs ?? [];
  const programData = new Map(Object.entries(bundle?.programData ?? {}));
  const registry    = Object.fromEntries([...programData.keys()].map(k => [k, true]));

  function resolveProgramId(id) {
    if (!id) return null;
    const parts = parseMajorPathParts(id);
    const compact = parts && parts.college && parts.folder
      ? `${parts.year}/${parts.college}/${parts.folder}`
      : id;
    if (programData.has(compact)) return compact;
    return resolveInMap(registry, compact, parseMajorPathParts);
  }

  const query = createPlannerQuery({
    catalog,
    programs: { programs, programData, resolveProgramId },
    calendar, attributeSystem, specialTerms, creditSystem, offeringStats, courseUrl,
    sources: [
      { id: "catalog",  label: "catalog.northeastern.edu", url: "https://catalog.northeastern.edu/course-descriptions/", usedFor: "course catalog data" },
      { id: "nubanner", label: "nubanner.neu.edu",         url: "https://nubanner.neu.edu/StudentRegistrationSsb",       usedFor: "term availability, enrollment, and meeting-pattern history" },
    ],
  });

  // Attached here rather than inside createPlannerQuery because it answers a
  // question about THIS load — what actually arrived over the eight
  // subrequests above — not about the planner. `termDetails` is counted
  // separately from courses because it is the largest single asset (8.3 MB)
  // and the most likely of the eight to have been the one that failed: a
  // fetchJson miss returns null and is swallowed by `?? {}`, so without this
  // the worker would answer questions about offerings with silent blanks.
  query.healthCounts = () => ({
    courses: courses.length,
    programs: programs.length,
    termDetails: Object.keys(catalog.termDetails).length,
  });

  return query;
}

let _queryPromise = null;

// When this isolate first built its adapter, and how long that took. Both are
// module-global, so they answer "was this request served by a cold isolate"
// without the caller having to infer it from a stopwatch.
//
// That inference was the only tool available before, and it is unreliable in
// the direction that matters: measured against production on 2026-08-22, ten
// sequential /health calls split 6 warm / 4 cold, and a second run minutes
// later split 11 warm / 1 cold. Same worker, same code — the cold ratio is a
// property of how much traffic has recently arrived, and the burst this
// project is being prepared for is precisely the moment when many isolates
// start at once and each independently re-pulls the whole dataset.
let _builtAt = null;
let _buildMs = null;

/** Isolate-cached planner query adapter. */
export function getQuery(env) {
  if (!_queryPromise) {
    const t0 = Date.now();
    _queryPromise = build(env.DATA_ORIGIN ?? "https://numap.app");
    _queryPromise.then(
      () => { _builtAt = Date.now(); _buildMs = Date.now() - t0; },
      // A failed build must not be cached: the next request would inherit a
      // rejected promise forever and this isolate would be permanently dead
      // while reporting nothing unusual.
      (err) => { _queryPromise = null; throw err; },
    ).catch(() => {});
  }
  return _queryPromise;
}

/**
 * What this isolate knows about its own startup — for /health, so a probe can
 * read the cold/warm split as a fact rather than guess it from latency.
 */
export function isolateStats() {
  return {
    builtAt: _builtAt ? new Date(_builtAt).toISOString() : null,
    buildMs: _buildMs,
    ageMs: _builtAt ? Date.now() - _builtAt : null,
  };
}
