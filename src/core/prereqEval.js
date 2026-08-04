// ═══════════════════════════════════════════════════════════════════
// PREREQ TREE EVALUATOR — recursive-descent parser  (pure, no React)
//
// ninest/nu-courses prereq format: flat PrerequisiteItem[]
//   strings : "(", ")", "Or", "And"
//   course refs : { subject, number }
//   nested arrays : sub-expressions (from PREREQ_EXTRA patches)
//
// Operator precedence: And > Or  (standard boolean algebra).
// Parentheses override precedence.
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

export function evalPrereqTree(tree, placements, semIndex, ti, placedOut = new Set(), takesOf = null, conditions = null) {
  if (!tree || !tree.length) return "satisfied";
  let pos = 0;

  // null = phantom operand (dangling operator / stray token in scraped data);
  // it must be neutral in merges, NOT "satisfied" — "MATH2331 Or <nothing>"
  // would otherwise always pass and swallow real violations.
  function mergeOr(a, b) {
    if (a === null) return b;
    if (b === null) return a;
    return (a === "satisfied" || b === "satisfied") ? "satisfied"
         : (a === "order"     || b === "order")     ? "order"
         : "missing";
  }
  function mergeAnd(a, b) {
    if (a === null) return b;
    if (b === null) return a;
    return (a === "missing" || b === "missing") ? "missing"
         : (a === "order"   || b === "order")   ? "order"
         : "satisfied";
  }

  // Expression = Term ( "Or" Term )*
  function parseExpr() {
    let v = parseTerm();
    while (pos < tree.length && tree[pos] === "Or") {
      pos++;
      v = mergeOr(v, parseTerm());
    }
    return v;
  }

  // Term = Factor ( "And" Factor )*
  function parseTerm() {
    let v = parseFactor();
    while (pos < tree.length && tree[pos] === "And") {
      pos++;
      v = mergeAnd(v, parseFactor());
    }
    return v;
  }

  // Factor = "(" Expr ")" | NestedArray | CourseRef | ConditionNote | (skip stray token)
  function parseFactor() {
    if (pos >= tree.length) return null;
    const tok = tree[pos];

    if (tok === "(") {
      pos++;
      const v = parseExpr();
      if (pos < tree.length && tree[pos] === ")") pos++;
      return v;
    }

    if (Array.isArray(tok)) {
      pos++;
      return tok.length ? evalPrereqTree(tok, placements, semIndex, ti, placedOut, takesOf, conditions) : null;
    }

    // Non-course condition leaf: { note: "graduate program admission" }.
    // "satisfied" when the plan asserts that condition, otherwise neutral —
    // NEVER "missing", or an undergrad taking a grad course on permission
    // would get a violation we have no evidence for.
    if (tok && typeof tok === "object" && tok.note) {
      pos++;
      return conditionStatus(tok.note, conditions);
    }

    if (tok && typeof tok === "object" && tok.subject && tok.number) {
      pos++;
      const id = `${tok.subject.toUpperCase()}${tok.number}`;

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
      if (placedOut.has(id)) {
        return "satisfied";
      }
      const fi = semIndex[placements[id]];
      if (fi === undefined) return "missing";
      // concurrent prereq: same-semester co-placement is allowed (catalog: "may be taken concurrently")
      return (tok.concurrent ? fi <= ti : fi < ti) ? "satisfied" : "order";
    }

    // Skip ")", stray operators, etc.
    pos++;
    return null;
  }

  return parseExpr() ?? "satisfied";
}
