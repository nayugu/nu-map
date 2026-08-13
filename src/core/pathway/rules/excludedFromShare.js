// ═══════════════════════════════════════════════════════════════════
// RULE: excludedFromShare — graduate courses that may never count toward the
// bachelor's, even though they belong to the master's.
//
//   · ECE: EECE 5698, EECE 7398, EECE 6400 are graduate-only and cannot count
//     toward the undergraduate degree.
//   · Bouvé MSHI: "Any course in the MSHI curriculum can be double-counted
//     except the Capstone (HINF 7701)."
//
// Note the shape of the Bouvé case: the shareable set is defined by the MS
// curriculum with a hole punched in it. That is why this is a blocklist rule
// rather than an absence from the share table — for an open pathway there IS no
// table to be absent from, and `shareSet` reads this list when resolving both
// named and anonymous domain shares.
//
// ── What this evaluator is for, given shareSet already filters ─────
//
// `shareSet.excludedIds` keeps these courses out of the candidate set, so they
// never become shares and never produce a substitution. This evaluator answers
// the other question: has the student PLACED one and might they believe it is
// sharing? A student who put EECE 5698 in a General Elective slot expecting it
// to double count needs to be told it will not, and the placement is perfectly
// legal otherwise — the course still counts toward the master's later.
//
// So the diagnostic is about a misunderstanding, not an illegal plan. It is
// computable (we know the list and the placements), so it may say "violated",
// but the message must be about sharing, not about the course being disallowed.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";
import { plannerId, displayCode } from "../ids.js";
import { baseId } from "../../repeatInstances.js";

/**
 * @param {{courses: string[]}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function excludedFromShare(rule, ctx) {
  const listed = (rule.courses ?? []).map(plannerId).filter(Boolean);
  const placed = new Set(Object.keys(ctx?.placements ?? {}).map(baseId));
  for (const id of ctx?.placedOut ?? []) placed.add(baseId(id));

  const hit = listed.filter(id => placed.has(id));
  const evidence = { excluded: listed, placed: hit };

  if (!hit.length) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.excluded.ok",
      params: { count: listed.length },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.excluded.placed",
    params: { courses: hit.map(displayCode).join(", "), count: hit.length },
    evidence,
  };
}
