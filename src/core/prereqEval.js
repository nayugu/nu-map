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
// ═══════════════════════════════════════════════════════════════════

export function evalPrereqTree(tree, placements, semIndex, ti) {
  if (!tree || !tree.length) return "satisfied";
  let pos = 0;

  function mergeOr(a, b) {
    return (a === "satisfied" || b === "satisfied") ? "satisfied"
         : (a === "order"     || b === "order")     ? "order"
         : "missing";
  }
  function mergeAnd(a, b) {
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

  // Factor = "(" Expr ")" | NestedArray | CourseRef | (skip stray token)
  function parseFactor() {
    if (pos >= tree.length) return "satisfied";
    const tok = tree[pos];

    if (tok === "(") {
      pos++;
      const v = parseExpr();
      if (pos < tree.length && tree[pos] === ")") pos++;
      return v;
    }

    if (Array.isArray(tok)) {
      pos++;
      return evalPrereqTree(tok, placements, semIndex, ti);
    }

    if (tok && typeof tok === "object" && tok.subject && tok.number) {
      pos++;
      const id = `${tok.subject.toUpperCase()}${tok.number}`;
      const fi = semIndex[placements[id]];
      if (fi === undefined) return "missing";
      return fi < ti ? "satisfied" : "order";
    }

    // Skip ")", stray operators, etc.
    pos++;
    return "satisfied";
  }

  return parseExpr();
}
