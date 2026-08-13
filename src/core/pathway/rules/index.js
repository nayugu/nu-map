// ═══════════════════════════════════════════════════════════════════
// THE EVALUATOR REGISTRY.
//
// `evaluate.js` looks a rule's kind up here and calls it. It never switches on
// kind, so adding rule 74 is a new file plus one line below — the engine does
// not change. That is the open/closed boundary the design is built around, and
// docs/plusone-design.md §2 (73 published rules, certainly incomplete) is why.
//
// Every entry must:
//   · be keyed by a name present in ruleKinds.RULE_KINDS, and
//   · return a Diagnostic — { status, messageKey, params?, evidence? }.
//
// Both are checked by test/unit/pathway-rules.test.js rather than by convention:
// a kind in the vocabulary with no evaluator, or an evaluator with no kind, is a
// wiring mistake that would otherwise surface as a silent "cannot say" in the
// panel.
//
// The adapter may register additional institution-specific evaluators (see
// docs/plusone-design.md §5.2) by extending this object at wire time. Any such
// evaluator still returns the standard Diagnostic and is still subject to the
// engine's safety downgrade.
// ═══════════════════════════════════════════════════════════════════

import shareCap from "./shareCap.js";
import subBudget from "./subBudget.js";
import mandatoryShares from "./mandatoryShares.js";
import chooseK from "./chooseK.js";
import excludedFromShare from "./excludedFromShare.js";
import noGradIfUgDone from "./noGradIfUgDone.js";
import maxGradCoursesPerTerm from "./maxGradCoursesPerTerm.js";
import earliestTerm from "./earliestTerm.js";
import {
  gpaMin, coopCompleted, gradCourseCompletedFirst,
  admissionNotGuaranteed, advisorApproval, registrationOverride,
  noDeferral, fullTimeGradMin, noTransferCredit, scholarshipIneligible,
  applicationDeadline, tuitionRate,
} from "./stated.js";

/** kind → (rule, ctx) => Diagnostic */
export const EVALUATORS = Object.freeze({
  // computable — the only class permitted to report a failure
  shareCap,
  subBudget,
  mandatoryShares,
  chooseK,
  excludedFromShare,
  noGradIfUgDone,
  maxGradCoursesPerTerm,
  earliestTerm,

  // assertable — the fact exists, the student holds it
  gpaMin,
  coopCompleted,
  gradCourseCompletedFirst,

  // unknowable — a person decides
  admissionNotGuaranteed,
  advisorApproval,
  registrationOverride,

  // informational — nothing to decide
  noDeferral,
  fullTimeGradMin,
  noTransferCredit,
  scholarshipIneligible,
  applicationDeadline,
  tuitionRate,
});
