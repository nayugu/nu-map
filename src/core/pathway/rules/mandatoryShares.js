// ═══════════════════════════════════════════════════════════════════
// RULE: mandatoryShares — shares the pathway requires, not merely offers.
//
// Two flavours, both from Khoury's Computer Engineering → MS Computer Science
// pathway, which is the one that proved a plain share table is not enough:
//
//   · `mandatory: true`        "All students must take CS 5010."
//   · `mandatoryUnless: {...}` "Must take CS 5800 if they haven't already
//                               completed CS 3000."
//
// The conditional form is the interesting one. It is not a preference and not a
// substitution — it is a requirement whose existence depends on the plan. A
// student who took CS 3000 as an undergraduate is not merely excused from
// CS 5800, they are FORBIDDEN from sharing it (`noGradIfUgDone`), so the two
// rules have to agree. They agree here by construction: this evaluator asks the
// same question — is the undergraduate course in the plan — and stands down when
// the answer is yes.
//
// A missing mandatory share is reported as VIOLATED rather than unknown because
// it is genuinely computable: we know what the pathway requires and we know what
// is placed. It still only flags. A student mid-plan has not placed everything
// yet, so the panel should render this as "still to do", which is why the
// evidence carries the outstanding list rather than just a count.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";
import { plannerId, displayCode } from "../ids.js";
import { resolveCandidates, excludedIds } from "../shareSet.js";
import { baseId } from "../../repeatInstances.js";

/** Is `id` placed anywhere in the plan (any repeat instance, or placed out)? */
function isPresent(id, placements, placedOut) {
  if (!id) return false;
  if (placedOut?.has?.(id)) return true;
  return Object.keys(placements ?? {}).some(pid => baseId(pid) === id);
}

/**
 * @param {{}} rule  no parameters — the requirement lives on the shares
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function mandatoryShares(rule, ctx) {
  const { pathway, placements = {}, placedOut = new Set() } = ctx ?? {};
  const excluded = excludedIds(pathway);
  const candidates = resolveCandidates(pathway, { excluded });

  const required = [];
  for (const { share, gradId } of candidates) {
    if (!gradId) continue;                      // anonymous shares cannot be mandatory
    if (share.mandatory) {
      required.push(gradId);
      continue;
    }
    const unless = share.mandatoryUnless?.completed;
    if (unless) {
      const unlessId = plannerId(unless);
      // Mandatory only while the undergraduate version is absent.
      if (!isPresent(unlessId, placements, placedOut)) required.push(gradId);
    }
  }

  const missing = required.filter(id => !isPresent(id, placements, placedOut));
  const evidence = { required, missing };

  if (!required.length) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.mandatory.none",
      params: {},
      evidence,
    };
  }

  if (!missing.length) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.mandatory.ok",
      params: { count: required.length },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.mandatory.missing",
    params: { courses: missing.map(displayCode).join(", "), count: missing.length },
    evidence,
  };
}
