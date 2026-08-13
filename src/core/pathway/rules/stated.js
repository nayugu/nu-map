// ═══════════════════════════════════════════════════════════════════
// RULES THAT ARE STATED, NEVER EVALUATED.
//
// Three of the four safety classes never decide anything, so their evaluators
// have the same shape: carry the source's numbers into a message and stop. They
// live in one file because nine near-identical modules would be ceremony, not
// separation of concerns — each function below is still the single owner of its
// kind, and each is registered separately.
//
//   ASSERTABLE     the fact exists but only the student holds it
//   UNKNOWABLE     a person decides it, and no data ever will
//   INFORMATIONAL  there is nothing to decide; it just has to be said
//
// ── Why they return UNKNOWN rather than SATISFIED ──────────────────
//
// A GPA gate we cannot check is not met. Reporting `satisfied` would be a lie
// with a green tick on it — the worst available option, because a student would
// reasonably read it as "NU Map checked my GPA". `unknown` is the honest answer
// and the panel can render it as "you must confirm this", which is what an
// advisor would say.
//
// The engine additionally downgrades any `violated` from these kinds (see
// evaluate.js), so even a future bug here cannot produce a red card. Two layers,
// because the cost of the failure is a student mistrusting a correct plan — or
// worse, trusting a wrong one.
//
// ── Precedent ─────────────────────────────────────────────────────
//
// This is the same call the co-op GPA gate made, and the same one
// core/prereqConditions.js makes for permission and candidacy notes: state the
// condition, never manufacture a failure from a fact you do not hold.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

/**
 * GPA minimums. Several pathways gate on more than one SCOPE at once with
 * different thresholds, so `scopes` is a list and `min` may be per-scope:
 *
 *   Khoury:          3.0 cumulative AND 3.0 within the major
 *   D'Amore-McKim:   3.0 cumulative AND 3.25 in accounting coursework
 *   CSSH History:    3.25 for direct entry
 *   Bouvé:           3.0 required, 3.5 preferred (five programs)
 *   Bouvé MPH:       3.2–3.7 depending on the undergraduate major
 *
 * NU Map holds no student GPA and should not: it is the most sensitive number a
 * planner could ask for, and the feature works without it.
 */
export function gpaMin(rule) {
  return {
    status: STATUS.UNKNOWN,
    messageKey: rule.preferred
      ? "plusone.rule.gpa.minAndPreferred"
      : "plusone.rule.gpa.min",
    params: {
      min: rule.min ?? null,
      preferred: rule.preferred ?? null,
      scopes: (rule.scopes ?? ["cumulative"]).join(", "),
    },
    evidence: { min: rule.min ?? null, preferred: rule.preferred ?? null, scopes: rule.scopes ?? ["cumulative"] },
  };
}

/**
 * A completed co-op as an entry prerequisite — D'Amore-McKim Accounting requires
 * one six-month co-op before the PlusOne year.
 *
 * The plan DOES model co-op placements (core/specialTermUtils.js), so a future
 * version could count them. It is left assertable for now because the source
 * says "completed", and completion is a fact about the past that a planned co-op
 * card does not establish. Counting planned cards would over-satisfy.
 */
export function coopCompleted(rule) {
  return {
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.coop.required",
    params: { count: rule.count ?? 1, months: rule.months ?? null },
    evidence: { count: rule.count ?? 1, months: rule.months ?? null },
  };
}

/**
 * Khoury requires one graduate course to be COMPLETED SUCCESSFULLY before the
 * PlusOne application is accepted. Whether it was passed depends on a grade the
 * student may never enter, and an unentered grade satisfies everything else in
 * this codebase — so inferring a pass here would be inconsistent as well as
 * wrong.
 */
export function gradCourseCompletedFirst(rule) {
  return {
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.gradFirst.required",
    params: { count: rule.count ?? 1 },
    evidence: { count: rule.count ?? 1 },
  };
}

/**
 * Khoury, verbatim: "Admission into the PlusOne program does not guarantee
 * admission into the master's program upon graduation." The CE→MSCS page adds
 * "Placement is not guaranteed."
 *
 * This is the most important sentence in the whole feature and it must appear
 * wherever a master's projection appears. A projection reads as a promise unless
 * it is said out loud.
 */
export function admissionNotGuaranteed() {
  return {
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.admission.notGuaranteed",
    params: {},
    evidence: {},
  };
}

/**
 * Advisor or director sign-off — Bouvé's Course Review Form, COE's Plan of Study
 * Form. Also covers Bouvé's open tail: "where fewer than four courses are
 * listed, the remaining courses will be determined on the basis of the student's
 * program in consultation with the graduate and undergraduate advisors."
 */
export function advisorApproval(rule) {
  return {
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.advisor.required",
    params: { form: rule.form ?? null },
    evidence: { form: rule.form ?? null },
  };
}

/**
 * A registration override to enrol at all — SCCJ requires one above 5000 level,
 * and permission for electives outside {CRIM, INSH, POLS, PPUA, SOCL}.
 *
 * Related but distinct from the `grad-admission` prereq condition that
 * core/prereqConditions.js resolves: that one is about whether the course's
 * stated prerequisite is met, this is about whether the registrar will let an
 * undergraduate into the section.
 */
export function registrationOverride(rule) {
  return {
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.override.required",
    params: { above: rule.above ?? null },
    evidence: { above: rule.above ?? null },
  };
}

/** Enrol the semester after the bachelor's or lose the place (Khoury, COE). */
export function noDeferral() {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.noDeferral",
    params: {},
    evidence: {},
  };
}

/**
 * Full-time graduate minimum. Khoury states 8 SH; the MS Data Science page
 * states the same rule as "two courses per fall/spring semester". Carried as SH
 * because that is the form the registrar uses and the form co-op eligibility
 * (one full-time 8 SH semester before a graduate co-op) is written in.
 */
export function fullTimeGradMin(rule) {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.fullTime",
    params: { sh: rule.sh ?? 8 },
    evidence: { sh: rule.sh ?? 8 },
  };
}

/**
 * University policy: transfer credit may not be applied to a master's completed
 * as part of a PlusOne, and (COE) graduate coursework beyond the sharing cap
 * does not carry over to the MS either.
 */
export function noTransferCredit() {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.noTransferCredit",
    params: {},
    evidence: {},
  };
}

/**
 * Scholarship ineligibility — Double Husky (Khoury, CoS, COE), New Program and
 * Location Launch (COE). Money is the reason many students look at PlusOne, so
 * the exclusions belong on screen next to the savings.
 */
export function scholarshipIneligible(rule) {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.scholarship.ineligible",
    params: { names: (rule.names ?? []).join(", ") },
    evidence: { names: rule.names ?? [] },
  };
}

/**
 * Application deadlines. Dates rot faster than anything else in this dataset —
 * D'Amore-McKim's 15 November, Bouvé's window per term and programme — so they
 * are informational data carried with the pathway's source date and never
 * compared against a clock. A stale deadline shown as data is a mild problem; a
 * stale deadline used as logic would silently close a pathway.
 */
export function applicationDeadline(rule) {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.deadline",
    params: { term: rule.term ?? null, date: rule.date ?? null },
    evidence: { term: rule.term ?? null, date: rule.date ?? null },
  };
}

/**
 * Tuition rate for shared courses. Only D'Amore-McKim states it outright
 * ("at undergraduate tuition rates"), and CPS says the credits count "at no
 * additional cost". One college's statement is not a university policy, so this
 * is quoted with attribution rather than generalised — the registrar article
 * that would settle it is still unread (docs/plusone-design.md §13.3).
 */
export function tuitionRate(rule) {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.tuitionRate",
    params: { rate: rule.rate ?? null, source: rule.source ?? null },
    evidence: { rate: rule.rate ?? null, source: rule.source ?? null },
  };
}
