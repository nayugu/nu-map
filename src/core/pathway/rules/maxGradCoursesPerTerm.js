// ═══════════════════════════════════════════════════════════════════
// RULE: maxGradCoursesPerTerm — the per-term rate limit.
//
// EMPHATICALLY NOT UNIVERSAL. Measured across the sources:
//
//   · Khoury (all four pathways): "Only one graduate course may be completed
//     per semester."
//   · CSSH History: "Students may take up to two graduate-level courses per
//     semester."
//   · COE: the Chemical Engineering PlusOne curriculum sheet shows TWO graduate
//     course slots inside a single term column.
//
// So encoding Khoury's 1 as a global default would invent errors for most of the
// university. There is no default here: a pathway that does not state the rule
// simply does not carry it, and nothing is checked. Silence in a source means
// silence, not 1.
//
// Withdrawn takes are excluded from the count. The rule is about how many
// courses a student may CARRY at once, which is a workload constraint; a
// withdrawal is precisely the student not carrying it. (Contrast the four-course
// budget, where Khoury explicitly counts withdrawals — see shareSet.shareTotals
// and its `includeWithdrawn` option. The two rules disagree on purpose.)
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

/**
 * @param {{max: number}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function maxGradCoursesPerTerm(rule, ctx) {
  const max = Number(rule.max);
  if (!Number.isFinite(max)) {
    return {
      status: STATUS.UNKNOWN,
      messageKey: "plusone.rule.perTerm.unknown",
      params: {},
      evidence: { max: null },
    };
  }

  const perTerm = new Map();
  for (const s of ctx?.shares ?? []) {
    if (s.withdrawn || !s.semId) continue;
    perTerm.set(s.semId, (perTerm.get(s.semId) ?? 0) + 1);
  }

  const over = [...perTerm.entries()]
    .filter(([, n]) => n > max)
    .map(([semId, n]) => ({ semId, count: n }));

  const evidence = { max, perTerm: Object.fromEntries(perTerm), over };

  if (!over.length) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.perTerm.ok",
      params: { max },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.perTerm.over",
    params: { max, terms: over.length, worst: Math.max(...over.map(o => o.count)) },
    evidence,
  };
}
