// ═══════════════════════════════════════════════════════════════════
// COREQUISITE GROUPS — what counts as one course
//
// "Four courses of at least 3 SH" is the convention a full term is measured against, and
// applying it per CELL gets a whole class of term wrong. International Business Spring 2027:
//
//   ENGW 1111  4 SH        INTB 2205  2 SH  ┐ mutual corequisites, taken together,
//   MKTG 2201  4 SH        INTB 2206  2 SH  ┘ 4 SH between them
//   ECON 1116  4 SH
//
// Read per cell that is three real courses and two oddments, and the term is reported thin —
// then refused, because the criteria are hard. Read as the student takes it, it is FOUR
// courses and 16 credits: a completely ordinary spring.
//
// The registrar agrees with the second reading. `INTB 2205` lists `INTB 2206` as a
// corequisite and vice versa, so they cannot be taken apart; the pair is one decision, one
// enrolment event, and one line on the schedule. Counting it as two half-courses is our
// arithmetic, not the university's.
//
// ── Why this lives in core ──────────────────────────────────────────
//
// Which courses are corequisites is a fact from the catalog, not a scheduling judgement, and
// three readers need it: the engine (to build terms that satisfy the bar), the criteria check
// (not to refuse a plan that does), and `chart-gate` (to report the same number the engine
// aimed at). They disagreed once already about `offered`, four implementations deep.
// ═══════════════════════════════════════════════════════════════════

/** The canonical id of a corequisite reference, as the catalog stores them. */
const refId = (r) => `${String(r?.subject ?? "").toUpperCase()}${r?.number ?? ""}`;

/**
 * How many REAL courses a set of placed courses amounts to.
 *
 * Corequisite partners present in the same term are merged and counted once, at their
 * combined credit. A group reaches the bar when the group does — two 2 SH halves of one
 * course are one course of 4 SH, and a 1 SH lab attached to a 4 SH lecture adds nothing to
 * the count because it was never a second course.
 *
 * Only partners in THIS term merge. A corequisite scheduled elsewhere is a different problem
 * — the plan is wrong in a way the prereq gate reports — and quietly merging across terms
 * here would hide it behind a healthy-looking count.
 *
 * @param {{id: string, sh: number}[]} courses  what the term holds
 * @param {Record<string, object>} courseMap
 * @param {number} realCourseSH                the credit floor for one course
 * @returns {number}
 */
export function realCourseCount(courses, courseMap, realCourseSH) {
  const here = new Map();
  for (const c of courses ?? []) if (c?.id) here.set(c.id, c.sh ?? 0);
  if (!here.size) return 0;

  // Union-find over the corequisite edges that both ends of are in this term.
  const parent = new Map([...here.keys()].map(id => [id, id]));
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const id of here.keys()) {
    for (const r of courseMap?.[id]?.coreqs ?? []) {
      const partner = refId(r);
      if (here.has(partner)) union(id, partner);
    }
  }

  const groupSH = new Map();
  for (const [id, sh] of here) {
    const root = find(id);
    groupSH.set(root, (groupSH.get(root) ?? 0) + sh);
  }
  let n = 0;
  for (const sh of groupSH.values()) if (sh >= realCourseSH) n += 1;
  return n;
}
