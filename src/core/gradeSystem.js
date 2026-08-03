// ═══════════════════════════════════════════════════════════════════
// GRADE SYSTEM — symbols, the two axes, gates, and set-constraint
// feasibility.  (pure, no React, no deps — see docs/grades-design.md)
//
// The one rule: an UNENTERED grade is assumed to fulfil everything.
// The assumed maximum is substituted here, inside the evaluators, and
// nowhere else — it is never stored, displayed or shared. With no
// grades entered every function below reports "fine", so the app is
// byte-identical to today. The feature can only ADD warnings, and only
// in response to a grade the user actually typed.
//
// Every symbol answers two INDEPENDENT questions (all four corners of
// the matrix are inhabited — see the doc):
//   credit axis : did the course yield credit / fulfil requirements?
//   points axis : does it contribute quality points to an average?
//
// F is the only symbol on both sides at once: no credit, yet it counts
// in the GPA at 0.000. S is the mirror: credit, but no quality points.
// I is pending — registrar policy says F, U, I, X and W all fail to
// fulfil prereqs, but an I resolves in place while an F needs a new
// registration (a retake slot).
// ═══════════════════════════════════════════════════════════════════

/** Letter → quality points — VERIFIED against the catalog's official
    "Grade Table and GPA" page (undergrad → student records policies,
    2026-08-02): A = 4.000 is the ceiling, there is no A+, and every value
    below matches the published table exactly. The table also marks D+/D/D-
    "Undergraduate only" — graduate students cannot earn Ds. */
export const GRADE_POINTS = {
  "A": 4.0, "A-": 3.667,
  "B+": 3.333, "B": 3.0, "B-": 2.667,
  "C+": 2.333, "C": 2.0, "C-": 1.667,
  "D+": 1.333, "D": 1.0, "D-": 0.667,
  "F": 0.0,
};

/** The assumed grade for an unentered course — the scale's ceiling. */
export const ASSUMED_POINTS = GRADE_POINTS["A"];

/** Everything the dropdown offers, in display order. `X` (final-exam
    absence) is handled by the logic but too rare to offer. */
export const GRADE_SYMBOLS = [
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F",
  "S", "U", "I", "W",
];

const NO_CREDIT = new Set(["F", "U", "I", "W", "X"]);

export function isLetterGrade(g) {
  return g != null && Object.prototype.hasOwnProperty.call(GRADE_POINTS, g);
}

/** Credit axis. Unentered (null/undefined) is assumed to yield credit. */
export function yieldsCredit(g) {
  if (g == null) return true;
  return !NO_CREDIT.has(g);
}

/** Points axis. Only letters (including F at 0.000) enter an average;
    S/U/I/W/X carry no quality points. Unentered courses are excluded
    from ENTERED averages — they only appear in feasibility bounds. */
export function countsInGPA(g) {
  return isLetterGrade(g);
}

/**
 * Does grade `g` satisfy a prerequisite gate of `minGrade`?
 *
 *   g unentered      → yes (the rule)
 *   g ∈ F,U,I,W,X    → no  (registrar: "do not normally fulfill requirements")
 *   minGrade absent  → yes (no gate — any credit-yielding outcome passes)
 *   minGrade "S"     → yes (an S/U-graded gate: any credit-yielding grade,
 *                      letter or S, clears a pass-level bar)
 *   g === "S"        → yes (S carries no letter to compare; per the
 *                      no-false-alarms rule the ambiguity resolves upward —
 *                      the catalog's exclusion list omits S, so S "normally
 *                      fulfills"; whether it clears an above-pass letter gate
 *                      is advisor territory, not a red mark)
 *   otherwise        → compare quality points
 */
export function satisfiesGate(g, minGrade) {
  if (g == null) return true;
  if (!yieldsCredit(g)) return false;
  if (minGrade == null) return true;
  if (minGrade === "S" || g === "S") return true;
  if (!isLetterGrade(g) || !isLetterGrade(minGrade)) return true; // unknown symbol: never alarm
  return GRADE_POINTS[g] >= GRADE_POINTS[minGrade];
}

/**
 * Feasibility of a set-average constraint ("these courses must average to
 * ≥ threshold"), given whatever grades are entered.
 *
 * @param {Array<{grade: string|null|undefined, credits: number}>} entries
 *   One entry per constrained course the student will count. Non-letter
 *   grades (S/U/I/W) carry no quality points and are EXCLUDED from the
 *   average entirely, exactly as the registrar computes it. F stays in
 *   at 0.000.
 * @param {number} threshold  e.g. 2.0
 * @returns {{
 *   status: "met"|"open"|"atRisk"|"impossible",
 *   neededPoints: number|null,   // avg the unentered courses must reach
 *   neededGrade: string|null,    // smallest letter meeting neededPoints
 * }}
 *   met        — every letter is in and the average clears the bar
 *   open       — unentered courses remain and the bar is reachable
 *   atRisk     — reachable, but only with a needed average above B
 *                (i.e. the remaining courses must be near-perfect)
 *   impossible — even straight As in the rest cannot reach the bar;
 *                the only state that earns a hard mark, because it is
 *                a proof, not a prediction
 */
export function setConstraintStatus(entries, threshold) {
  let enteredPts = 0, enteredCr = 0, openCr = 0;
  for (const e of entries ?? []) {
    const cr = Number.isFinite(e.credits) && e.credits > 0 ? e.credits : 4;
    if (e.grade == null) { openCr += cr; continue; }
    if (!countsInGPA(e.grade)) continue;          // S/U/I/W: out of the average
    enteredPts += GRADE_POINTS[e.grade] * cr;
    enteredCr  += cr;
  }

  const totalCr = enteredCr + openCr;
  if (totalCr === 0) return { status: "met", neededPoints: null, neededGrade: null };

  if (openCr === 0) {
    const avg = enteredPts / enteredCr;
    return avg >= threshold - 1e-9
      ? { status: "met", neededPoints: null, neededGrade: null }
      : { status: "impossible", neededPoints: null, neededGrade: null };
  }

  // What the remaining (unentered) credits must average to reach the bar.
  const needed = (threshold * totalCr - enteredPts) / openCr;
  if (needed > ASSUMED_POINTS + 1e-9)
    return { status: "impossible", neededPoints: needed, neededGrade: null };
  if (needed <= 0)
    return { status: "met", neededPoints: null, neededGrade: null };

  // Smallest letter whose points reach `needed`.
  const ladder = Object.entries(GRADE_POINTS)
    .filter(([g]) => g !== "F")
    .sort((a, b) => a[1] - b[1]);
  const rung = ladder.find(([, p]) => p >= needed - 1e-9);
  return {
    status: needed > GRADE_POINTS["B"] + 1e-9 ? "atRisk" : "open",
    neededPoints: Math.round(needed * 1000) / 1000,
    neededGrade: rung ? rung[0] : "A",
  };
}

/**
 * GPA of the entered letter grades only — the one number honest enough to
 * display, labelled as such. Returns null when nothing is entered (never
 * render the assumed ceiling as if it were a GPA).
 */
export function enteredGPA(entries) {
  let pts = 0, cr = 0;
  for (const e of entries ?? []) {
    if (!countsInGPA(e.grade)) continue;
    const c = Number.isFinite(e.credits) && e.credits > 0 ? e.credits : 4;
    pts += GRADE_POINTS[e.grade] * c;
    cr  += c;
  }
  return cr === 0 ? null : Math.round((pts / cr) * 1000) / 1000;
}

import { baseId } from "./repeatInstances.js";

/**
 * Build the `takesOf` resolver evalPrereqTree consumes: base course id →
 * every take of it, with semester index and entered grade.
 *
 * Returns NULL when no grades are entered — the caller passes that straight
 * through, the evaluator runs its legacy path bit-for-bit, and the default
 * experience cannot change. The whole feature hangs off this line.
 *
 * Placement filtering is EXACTLY the legacy lookup's: membership in
 * `semIndex`, nothing else. semIndex includes "incoming" (transfer credits
 * satisfy prereqs — planModel.js "Timeline scope"); a cleverer filter here
 * once sprayed phantom grade violations across every transfer-satisfied
 * course the moment a single unrelated grade was entered. Any divergence
 * from what `semIndex[placements[id]]` would yield is a bug in this
 * function, and there is a test asserting the equivalence.
 *
 * @param {Record<string,string>} placements  effective placements (incl.
 *   substitution-virtual entries)
 * @param {Iterable<string>} placedOut
 * @param {Record<string,string>} grades      { placementId → symbol }
 * @param {Record<string,number>} semIndex
 * @returns {null | (baseCourseId: string) => {fi: number|"out", grade: string|null}[]}
 */
export function buildTakesResolver(placements, placedOut, grades, semIndex) {
  if (!grades || !Object.keys(grades).length) return null;
  const byBase = new Map();
  for (const [pid, sid] of Object.entries(placements ?? {})) {
    const fi = semIndex[sid];
    if (fi === undefined) continue; // parked off-timeline
    const b = baseId(pid);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push({ fi, grade: grades[pid] ?? null });
  }
  for (const pid of placedOut ?? []) {
    const b = baseId(pid);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push({ fi: "out", grade: grades[pid] ?? null });
  }
  return id => byBase.get(id) ?? [];
}

/**
 * Per-base effective grade under NEU's replacement rule: the LATEST take's
 * grade is the one that counts; earlier attempts are excluded. An unentered
 * latest take (a planned retake) is assumed to go well → null (assumed).
 *
 * @param {Array<{fi: number|"out", grade: string|null}>} takes
 *   All takes of one base course, any order. `fi` is the semester index
 *   ("out" sorts before everything — a placed-out take is the earliest).
 * @returns {string|null} the grade that counts, or null (assumed pass)
 */
export function effectiveGradeOfTakes(takes) {
  if (!takes?.length) return null;
  let latest = null, latestFi = -Infinity;
  for (const t of takes) {
    const fi = t.fi === "out" ? -1 : (Number.isFinite(t.fi) ? t.fi : -Infinity);
    if (fi >= latestFi) { latestFi = fi; latest = t; }
  }
  return latest?.grade ?? null;
}
