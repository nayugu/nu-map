// ═══════════════════════════════════════════════════════════════════
// RULE: subBudget — a semester-hour ceiling over a course DOMAIN, optionally
// scoped to an MS concentration.
//
// This is the kind that justified the registry. It is one evaluator, and it
// expresses ELEVEN published rules across two colleges:
//
//   · ECE caps non-EECE credit per MS concentration —
//     CCSP 8, CSYS 12, CVLA 12, ELPO 8, HSMI 12, MSMD 8, POWR 8 SH.
//   · Bouvé's pharmaceutical-sciences pathways each allow an elective top-up
//     drawn from {PHSC, PMLC, PMST, NNMD, BIOL, BIOT, CHEM} at 5000+ —
//     Pharmacology 3 SH, MedChem 5 SH, Pharmaceutics 8 SH, Biomedical 10 SH.
//
// Both are "at most N semester hours of courses matching this description",
// which is why they collapse. Before adding a new rule kind, look for this
// shape first — a kind with exactly one instance is a smell.
//
// SCOPE. `scope.msConcentration` makes the rule conditional on the student's
// chosen concentration. An unscoped rule always applies. A scoped rule whose
// concentration is not the active one is not "satisfied" — it is INAPPLICABLE,
// and reporting it as satisfied would tell a CCSP student they had cleared a
// POWR budget they were never under. Inapplicable is reported as `info` so the
// panel can list the other concentrations' budgets without scoring them.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";
import { inDomain } from "../ids.js";

/**
 * @param {{domain: Object, maxSH: number, scope?: {msConcentration?: string}}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function subBudget(rule, ctx) {
  const wanted = rule.scope?.msConcentration;
  const active = ctx?.pathway?.selectedMsConcentration ?? ctx?.msConcentration ?? null;

  if (wanted && active !== wanted) {
    return {
      status: STATUS.INFO,
      messageKey: "plusone.rule.subBudget.inapplicable",
      params: { concentration: wanted, maxSH: rule.maxSH },
      evidence: { applicable: false, scope: wanted, active },
    };
  }

  const matched = (ctx?.shares ?? []).filter(s => !s.withdrawn && inDomain(s.gradId, rule.domain));
  const usedSH = matched.reduce((n, s) => n + (Number(s.sh) || 0), 0);
  const maxSH = Number(rule.maxSH);

  const evidence = {
    applicable: true,
    scope: wanted ?? null,
    usedSH,
    maxSH,
    courses: matched.map(s => s.gradId),
    domain: rule.domain,
  };

  if (!Number.isFinite(maxSH)) {
    // Malformed data: no ceiling to compare against. Never guess a limit.
    return {
      status: STATUS.UNKNOWN,
      messageKey: "plusone.rule.subBudget.unknown",
      params: {},
      evidence,
    };
  }

  if (usedSH <= maxSH) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.subBudget.ok",
      params: { usedSH, maxSH },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.subBudget.over",
    params: { usedSH, maxSH },
    evidence,
  };
}
