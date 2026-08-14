// ═══════════════════════════════════════════════════════════════════
// CRITERIA — the hard rules, stated once, over an ASSIGNMENT
//
// The rules a plan must satisfy or not be offered: no empty semester, and every full term
// carrying four real courses. They were checked in exactly one place — `criteriaFailures`, on
// the emitted document, after everything else had finished — and that placement caused three
// separate defects, all of the same shape.
//
//   - the DFS returned the first COMPLETE assignment, because completeness was its goal test.
//     `emit` built it, the criteria refused it, and a degree the search had already proved
//     arrangeable produced nothing.
//   - the packer verified capacity, slots, precedence and the witness, and knew nothing about
//     the four-course bar, so its rescue could produce a plan that was then refused.
//   - and because the search had SUCCEEDED, the packer that would have done better was never
//     reached at all.
//
// A constructor that cannot tell whether its own answer is acceptable will keep producing
// unacceptable answers confidently. So the rules live here, every constructor consults them
// before returning, and no constructor can hand back a plan that will be thrown away.
//
// ── This does NOT replace the check on the emitted document ─────────
//
// `criteriaFailures` in `index.js` stays, and stays last. An assignment and the document built
// from it have disagreed before — a co-op term with no marker read as an empty semester until
// `emit` was fixed — and the artifact is what the student sees. Two checks over two
// representations is the point, not duplication: this one steers construction, that one
// decides publication.
// ═══════════════════════════════════════════════════════════════════

import { realCourseCount } from "../core/coreqGroups.js";
import { termIsFull } from "./calibration.js";

/**
 * Real courses in a term, counting a corequisite group as the one course it is.
 *
 * Named cells resolve to their course so `INTB 2205` and `INTB 2206` — 2 SH each, mutually
 * required, one enrolment — merge into a single 4 SH course. A cell with no single named
 * option cannot be resolved, so it counts on its own credit; that is the honest reading, since
 * whichever course fills it will be a course.
 */
export function realCoursesInTerm(cells, courseMap, realCourseSH) {
  const named = [];
  let anonymous = 0;
  for (const c of cells) {
    const ids = c.candidates?.length === 1 ? c.candidates : c.cell?.groups?.[0];
    if (ids?.length) named.push({ id: ids[0], sh: c.cell?.sh ?? 0 });
    else if ((c.cell?.sh ?? 0) >= realCourseSH) anonymous += 1;
  }
  return realCourseCount(named, courseMap, realCourseSH) + anonymous;
}

/**
 * Is this cell a co-op? The flag when the cell carries one, the course code otherwise.
 *
 * `emit` decides a term is a co-op term from the cell's own `coop` marker, so that is the
 * authority; the code prefix is the fallback for a cell whose marker has not been set yet at
 * the point the constructors ask. Both are needed: the assignment and the document are two
 * representations, and this predicate has to answer the same way over either.
 */
const isCoop = (c) =>
  c?.cell?.coop === true
  || (c?.cell?.groups?.[0] ?? c?.candidates ?? []).some(id => /^(COOP|EEBA)\d/.test(String(id)));

/**
 * Does this assignment satisfy the hard criteria?
 *
 * Mirrors `criteriaFailures`' exemptions EXACTLY, and the mirroring is the whole contract: a
 * constructor that judged itself more harshly would refuse plans the gate accepts, and one
 * that judged itself more leniently would hand back plans the gate refuses. Both are failures
 * of the same kind — two opinions about one rule.
 *
 *   - a term the student spends employed holds no courses and is exempt
 *   - a summer is exempt; the criteria never judge a half term, which legitimately holds two
 *   - an optional term a department left blank is exempt, because `emit` trims it
 *
 * @param {Map<string|number, number>} termOf   cell id → term index
 * @param {{cell: object, candidates: string[]|null}[]} plans
 * @param {object[]} terms
 * @param {object} args
 * @returns {{term: number, reason: string, real?: number, want?: number}[]}  empty when acceptable
 */
export function assignmentFailures(termOf, plans, terms, {
  cal, studentType = "undergraduate", courseMap = {}, minCourses,
  // The term's credit ceiling, which is what decides whether a thin-looking term is actually
  // full — a 16 SH studio leaves no room for a fourth course. Injected because the ceiling is
  // the caller's (it depends on the student type and the ports), not this module's.
  capOf = () => Infinity,
}) {
  const out = [];
  if (!(minCourses > 0)) return out;

  const inTerm = terms.map(() => []);
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti != null && inTerm[ti]) inTerm[ti].push(p);
  }

  for (let ti = 0; ti < terms.length; ti++) {
    const t = terms[ti];
    if (t.work || t.unused || t.optional || (t.weight ?? 1) < 1) continue;
    // And by NAME, because that is how the gate does it. `criteriaFailures` skips a term whose
    // label matches "Summer 1/2/A/B" and never consults `weight`; a shape whose summer carries
    // weight 1 is therefore exempt there and judged here. Mirroring means copying the rule,
    // not a rule that usually agrees with it.
    if (/summer\s*(1|2|a|b)/i.test(String(t.termLabel ?? t.term ?? ""))) continue;
    const cells = inTerm[ti];
    if (!cells.length) { out.push({ term: ti, reason: "empty" }); continue; }
    // A term holding a co-op is exempt, and this line is the difference between mirroring the
    // gate and being stricter than it. `criteriaFailures` skips any term whose entries include
    // a co-op — the student is employed that term, whatever else is scheduled — and `t.work`
    // does not capture it, because a co-op CELL can be placed in a term the shape calls a
    // study term. International Business is exactly that: Year 3 Fall carries COOP 3948 beside
    // four reservations. Judged here without this, three programs that the gate accepts were
    // refused by their own constructor, which is the "two opinions about one rule" failure
    // this module's header warns about — committed by the module itself.
    if (cells.some(isCoop)) continue;
    const real = realCoursesInTerm(cells, courseMap, cal.realCourseSH);
    const loadSH = cells.reduce((n, c) => n + (c.cell.sh ?? 0), 0);
    const bigSH = cells.reduce((n, c) =>
      n + ((c.cell.sh ?? 0) >= cal.realCourseSH ? (c.cell.sh ?? 0) : 0), 0);
    // `termIsFull` and not `real >= minCourses`, for the reason that function documents: a
    // term carrying a 16 SH studio has no room for a fourth course and is full at two.
    // Capacity comes from the term's own credit ceiling, which is what leaves that room.
    const capSH = capOf(ti);
    if (!termIsFull(real, loadSH, capSH, cal, studentType, bigSH)) {
      out.push({ term: ti, reason: "thin", real, want: minCourses });
    }
  }
  return out;
}
