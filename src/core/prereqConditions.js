// ═══════════════════════════════════════════════════════════════════
// PREREQ CONDITIONS — non-course prerequisite phrases  (pure, no React)
//
// Plenty of prerequisites are satisfied by something that is not a course:
// "graduate program admission", "permission of instructor", "Dissertation
// Check with a score of REQ". scripts/lib/prereq-parse.js keeps those as
// { note } leaves so the boolean tree stays balanced and the condition is
// visible; this module says what such a leaf MEANS for a given plan.
//
// Why it matters: all 209 catalog courses carrying "graduate program
// admission" state it as an OR branch beside the undergraduate course path —
//
//     BIOE 5115:  MATH 2341  Or  graduate program admission
//
// A leaf the evaluator can't read is a phantom operand, and a neutral OR
// branch collapses to the other side (prereqEval.js mergeOr), so a graduate
// student placing BIOE 5115 was told they were missing MATH 2341. Admission
// is precisely what a graduate plan asserts, so that branch must pass.
//
// TWO INVARIANTS — do not weaken either:
//
//   1. A condition may only ever SATISFY, never violate. Unrecognized or
//      unmet conditions are neutral (null), never "missing": an undergrad in
//      a combined BS/MS legitimately takes 5000-level courses on permission
//      we cannot see, so a note must not manufacture a red card. Same shape
//      as the grade layer, where an unentered grade satisfies everything.
//   2. Only a GENERIC graduate-admission phrase is auto-satisfiable.
//      "Permission of the graduate program director" is a person's decision
//      and "PhD candidacy" is a further gate past admission — both mention
//      graduate study, neither follows from being in a graduate plan. Hence
//      the classifier tests permission and candidacy FIRST.
//
// Known over-reach, accepted deliberately: a phrase that names the program
// ("admission to the graduate program in Nursing") is treated like the
// generic one, because we do not model WHICH graduate program a plan is.
// Over-satisfying an unrelated department's course is a far cheaper error
// than telling every graduate student they are missing undergrad prereqs.
// ═══════════════════════════════════════════════════════════════════

// Condition kinds. Classification is by meaning, not by source phrasing, so
// new catalog wording for a known meaning lands on the existing kind.
export const CONDITION_KINDS = [
  "grad-admission",  // admitted to a graduate program (generic)
  "degree-admission",// admitted to a NAMED degree (MS, MA, doctoral) — NOT generic
  "prior-coursework",// prior/transition coursework, or N terms of graduate study
  "permission",      // instructor / department / director consent
  "candidacy",       // PhD candidacy, qualifying exam, dissertation check
  "standing",        // class standing: junior, senior, undergraduate…
  "score-gate",      // "<named check> with a score of X" (placement tests)
  "enrollment",      // enrollment in a specific cohort/section/college
];

// The only kinds a plan can assert on its own. Everything else needs a fact
// about the student that the planner does not (and should not) store.
export const AUTO_SATISFIABLE = new Set(["grad-admission"]);

// Order-sensitive: the first match wins. PERMISSION and CANDIDACY come first
// precisely because they can also mention graduate study (invariant 2).
const PERMISSION = /\b(permission|consent|approv|waiver|waived)/;
const CANDIDACY  = /\b(candidacy|dissertation|qualifying\s+exam|comprehensive\s+exam)/;
// Generic grad admission, either word order: "graduate program admission",
// "admission to a graduate program", "admitted to graduate study",
// "graduate standing", plus the bare-status phrasings ("graduate student",
// "graduate status") that can only mean the same thing. Degree-specific
// wording ("doctoral program admission") deliberately does NOT match — a
// graduate plan does not say which level, so it cannot assert that gate.
const GRAD_ADMISSION = /\bgraduate\b[^.]*\b(admission|admitted|standing)\b|\b(admission|admitted)\b[^.]*\bgraduate\b|\bgraduate\s+(student|status)\b/;

// Admission stated as a NAMED degree rather than as graduate study in general
// — "Requires admission to MS program or completion of all transition courses"
// (CS 5600). Recognized so it does not read as an unknown phrase, and
// deliberately NOT auto-satisfiable: this module's rule is that only a generic
// graduate-admission phrase may be asserted by a plan, because a plan records
// `studentType: "graduate"` and never which degree. A PhD student is not
// admitted to an MS program, so satisfying this from plan state would be an
// invention. Ordered AFTER grad-admission so "admission to a graduate program
// in Nursing" keeps the generic classification it already had.
const DEGREE_ADMISSION = /\b(admission|admitted)\b[^.]*\b(m\.?s\.?|m\.?a\.?|master'?s?|doctoral|ph\.?d\.?|certificate)\b[^.]*\bprogram\b|\b(admission|admitted)\s+to\s+(the\s+)?(m\.?s\.?|m\.?a\.?|master'?s?|doctoral|ph\.?d\.?)\b/;

// A gate that is prior WORK rather than prior status: "completion of all
// transition courses", "at least three semesters of graduate study in health
// informatics" (HINF 7701), "prior completion of graduate coursework in
// microeconomics" (NETS 7341). Never auto-satisfiable — the planner does not
// know what a student studied before this plan, and a transcript we cannot see
// is exactly the thing invariant 1 says must stay neutral rather than become a
// red card.
const PRIOR_COURSEWORK = /\b(completion|completed)\b[^.]*\b(coursework|courses|semesters|terms|credits|study)\b|\b(semesters|terms)\s+of\s+graduate\s+study\b/;
const SCORE_GATE = /\bwith a score of\b/;
const STANDING   = /\bstanding\b/;
const ENROLLMENT = /\b(enroll|matriculat|cohort)/;

/**
 * Classify a non-course prereq note into a condition kind.
 *
 * @param {string} note  the raw note text as scraped (any case)
 * @returns {string|null} one of CONDITION_KINDS, "other" for an
 *   unrecognized phrase, or null for empty input. "other" is not an error —
 *   it is simply a condition we cannot reason about, which stays neutral.
 */
export function classifyCondition(note) {
  const s = String(note ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (PERMISSION.test(s))     return "permission";
  if (CANDIDACY.test(s))      return "candidacy";
  if (GRAD_ADMISSION.test(s)) return "grad-admission";
  // Both below are non-auto-satisfiable, so they sit after the generic
  // admission test: a phrase that qualifies as generic graduate admission must
  // keep passing, and only what that test declines falls through to here.
  if (DEGREE_ADMISSION.test(s))  return "degree-admission";
  if (PRIOR_COURSEWORK.test(s))  return "prior-coursework";
  if (SCORE_GATE.test(s))     return "score-gate";
  if (STANDING.test(s))       return "standing";
  if (ENROLLMENT.test(s))     return "enrollment";
  return "other";
}

/**
 * The condition kinds a plan asserts as already met, ready to hand to
 * evalPrereqTree. A graduate plan is itself the evidence of graduate
 * program admission; nothing else is derivable from plan state today.
 *
 * @param {{studentType?: string}|null} plan  plan or cohort-ish object
 * @returns {Set<string>} met kinds (possibly empty — never null)
 */
export function planConditions(plan) {
  const met = new Set();
  // A declared accelerated pathway (NEU: "PlusOne") IS admission to a graduate
  // program — that is what the student was admitted to — so an undergraduate
  // plan carrying one asserts the same condition a graduate plan does.
  //
  // Measured: of 56 shareable graduate courses across six colleges' published
  // PlusOne tables, 7 carry "graduate program admission" in their prereq tree
  // (CS 5310, CY 5200, CY 5210, CY 5240, CHEM 5628, CHEM 5676, ME 5250) out of
  // 209 such courses corpus-wide. Without this, placing one of those shows a
  // missing undergraduate prereq — exactly the red card invariant 1 above
  // forbids, and for exactly the student the comment there describes.
  if (plan?.studentType === "graduate" || plan?.plusOne) met.add("grad-admission");
  return met;
}

/**
 * Status of one { note } leaf under a set of met conditions.
 *
 * @param {string} note
 * @param {Set<string>|null} met  from planConditions()
 * @returns {"satisfied"|null} null = neutral (invariant 1: never "missing")
 */
export function conditionStatus(note, met) {
  if (!met || !met.size) return null;
  const kind = classifyCondition(note);
  return kind && met.has(kind) ? "satisfied" : null;
}

/**
 * Every { note } leaf in a prereq tree, with its kind and whether the plan
 * already meets it — the explainable form for the info panel and for MCP
 * (so Claude can say "met because your plan is a graduate program").
 *
 * @param {Array|null} tree  prereq token array
 * @param {Set<string>|null} met
 * @returns {{note: string, kind: string, satisfied: boolean}[]}
 */
export function collectConditions(tree, met = null) {
  const out = [];
  const seen = new Set();
  (function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const tok of nodes) {
      if (Array.isArray(tok)) { walk(tok); continue; }
      if (tok && typeof tok === "object" && tok.note && !seen.has(tok.note)) {
        seen.add(tok.note);
        out.push({
          note: tok.note,
          kind: classifyCondition(tok.note),
          satisfied: conditionStatus(tok.note, met) === "satisfied",
        });
      }
    }
  })(tree);
  return out;
}
