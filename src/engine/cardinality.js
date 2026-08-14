// ═══════════════════════════════════════════════════════════════════
// CARDINALITY — can every full term actually reach four?
//
// Asked EXACTLY, by flow, before the search spends anything trying.
//
// `search.js` already asks a version of this arithmetically: `surplus = realCourses -
// 4 x fullTerms`, and if it is negative the bar is declared unsatisfiable and not enforced.
// That test is right about counting and blind to REACHABILITY. A degree can have 32 real
// courses for 6 full terms — surplus 8, comfortably satisfiable on paper — and still have no
// arrangement, because the courses that could fill Year 3 Fall are all locked to Year 1 by
// season or by prerequisite windows. Counting cannot see that; a matching can.
//
// The distinction is worth an algorithm because of what the engine does when it is wrong.
// Believing the bar satisfiable when it is not, the search enforces it, fails, restarts,
// escalates, and spends its entire budget proving the impossible — International Business
// burned 23,132 nodes and 40 restarts that way. Believing it unsatisfiable when it is not, the
// search relaxes a rule it could have met and ships a lopsided plan. Both are expensive, and
// one question answered exactly removes both.
//
// ── Sound, and deliberately incomplete ──────────────────────────────
//
// This is a RELAXATION: it models assignment, slot capacity and the per-term floor, and it
// ignores credit caps, precedence and the witness. Every one of those can only REMOVE
// arrangements, so:
//
//   infeasible here  ⇒  infeasible in the real problem   (safe to act on)
//   feasible here    ⇒  nothing is claimed               (never treated as an answer)
//
// So a `false` is a proof and a `true` is only a licence to go looking. That asymmetry is the
// whole contract, and it is why this can never cut a plan a student could have followed.
// ═══════════════════════════════════════════════════════════════════

import { feasibleWithLowerBounds } from "./flow.js";

/**
 * Is there ANY assignment of real courses to terms giving every full term its floor?
 *
 * @param {object} args
 * @param {{cell: object, domain: number[]}[]} args.plans
 * @param {object[]} args.terms          the study terms, in order
 * @param {number} args.realCourseSH     the credit floor for one real course
 * @param {number} args.minCourses       the full-term floor; 0 disables the question
 * @param {(ti: number) => number} args.slotCap   the most cells a term may hold
 * @param {(ti: number) => number} [args.halfTermCourses]  the floor for a summer, if any
 * @returns {boolean}
 */
export function barsReachable({ plans, terms, realCourseSH, minCourses, slotCap,
                                halfTermCourses = () => 0 }) {
  // No convention to satisfy — graduate degrees have no four-course rule — so nothing to
  // prove. Answering `true` here is not a claim; it is the absence of a question.
  if (!(minCourses > 0)) return true;

  // Only cells that COUNT toward a term's floor. A 1 SH lab cannot help a term reach four, so
  // including it would model a course that does not exist for this purpose and could turn an
  // infeasible instance into a feasible-looking one — an unsound direction.
  const big = plans.filter(p => (p.cell?.sh ?? 0) >= realCourseSH);
  const T = terms.length;
  const C = big.length;
  const SRC = 0, SINK = C + T + 1;
  const arcs = [];

  for (let i = 0; i < C; i++) {
    // [1, 1]: every real course must be placed SOMEWHERE. Not [0, 1] — leaving a course
    // unplaced is not an option the plan has, and modelling it as one would let the flow
    // satisfy the floors by discarding the courses that were in the way.
    arcs.push({ u: SRC, v: 1 + i, lo: 1, hi: 1 });
    for (const ti of big[i].domain ?? []) {
      if (ti >= 0 && ti < T) arcs.push({ u: 1 + i, v: 1 + C + ti, lo: 0, hi: 1 });
    }
  }

  for (let ti = 0; ti < T; ti++) {
    const t = terms[ti];
    const full = (t.weight ?? 1) >= 1 && !t.work && !t.unused && !t.optional;
    // A term the student spends employed takes no courses; an optional summer a department
    // left blank has no floor, because `emit` will trim it rather than print it empty.
    const lo = t.work || t.unused ? 0 : (full ? minCourses : halfTermCourses(ti));
    const hi = Math.max(lo, t.work ? 0 : slotCap(ti));
    arcs.push({ u: 1 + C + ti, v: SINK, lo, hi });
  }

  return feasibleWithLowerBounds(arcs, C + T + 2, SRC, SINK);
}
