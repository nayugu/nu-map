// ═══════════════════════════════════════════════════════════════════
// PREREQ TREE EVALUATOR  (pure, no React)
//
// The grammar itself lives in prereqFold.js — this file is only the algebra
// that turns it into a placement verdict. Three consumers now read the same
// token list (this, CHART's depth pass, CHART's reachability check), and a
// second hand-written recursive-descent parser would drift from this one on the
// first patched sub-expression.
//
// Returns "satisfied" | "order" | "missing"
//   "satisfied" : all prereqs are placed in earlier semesters
//   "order"     : a prereq is placed but in the same or a later semester
//   "missing"   : a prereq is not placed in the plan at all
//
// Optional `takesOf(baseId) → [{fi: number|"out", grade: string|null}]`
// makes the evaluation grade- and retake-aware: a ref is satisfied iff
// SOME take of it is placed early enough AND its grade clears the ref's
// minGrade gate (unentered grades clear everything — see gradeSystem).
// Absent, the legacy placement-only path below runs bit-for-bit; the
// call sites derive "blocked by grade" by comparing the two results.
//
// Optional `conditions` (a Set of met condition kinds from
// planConditions()) resolves non-course { note } leaves — "graduate program
// admission" passes in a graduate plan. Omitted, every note is neutral,
// which is the legacy behaviour. Conditions can only ever satisfy a branch,
// never fail one (see prereqConditions.js).
// ═══════════════════════════════════════════════════════════════════
import { satisfiesGate } from "./gradeSystem.js";
import { conditionStatus } from "./prereqConditions.js";
import { foldPrereqTree, refId } from "./prereqFold.js";

// "satisfied" beats "order" beats "missing" under Or; the reverse under And.
// Phantom operands never reach these — foldPrereqTree short-circuits null.
const mergeOr = (a, b) =>
  (a === "satisfied" || b === "satisfied") ? "satisfied"
  : (a === "order"   || b === "order")     ? "order"
  : "missing";
const mergeAnd = (a, b) =>
  (a === "missing" || b === "missing") ? "missing"
  : (a === "order" || b === "order")   ? "order"
  : "satisfied";

export function evalPrereqTree(tree, placements, semIndex, ti, placedOut = new Set(), takesOf = null, conditions = null) {
  const status = foldPrereqTree(tree, {
    or: mergeOr,
    and: mergeAnd,

    // Non-course condition leaf: { note: "graduate program admission" }.
    // "satisfied" when the plan asserts that condition, otherwise neutral —
    // NEVER "missing", or an undergrad taking a grad course on permission
    // would get a violation we have no evidence for.
    note: (tok) => conditionStatus(tok.note, conditions),

    course: (tok) => {
      const id = refId(tok);

      // Grade/retake-aware path: consider every take of the course. A take
      // whose grade fails the gate (F/U/I/W, or a letter below minGrade)
      // contributes nothing — as if that attempt weren't there. This is how
      // a failed first take plus a well-placed retake evaluates clean, and
      // a failed take with no retake evaluates "missing" (needs another).
      if (takesOf) {
        let best = "missing";
        for (const t of takesOf(id) ?? []) {
          if (!satisfiesGate(t.grade, tok.minGrade)) continue;
          if (t.fi === "out") return "satisfied";
          if (!Number.isFinite(t.fi)) continue;
          if (tok.concurrent ? t.fi <= ti : t.fi < ti) return "satisfied";
          best = "order";
        }
        return best;
      }

      // If the prerequisite course is placed out, it's satisfied regardless of semester.
      if (placedOut.has(id)) return "satisfied";
      const fi = semIndex[placements[id]];
      if (fi === undefined) return "missing";
      // concurrent prereq: same-semester co-placement is allowed (catalog: "may be taken concurrently")
      return (tok.concurrent ? fi <= ti : fi < ti) ? "satisfied" : "order";
    },
  });
  // No operand at all — an empty tree, or one made entirely of junk tokens —
  // is not a prerequisite, so nothing is unmet.
  return status ?? "satisfied";
}
