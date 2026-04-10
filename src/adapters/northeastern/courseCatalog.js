// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/courseCatalog  (implements ICourseCatalog)
//
// Data source: ninest/nu-courses via husker.vercel.app
// Raw term codes: NEU Banner format — YYYY10=Fall, YYYY30=Spring,
//                 YYYY40=Summer A, YYYY60=Summer B  (decoded here during normalization)
//
// This adapter owns the full fetch-and-normalize pipeline.  The core
// never sees raw ninest records or Banner term codes.
// ═══════════════════════════════════════════════════════════════════
import { subjectColor } from "../../core/courseModel.js";
import calendar from "./calendar.js";

const LOCAL_URL = `${import.meta.env.BASE_URL}northeastern/all-courses.json`;
const API_URL   = "https://husker.vercel.app/courses/all";

// ── Normalization ────────────────────────────────────────────────

/**
 * Enrollment-restriction patterns that ninest/nu-courses sometimes
 * stores in the `description` field instead of actual content.
 */
const RESTRICTION_ONLY = /^(not open to|open only to|restricted to|required only for|graduate students only|undergraduate students only|for [a-z, ]+(students|majors|minors))/i;

function sanitizeDesc(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.length <= 150 && RESTRICTION_ONLY.test(s)) return "";
  return s;
}

/**
 * Normalize a raw ninest/nu-courses record into the internal Course shape.
 * Returns null if the record is missing a subject or number.
 * Term codes are decoded to semester type IDs here so the core never sees Banner codes.
 *
 * @param {object} raw - Raw record from ninest/nu-courses
 * @returns {import('../../ports/ICourseCatalog.js').Course|null}
 */
function normalizeCourse(raw) {
  const subject = (raw.subject || raw.subjectCode || "").toUpperCase().trim();
  const number  = (raw.number  || raw.courseNumber || raw.num || "").trim();
  if (!subject || !number) return null;

  const id    = `${subject}${number}`;
  const title = raw.title || raw.name || "";
  const sh    = typeof raw.credits     === "number" ? raw.credits
               : typeof raw.credit     === "number" ? raw.credit
               : typeof raw.creditHours=== "number" ? raw.creditHours
               : 4;

  // ninest/nu-courses: sections[]{term} — de-duplicate term codes
  const rawTermCodes = raw.terms?.length
    ? raw.terms
    : (raw.sections || []).map(s => (typeof s === "string" ? s : s?.term ?? "")).filter(Boolean);
  const uniqueCodes = [...new Set(rawTermCodes)];

  // Decode Banner term codes → semester type IDs ("202430" → "spring")
  const terms = uniqueCodes
    .map(code => calendar.decodeTermCode(code))
    .filter(Boolean);
  const uniqueTerms = [...new Set(terms)];

  const shMax = typeof raw.creditsMax === "number" && raw.creditsMax !== sh
    ? raw.creditsMax : null;
  const shMin = shMax !== null ? (sh ?? 4) : null;

  return {
    id, subject, number,
    code:         `${subject} ${number}`,
    title:        title.trim(),
    desc:         sanitizeDesc(raw.description),
    sh:           sh ?? 4,
    shMin,
    shMax,
    scheduleType: raw.scheduleType || "",
    prereqs:      raw.prereqs ?? raw.prerequisites ?? [],
    coreqs:       raw.coreqs  ?? raw.corequisites  ?? [],
    terms:        uniqueTerms,
    attributes:   raw.nuPath ?? raw.attributes ?? [],  // nuPath: legacy ninest field name
    color:        subjectColor(subject),
  };
}

// ── Fetch ────────────────────────────────────────────────────────

async function tryFetch(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error(`Got HTML (not JSON) from ${url}`);
  return JSON.parse(text);
}

// ── Adapter ──────────────────────────────────────────────────────

/** @type {import('../../ports/ICourseCatalog.js').ICourseCatalog} */
export default {
  /**
   * Fetch the full course catalog and return all courses normalized to the Course shape.
   * Tries the bundled local JSON first; falls back to the live API.
   */
  async fetchAll() {
    let json;
    try {
      json = await tryFetch(LOCAL_URL);
    } catch (localErr) {
      console.warn("Local file unavailable, trying API:", localErr.message);
      try {
        json = await tryFetch(API_URL);
      } catch (apiErr) {
        throw new Error(
          `Could not load course catalog.\n` +
          `\u2022 Local (${LOCAL_URL}): ${localErr.message}\n` +
          `\u2022 API (${API_URL}): ${apiErr.message}`
        );
      }
    }
    const raw = Array.isArray(json) ? json : Object.values(json).flat();
    return raw.map(normalizeCourse).filter(Boolean);
  },

  /** Normalize a single raw ninest/nu-courses record into the Course shape. */
  normalize: normalizeCourse,

  /**
   * Return the URL for the official Northeastern course catalog page for a course.
   * Links to the subject section; the registrar does not offer per-course-number deep links.
   */
  courseUrl(course) {
    return `https://catalog.northeastern.edu/course-descriptions/${course.subject.toLowerCase()}/`;
  },

  getSources() {
    return [
      {
        id:      "nu-courses",
        label:   "ninest/nu-courses",
        url:     "https://github.com/ninest/nu-courses",
        author:  "ninest",
        usedFor: "course catalog data",
      },
    ];
  },
};
