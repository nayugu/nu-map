// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/courseNorm  (pure helpers, no I/O)
//
// Single source of truth for turning raw scraped catalog records into
// the internal Course shape. Environment-agnostic: imported by both the
// browser adapter (courseCatalog.js, fetch-based) and the Node adapter
// (courseCatalog.node.js, fs-based) so the two can never drift.
// ═══════════════════════════════════════════════════════════════════
import { subjectColor } from "../../core/courseModel.js";
import calendar from "./calendar.js";

/**
 * Earliest term code (numeric) where the course was ever confirmed offered.
 * Returns null when no true entries exist.
 * @param {Record<string,boolean>} termHistory
 * @returns {number|null}
 */
export function computeBirthTermCode(termHistory) {
  let birth = null;
  for (const [code, offered] of Object.entries(termHistory)) {
    if (offered === true) {
      const n = Number(code);
      if (birth === null || n < birth) birth = n;
    }
  }
  return birth;
}

/**
 * Compute which semester type IDs a course is offered in from termHistory.
 * Only entries on or after birthTermCode are considered — earlier entries are
 * pre-existence noise (Banner returning false before the course was created).
 * When post-birth history has only true entries, all decoded semTypes are included.
 * When it has mixed entries, a semType is included only if offered in at least
 * two-thirds (≥ 2⁄3) of that season's terms on record — a proportion, not a count.
 * @param {Record<string,boolean>} termHistory
 * @param {number|null} birthTermCode
 */
export function deriveTerms(termHistory, birthTermCode = null) {
  const entries = Object.entries(termHistory)
    .filter(([code]) => birthTermCode === null || Number(code) >= birthTermCode);
  if (entries.length === 0) return [];

  const hasNegative = entries.some(([, v]) => v === false);
  if (!hasNegative) {
    return [...new Set(entries.map(([code]) => calendar.decodeTermCode(code)).filter(Boolean))];
  }

  const semTypeIds = [...new Set(entries.map(([code]) => calendar.decodeTermCode(code)).filter(Boolean))];
  return semTypeIds.filter(id => {
    const ofType = entries.filter(([code]) => calendar.decodeTermCode(code) === id);
    return ofType.filter(([, v]) => v).length / ofType.length >= 2 / 3;
  });
}

/** Enrollment-restriction patterns sometimes stored in the description field instead of actual content. */
const RESTRICTION_ONLY = /^(not open to|open only to|restricted to|required only for|graduate students only|undergraduate students only|for [a-z, ]+(students|majors|minors))/i;

export function sanitizeDesc(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.length <= 150 && RESTRICTION_ONLY.test(s)) return "";
  return s;
}

/**
 * Normalize a raw catalog record into the internal Course shape.
 * Returns null if the record is missing a subject or number.
 *
 * @param {object} raw
 * @returns {import('../../ports/ICourseCatalog.js').Course|null}
 */
export function normalizeCourse(raw, subjectColleges = {}, nuPathSupp = {}) {
  const subject = (raw.subject || raw.subjectCode || "").toUpperCase().trim();
  const number  = (raw.number  || raw.courseNumber || raw.num || "").trim();
  if (!subject || !number) return null;

  const id    = `${subject}${number}`;
  const title = raw.title || raw.name || "";
  const sh    = typeof raw.credits     === "number" ? raw.credits
               : typeof raw.credit     === "number" ? raw.credit
               : typeof raw.creditHours=== "number" ? raw.creditHours
               : 4;

  // sections[]{term} — de-duplicate term codes
  const rawTermCodes = raw.terms?.length
    ? raw.terms
    : (raw.sections || []).map(s => (typeof s === "string" ? s : s?.term ?? "")).filter(Boolean);
  const uniqueCodes = [...new Set(rawTermCodes)];

  // Build termHistory: each code we have section data for is confirmed offered (true).
  // false entries are added later when term-history.json is merged in fetchAll().
  const termHistory = {};
  for (const code of uniqueCodes) {
    if (calendar.decodeTermCode(code)) termHistory[code] = true;
  }

  const birthTermCode = computeBirthTermCode(termHistory);
  const uniqueTerms   = deriveTerms(termHistory, birthTermCode);

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
    termHistory,
    birthTermCode,
    terms:        uniqueTerms,
    attributes:   (raw.nuPath?.length ? raw.nuPath : nuPathSupp[id]) ?? raw.attributes ?? [],
    color:        subjectColor(subject),
    isCps:        (subjectColleges[subject] ?? "") === "PS",
  };
}

/**
 * Merge Banner availability history + offering summary onto normalized courses.
 * Shared by the browser fetchAll() and the Node loader so the merge semantics
 * (past-terms-only filter, birth recompute) stay identical.
 *
 * @param {object[]} courses            normalized Course objects
 * @param {Record<string,Record<string,boolean>>|null} history  term-history.json
 * @param {Record<string,object>|null}  offering                offering-summary.json
 */
export function mergeHistoryAndOffering(courses, history, offering) {
  if (!history && !offering) return courses;

  return courses.map(course => {
    let c = course;
    const hist = history?.[course.id];
    if (hist && typeof hist === "object") {
      // Only merge past terms — future terms with false values skew probability.
      const pastHist = Object.fromEntries(
        Object.entries(hist).filter(([code]) => calendar.isTermPast(code))
      );
      const termHistory   = { ...course.termHistory, ...pastHist };
      const birthTermCode = computeBirthTermCode(termHistory);
      c = { ...course, termHistory, birthTermCode, terms: deriveTerms(termHistory, birthTermCode) };
    }
    const off = offering?.[course.id];
    return off ? { ...c, offering: off } : c;
  });
}
