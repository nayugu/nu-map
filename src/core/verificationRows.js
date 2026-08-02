/**
 * verificationRows.js — turn a program's verification verdict into the rows
 * the popover draws.
 *
 * ## Why this is a module and not inline JSX
 *
 * The badge colour and the row marks were computed in two different places
 * from two different inputs: the badge from finding SEVERITY, the marks from
 * raw COUNTERS. They drifted twice. An audit of all 1,017 programs found 52
 * showing a yellow badge above four rows that all looked fine, and 3 asserting
 * "the catalog states a total credit count" about a number that had come from
 * the sample plan.
 *
 * Both now derive from one function, and `test/invariant/verification-ui.test.js`
 * asserts across every shipped program that the badge equals the worst row.
 * That is the only way this stays true — it is not the kind of thing anyone
 * re-checks by eye.
 *
 * Pure and dependency-free: the invariant CI job runs with no `npm install`,
 * and returns translation KEYS rather than text so it carries no locale
 * knowledge.
 */

/** One state per severity, so a mark can never contradict the badge. */
export const STATE = {
  pass: { mark: "✓", rank: 0 },   // nothing found
  na:   { mark: "–", rank: 0 },   // check doesn't apply to this kind of program
  note: { mark: "·", rank: 1 },   // info — surfaced, deliberately not counted
  warn: { mark: "!", rank: 2 },   // medium — counted; badge goes yellow
  fail: { mark: "✕", rank: 3 },   // high — counted; badge goes red
};

/** Which badge level a given worst-row rank implies. */
export const LEVEL_FOR_RANK = { 0: "verified", 1: "verified", 2: "partial", 3: "review" };

/** severity → row state. `fallback` is used when the check produced no finding. */
export function stateForSeverity(severity, fallback = "pass") {
  if (severity == null) return fallback;
  if (severity === "high")   return "fail";
  if (severity === "medium") return "warn";
  return "note";
}

/** Checks that already have a dedicated row; everything else is appended. */
const OWNED = new Set([
  "requirement-table-parity", "plan-witness-unaccounted", "unknown-course",
  "missing-total-credits", "no-sample-plan", "total-from-sample-plan",
]);

/**
 * @param {object} verification  metadata.verification
 * @returns {{state, textKey, params, detail, overflow}[]}
 */
export function buildCheckRows(verification) {
  const counters = verification?.counters ?? {};
  const findings = verification?.discrepancies ?? [];
  const sources  = verification?.sourcesAvailable ?? [];
  const hasPlan  = sources.includes("plan-of-study");
  // Only undergraduate majors publish a sample plan — 98% of them do, and 0%
  // of minors and certificates. Absence means different things for each.
  const planExpected = verification?.kind === "major";

  const num  = k => (Number.isFinite(counters[k]) ? counters[k] : 0);
  const find = check => findings.find(f => f.check === check) ?? null;
  const of   = check => {
    const f = find(check);
    return f ? { detail: f.detail ?? [], overflow: f.overflow ?? 0, severity: f.severity }
             : { detail: [], overflow: 0, severity: null };
  };

  const tables   = of("requirement-table-parity");
  const planC    = of("plan-witness-unaccounted");
  const noPlan   = of("no-sample-plan");
  const course   = of("unknown-course");
  const noTotal  = of("missing-total-credits");
  const fromPlan = of("total-from-sample-plan");

  const rows = [
    { state: stateForSeverity(tables.severity), textKey: "verify.pop.complete", ...tables },

    // A "–" here would hide the very finding making the badge yellow, which is
    // what left 52 programs unexplained. "–" is only for a program that was
    // never expected to publish a plan.
    hasPlan
      ? { state: stateForSeverity(planC.severity), textKey: "verify.pop.plan", ...planC }
      : planExpected
        ? { state: stateForSeverity(noPlan.severity, "warn"), textKey: "verify.pop.planMissing", ...noPlan }
        : { state: "na", textKey: "verify.pop.planNA", detail: [], overflow: 0 },

    { state: stateForSeverity(course.severity), textKey: "verify.pop.courses", ...course },

    // Three distinct outcomes need three distinct sentences. Claiming the
    // catalog stated a total when the number came from the sample plan was
    // simply false.
    num("zeroTotal") !== 0
      ? { state: stateForSeverity(noTotal.severity, "na"), textKey: "verify.pop.totalNone", ...noTotal }
      : fromPlan.severity
        ? { state: stateForSeverity(fromPlan.severity), textKey: "verify.pop.totalFromPlan", ...fromPlan }
        : { state: "pass", textKey: "verify.pop.total", detail: [], overflow: 0 },
  ];

  // Findings without a dedicated row — duplicate titles, an impossible
  // section, a leaked marker. Rare, but they must never vanish just because
  // the four standard rows don't cover them.
  for (const f of findings) {
    if (OWNED.has(f.check)) continue;
    rows.push({
      state: stateForSeverity(f.severity, "fail"),
      textKey: `verify.pop.check.${f.check}`,
      detail: f.detail ?? [], overflow: f.overflow ?? 0,
    });
  }

  return rows;
}

/** The badge level these rows imply. Must equal verification.level. */
export function levelFromRows(rows) {
  const worst = rows.reduce((m, r) => Math.max(m, STATE[r.state]?.rank ?? 0), 0);
  return LEVEL_FOR_RANK[worst];
}
