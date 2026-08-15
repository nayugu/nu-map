// Worker data loader — the fetch counterpart of courseCatalog.node.js.
// Pulls the scraped JSON assets from the deployed site (DATA_ORIGIN) and
// normalizes them through the SAME shared pure modules the browser and
// the Node server use, then assembles the planner query adapter.
//
// Loaded once per isolate (module-global promise); ~15 MB of JSON parsed
// on cold start, cached in memory thereafter.

import { normalizeCourse, mergeHistoryAndOffering, stampCoopVariants } from "../../../src/adapters/northeastern/courseNorm.js";
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
  const [catalogJson, subjectColleges, history, offering, termDetails, bundle, dataMeta, coopJson] =
    await Promise.all([
      fetchJson(origin, "/northeastern/catalog-courses.json"),
      fetchJson(origin, "/northeastern/subject-colleges.json"),
      fetchJson(origin, "/northeastern/term-history.json"),
      fetchJson(origin, "/northeastern/offering-summary.json"),
      fetchJson(origin, "/northeastern/term-details.json"),
      fetchJson(origin, "/northeastern/programs-bundle.json"),
      fetchJson(origin, "/data-meta.json"),
      fetchJson(origin, "/northeastern/coop-courses.json"),
    ]);

  if (!catalogJson) throw new Error(`Could not load catalog from ${origin}`);
  const raw = Array.isArray(catalogJson) ? catalogJson : Object.values(catalogJson).flat();
  const normalized = raw.map(r => normalizeCourse(r, subjectColleges ?? {}, {})).filter(Boolean);
  const courses = mergeHistoryAndOffering(normalized, history, offering);
  // Same stamp the browser applies, so a Claude audit and the panel agree.
  stampCoopVariants(courses, coopJson);
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

  return createPlannerQuery({
    catalog,
    programs: { programs, programData, resolveProgramId },
    calendar, attributeSystem, specialTerms, creditSystem, offeringStats, courseUrl,
    sources: [
      { id: "catalog",  label: "catalog.northeastern.edu", url: "https://catalog.northeastern.edu/course-descriptions/", usedFor: "course catalog data" },
      { id: "nubanner", label: "nubanner.neu.edu",         url: "https://nubanner.neu.edu/StudentRegistrationSsb",       usedFor: "term availability, enrollment, and meeting-pattern history" },
    ],
  });
}

let _queryPromise = null;

/** Isolate-cached planner query adapter. */
export function getQuery(env) {
  _queryPromise ??= build(env.DATA_ORIGIN ?? "https://numap.app");
  return _queryPromise;
}
