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

// ── Ink courses: a work term is not a department ─────────────────
//
// A course you REGISTER for to record a work term is the plan's own structure
// showing up as a course, so it is drawn in the theme's ink — white on dark,
// black on light — which takes it out of the subject-hue competition. A course
// you SIT IN keeps its department's hue, however co-op-ish its title.
//
// The test is `course.coop`, stamped by `stampCoopVariants` from
// `public/northeastern/coop-courses.json` — the SAME table the co-op grant
// resolves against, so the colour and the requirement can never disagree about
// what a work term is. Nothing here re-derives it:
//
//  - a title regex was the first attempt and it was wrong in both directions.
//    It swept in the 22 prep seminars (`CS 1210 Professional Development for
//    Khoury Co-op` is a 1 SH class you attend) and `ENCP 6100 Introduction to
//    Cooperative Education`, which sits one number away from a registration in
//    the same subject.
//  - a subject rule (`COOP`/`COP`) was wrong too: `COP 3940 Personal and
//    Career Development` is an ordinary class inside the co-op subject.
//  - the NUPath EX attribute is far too broad — 217 courses across 88
//    subjects, including "Boston in Literature". Colour would then mean two
//    things at once: which department, and which NUPath.
//
// The table is derived by `scripts/derive-coop-courses.js` behind three guards
// (every work term must be 0 SH, no >20% shrink, no overlap with the prep
// titles), so the classification is adjudicated once, in the pipeline, not
// re-guessed per render. It is also an OPTIONAL asset: if it fails to load,
// no course is stamped, nothing inks, and every card keeps its palette hue —
// less information, never wrong information.

/**
 * True when this course is drawn in ink. Reservations are exempt: a
 * placeholder for a requirement named "Co-op" is still an empty slot, and it
 * has its own neutral grey.
 */
export function isInkCourse(course) {
  return !!(course && !course.isReservation && course.coop);
}

/**
 * True when a whole GROUP inks — a subject header or a stats bucket whose
 * every course is a work term. Read from the courses rather than from the
 * subject name, because no subject is uniformly one or the other.
 */
export function isInkGroup(courses) {
  return Array.isArray(courses) && courses.length > 0 && courses.every(isInkCourse);
}

/**
 * Theme-aware colour for a course: ink for a work term, otherwise the
 * palette hue already on the record.
 *
 * Kept as a hex — callers do arithmetic on it (relevance fade, selection
 * glow, `${col}50` alpha suffixes), so a CSS variable would not do.
 */
export function courseInk(course, isDark) {
  if (isInkCourse(course)) return INK(isDark);
  return course?.color ?? subjectColor(course?.subject ?? "");
}

/** The ink itself, for a group header that has no course record to pass. */
export const INK = isDark => (isDark ? "#ffffff" : "#000000");

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
        ...(node.concurrent ? { concurrent: true } : {}),
        // the edge's own gate — the grade-violation line check needs it
        ...(node.minGrade ? { minGrade: node.minGrade } : {}),
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

/**
 * The courses that must move with `id`, because they must be taken together.
 *
 * Symmetric on purpose: 19 of the corpus's corequisite pairs are declared on
 * one side only (ARCH 1310 names ARCH 1311; ARCH 1311 names nothing), and a
 * one-way rule would carry the partner in one drag direction and abandon it in
 * the other.
 *
 * ── The WHOLE group, not just the neighbours ───────────────────────
 *
 * This walks the connected component. An earlier version returned direct
 * neighbours only, on the reasoning that nothing in the catalog needs more —
 * that was wrong, and a fuzz run over random drops found it. Measured over the
 * live catalog: 505 corequisite edges form 225 groups, of which 20 hold three
 * courses (the CHEM lecture + lab + recitation triples), and three of those
 * are CHAINS rather than triangles — GSND 5110–5111–5112, NRSG 2220–2221–2222
 * and NRSG 4889–4996–4995, where the two ends do not name each other. Moving
 * an end by its neighbours alone carried the middle and abandoned the far end,
 * splitting a group that must be taken in one term.
 *
 * The walk is bounded by the data, not by a depth limit: the largest group in
 * the corpus is 3, so at most two other cards travel. A limit would be a
 * guess; the component is the actual answer to "what must stay together".
 *
 * Extracted because every drag handler needs it and each had its own copy of
 * the same filter/map/dedupe. Copies are how the swap path came to carry the
 * dragged card's partners and not the displaced card's — one of them was
 * simply never written.
 *
 * @param {Array}  edges     all graph edges (`allEdges`)
 * @param {string} id        the card being moved
 * @param {string[]} exclude ids already spoken for by another group
 */
export function coreqPartnersOf(edges, id, exclude = []) {
  if (!id) return [];

  // One pass to index the corequisite edges, then a walk. Building the map per
  // call keeps this a pure function of its arguments; drags are single events,
  // not a hot loop.
  const near = new Map();
  const link = (a, b) => {
    if (!near.has(a)) near.set(a, new Set());
    near.get(a).add(b);
  };
  for (const e of edges ?? []) {
    if (e?.type !== "corequisite" || !e.from || !e.to || e.from === e.to) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }

  const skip = new Set([id, ...exclude]);
  const out = new Set();
  const stack = [id];
  const seen = new Set([id]);
  while (stack.length) {
    for (const other of near.get(stack.pop()) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      // An excluded id is not carried, and the walk does not pass THROUGH it
      // either: it belongs to another group that is already moving, and
      // reaching further through it would drag that group's members along.
      if (skip.has(other)) continue;
      out.add(other);
      stack.push(other);
    }
  }
  return [...out];
}

/** Strongest relation wins when one pair of courses carries several edges. */
const REL_RANK = { "corequisite-viol": 2, corequisite: 1, prerequisite: 0 };

/**
 * The courses a details panel lists under UNLOCKS for `id`: everything it is a
 * prerequisite of, plus its corequisite partners. Incoming prerequisites are
 * excluded — the panel prints those on its own "Prereqs:" line.
 *
 * ONE ROW PER PARTNER COURSE, which is the whole point of this function. The
 * edge list holds one edge per catalog statement, and a single pair of courses
 * routinely produces several — none of them distinguishable in the row that
 * gets drawn, so the panel printed the same course twice:
 *
 *   • a corequisite declared on BOTH sides is two edges. IE 4522 names
 *     IE 4523 and IE 4523 names IE 4522, so Human-Machine Systems listed its
 *     own lab twice. Measured over the live catalog, 243 of the 262 coreq
 *     groups are mutual (505 edges, only 19 one-sided) — the ordinary case,
 *     not a corner.
 *   • a prerequisite named in two branches of one OR is two edges differing
 *     only in the gate: ACCT 5230 unlocks ACCT 5232 at D- in one branch and
 *     C- in the other. 352 such pairs, 88 of which differ in minGrade or
 *     `concurrent`. Neither is shown here, so both rows read identically.
 *
 * Returns `{ id, type }` in first-appearance order. `type` is the strongest
 * relation the pair carries, so a misplaced corequisite still badges as one
 * whichever direction's edge the list happened to hold first.
 */
export function relatedPartners(id, edges) {
  const rank = t => REL_RANK[t] ?? 0;
  const rows = [];
  const byId = new Map();
  for (const e of edges ?? []) {
    const coreq = e.type === "corequisite" || e.type === "corequisite-viol";
    const isOut = e.from === id;
    if (!isOut && !(coreq && e.to === id)) continue;
    const otherId = isOut ? e.to : e.from;
    if (otherId === id) continue;              // a self-edge is not a relationship
    const row = byId.get(otherId);
    if (!row) {
      const added = { id: otherId, type: e.type };
      byId.set(otherId, added);
      rows.push(added);
    } else if (rank(e.type) > rank(row.type)) {
      row.type = e.type;
    }
  }
  return rows;
}

// ── Offering helpers ─────────────────────────────────────────────

/**
 * Map raw catalog term codes to the set of offered semester type IDs.
 *
 * @param {Array}    terms            - Raw term entries from course data (strings or objects with .code)
 * @param {Function} [decodeTermCode] - Institution-specific decoder: term code → semester type ID string.
 *                                     From ICalendar.decodeTermCode.  When omitted, falls back to the
 *                                     NU Banner convention (YYYY10=fall, YYYY30=spring, etc.) so
 *                                     existing call sites that don't pass the parameter continue to work.
 * @returns {string[]|null} Array of semester type IDs, or null when no recognisable codes are found.
 */
export function getOfferedFromTerms(terms, decodeTermCode = null) {
  const set = new Set();
  (terms || []).forEach(t => {
    const code = typeof t === "string" ? t : (t?.code ?? "");
    let type;
    if (decodeTermCode) {
      type = decodeTermCode(code);
    } else {
      // Backward-compat fallback: NU Banner convention
      const ss = code.slice(-2);
      if      (ss === "10") type = "fall";
      else if (ss === "30") type = "spring";
      else if (ss === "40") type = "sumA";
      else if (ss === "60") type = "sumB";
    }
    if (type) set.add(type);
  });
  return set.size > 0 ? [...set] : null;
}
