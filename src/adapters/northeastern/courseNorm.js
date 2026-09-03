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
import { parseRepeatability } from "./repeatability.js";
import { parseDescriptionGpaGate } from "./gpaGate.js";
import { parseDescriptionPrereq } from "./descriptionPrereq.js";
import { mergeDescriptionCoreqs } from "./descriptionCoreq.js";

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

/** Labelled prereqs if present, else the ones stated in the description. */
function descPrereqFallback(raw) {
  const labelled = raw.prereqs ?? raw.prerequisites ?? [];
  if (Array.isArray(labelled) && labelled.length) return labelled;
  return parseDescriptionPrereq(raw.description) ?? [];
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

  // Repeatability: prefer the fields the scraper writes (the canonical path);
  // until a scrape that includes them ships, derive them from the description
  // text the scraper already captured — same parser, same result.
  const rep = raw.repeatable !== undefined
    ? { max: raw.repeatMax ?? null, maxSH: raw.repeatMaxSH ?? null }
    : parseRepeatability(raw.description);
  const gpaGate = raw.minGPA ?? parseDescriptionGpaGate(raw.description);

  return {
    id, subject, number,
    code:         `${subject} ${number}`,
    title:        title.trim(),
    desc:         sanitizeDesc(raw.description),
    sh:           sh ?? 4,
    shMin,
    shMax,
    repeatable:   !!rep,
    repeatMax:    rep?.max   ?? null,
    repeatMaxSH:  rep?.maxSH ?? null,
    scheduleType: raw.scheduleType || "",
    // 33 courses state their prerequisite only in the description prose and
    // carry no Prerequisite(s) line, MATH 1342 (Calculus 2 → Calculus 1)
    // among them. Same pattern as repeatability and the GPA gate: the
    // scraper writes this field canonically, and this derives the identical
    // tokens from already-shipped data until that scrape lands. The labelled
    // field always wins — this only fills a genuinely empty one.
    prereqs:      descPrereqFallback(raw),
    // Corequisites are the labelled field UNION the ones the description
    // states, not a fallback: PHYS 1157 carries `Corequisite(s): PHYS 1155`
    // and a sentence naming PHYS 1155 and PHYS 1156, and the catalog means
    // both. Four PHYS lecture/lab/seminar triples are only complete this way
    // — PHYS 1152 has no labelled line at all, so the lab sat outside its own
    // triple. See descriptionCoreq.js for why the reader refuses everything
    // that is not a plain conjunction of course codes.
    coreqs:       mergeDescriptionCoreqs(raw.coreqs ?? raw.corequisites ?? [],
                                         raw.description, id),
    // A GPA gate stated in the description (3 courses corpus-wide). Same
    // pattern as repeatability above: prefer the scraper's field, else
    // derive it from the description. The fallback matters because a
    // subject whose fetch fails is carried forward wholesale, so a newly
    // added field would stay missing there until a later run succeeded.
    // Only ever compared against grades the user entered.
    ...(gpaGate != null ? { minGPA: gpaGate } : {}),
    termHistory,
    birthTermCode,
    terms:        uniqueTerms,
    attributes:   (raw.nuPath?.length ? raw.nuPath : nuPathSupp[id]) ?? raw.attributes ?? [],
    color:        subjectColor(subject),
    isCps:        (subjectColleges[subject] ?? "") === "PS",
    // ── Retired, but still required by an older catalog edition ────────────
    //
    // The scrape keeps a course NEU has removed while some shipped program
    // edition still requires it (scripts/lib/course-retention.js), because a
    // degree is locked to the catalog year the student entered under and the
    // alternative is a requirement row that can never be ticked — 3,660 of
    // them across 579 programs on the 2027 roll.
    //
    // It has to be carried THROUGH here, and this is not incidental
    // plumbing: `normalizeCourse` builds an explicit object, so an unlisted
    // field is silently dropped, and without this line the flag existed in
    // the JSON and nowhere in the app. The consequence is not a missing
    // badge, it is a WRONG one — `effectiveOffered` answers
    // `{ offered: true, source: "no-data" }` for any course with no term
    // history (correct for the 3,250 ordinary courses in that state), so a
    // retired course would read as offered in every term and CHART would
    // schedule a dead course into a future semester. Absent data and known
    // removal are different facts, and only one of them is evidence.
    //
    // Deliberately does NOT feed `offered`/`probability`: a probability of 0
    // blocks placement, which would turn the untickable row into a refused
    // plan — the same defect in a louder coat. The course stays placeable and
    // schedulable; what changes is that the app can say what it is.
    ...(raw.retired ? { retired: true, retiredSince: raw.retiredSince ?? null } : {}),
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
/**
 * Mark the courses that RECORD a work term, with the variant each one is.
 *
 * Read by core/specialTermUtils to resolve which course a placed co-op
 * registers — `CS 6964` for a Khoury student, `ENCP 6954` for a half-time
 * engineer — without the student naming a course number.
 *
 * ── Why this is shared rather than done at each loader ──────────────
 *
 * There are THREE catalog loaders: the browser adapter, the Node one behind
 * the dev MCP server, and the Cloudflare worker's. `plannerQueryAdapter`
 * promises in its own comments that an audit read over MCP and the panel on
 * screen "cannot disagree about the experiential requirement" — and they would
 * have, silently: a loader that skips the stamp resolves nothing, falls back
 * to the old single COOP 3945 grant, and reports a graduate student's co-op
 * requirement unmet while the app beside it reports it met.
 *
 * Mutates in place, matching the loaders' existing style. A null table leaves
 * every course untouched, which degrades to that same old single grant.
 *
 * @param {object[]} courses    normalized Course records
 * @param {object|null} coopJson  parsed coop-courses.json ({ courses: {...} })
 * @returns {object[]} the same array
 */
export function stampCoopVariants(courses, coopJson) {
  const table = coopJson?.courses;
  if (!table || typeof table !== "object") return courses;
  for (const c of courses) {
    const f = table[c.id];
    // `kind` says which BLOCK records the course — a co-op or an internship.
    // Files written before the field existed carry only the two flags, so it
    // defaults to "coop": the pre-internship behaviour, unchanged.
    if (f) c.coop = { abroad: !!f.abroad, halfTime: !!f.halfTime, kind: f.kind === "intern" ? "intern" : "coop" };
  }
  return courses;
}

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
