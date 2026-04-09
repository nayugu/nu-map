// ═══════════════════════════════════════════════════════════════════
// COURSE MODEL  (pure domain logic — no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { SUBJECT_PALETTE } from "./constants.js";

// ── Subject colour ───────────────────────────────────────────────

/** Deterministic colour for a course subject string. */
export function subjectColor(subject) {
  let h = 0;
  for (let i = 0; i < subject.length; i++)
    h = (h * 31 + subject.charCodeAt(i)) & 0x7fffffff;
  return SUBJECT_PALETTE[h % SUBJECT_PALETTE.length];
}

// ── Course normalization ─────────────────────────────────────────

/**
 * Enrollment-restriction patterns that ninest/nu-courses sometimes
 * stores in the `description` field instead of actual content.
 * If a description *only* contains such a note we discard it so the
 * UI doesn't show "Not open to Freshmen." as the course summary.
 */
const RESTRICTION_ONLY = /^(not open to|open only to|restricted to|required only for|graduate students only|undergraduate students only|for [a-z, ]+(students|majors|minors))/i;

function sanitizeDesc(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  // If the entire description is ≤150 chars and reads like an enrollment
  // restriction, treat it as empty (no real description available).
  if (s.length <= 150 && RESTRICTION_ONLY.test(s)) return "";
  return s;
}

/**
 * Normalise a raw course record from ninest/nu-courses into the
 * internal shape used throughout the planner.
 * Returns null if the record is missing a subject or number.
 */
export function normalizeCourse(raw) {
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
  const rawTerms = raw.terms?.length
    ? raw.terms
    : (raw.sections || []).map(s => (typeof s === "string" ? s : s?.term ?? "")).filter(Boolean);
  const terms = [...new Set(rawTerms)];

  // creditsMax is set only for variable-credit courses (e.g. "1–4 Hours").
  // sh = min credits (conservative — use for all credit totals).
  // shMax = max credits (display only, e.g. "1–4 SH" in course cards).
  // shMin = same as data-min sh (preserved even after per-plan SH overrides).
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
    terms,
    attributes:   raw.nuPath ?? raw.attributes ?? [],  // nuPath: legacy ninest field name
    color:        subjectColor(subject),
  };
}

// ── Edge extraction ──────────────────────────────────────────────

/**
 * Extract prerequisite and corequisite edges from a course's
 * prereqs/coreqs data. Handles ninest's flat token array format
 * as well as nested sub-arrays.
 */
export function extractEdges(courseId, prereqs, coreqs) {
  const edges = [];

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "string") return; // "Or", "And", "(", ")"
    if (typeof node === "object" && node.subject && node.number)
      edges.push({
        from: `${node.subject.toUpperCase()}${node.number}`,
        to:   courseId,
        type: "prerequisite",
      });
  }

  walk(prereqs);

  (Array.isArray(coreqs) ? coreqs : []).forEach(r => {
    if (r && typeof r === "object" && r.subject && r.number)
      edges.push({
        from: `${r.subject.toUpperCase()}${r.number}`,
        to:   courseId,
        type: "corequisite",
      });
  });

  return edges;
}

// ── Offering helpers ─────────────────────────────────────────────

/**
 * Map NEU Banner term codes to the set of offered semester types.
 * NEU convention: YYYY10 = Fall, YYYY30 = Spring, YYYY40 = SumA, YYYY60 = SumB.
 * Returns null when no recognisable term codes are found (→ default ["fall","spring"]).
 */
export function getOfferedFromTerms(terms) {
  const set = new Set();
  (terms || []).forEach(t => {
    const code = typeof t === "string" ? t : (t?.code ?? "");
    const ss   = code.slice(-2);
    if      (ss === "10") set.add("fall");
    else if (ss === "30") set.add("spring");
    else if (ss === "40") set.add("sumA");
    else if (ss === "60") set.add("sumB");
  });
  return set.size > 0 ? [...set] : null;
}

/** Return the offering-type key for a semId string. */
export function getSemOfferedType(semId) {
  if (semId.startsWith("sumA"))  return "sumA";
  if (semId.startsWith("sumB"))  return "sumB";
  if (semId.startsWith("spr"))   return "spring";
  if (semId.startsWith("fall"))  return "fall";
  return null;
}
