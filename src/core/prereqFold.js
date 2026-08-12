// ═══════════════════════════════════════════════════════════════════
// PREREQ TREE FOLD — the parser, once  (pure, no React)
//
// The scraped prereq format is a flat token list, and reading it correctly is
// fiddly enough that having two readers guarantees they will drift:
//
//   strings        "(", ")", "Or", "And"
//   course refs    { subject, number, minGrade?, concurrent? }
//   condition refs { note: "graduate program admission" }
//   nested arrays  sub-expressions (from PREREQ_EXTRA patches)
//
// Operator precedence is standard boolean algebra — And binds tighter than Or —
// and parentheses override it.
//
// `evalPrereqTree` needs "is this satisfied, given placements". CHART needs "how
// many terms must precede this" and "is this reachable, under the engine's own
// unresolvable-ref policy". Those are three different values over ONE grammar,
// so the grammar lives here and each caller supplies the algebra.
//
// ── null is a phantom operand, not a truth value ───────────────────
//
// Scraped data contains dangling operators and stray tokens. "MATH2331 Or
// <nothing>" must not read as satisfied — that would swallow real violations —
// so a missing operand folds to `null` and every combinator treats null as
// absent rather than as a value. That rule is enforced here, once, instead of in
// each caller's merge functions.
// ═══════════════════════════════════════════════════════════════════

/**
 * @template T
 * @typedef {Object} PrereqAlgebra
 * @property {(tok: object) => T|null} course  a { subject, number } leaf
 * @property {(tok: object) => T|null} note    a { note } leaf
 * @property {(a: T, b: T) => T} or
 * @property {(a: T, b: T) => T} and
 */

/**
 * Parse once, reporting both the folded value and where the parse stopped.
 *
 * @template T
 * @param {any[]|null|undefined} tree
 * @param {PrereqAlgebra<T>} ops
 * @returns {{value: T|null, complete: boolean}}
 */
function run(tree, ops) {
  if (!Array.isArray(tree) || !tree.length) return { value: null, complete: true };
  let pos = 0;
  let complete = true;      // cleared when a nested sub-expression is incomplete

  // A combinator only ever sees two real operands; null short-circuits to the
  // other side. This is what makes a dangling operator neutral.
  const or  = (a, b) => (a === null ? b : b === null ? a : ops.or(a, b));
  const and = (a, b) => (a === null ? b : b === null ? a : ops.and(a, b));

  // Expression = Term ( "Or" Term )*
  function parseExpr() {
    let v = parseTerm();
    while (pos < tree.length && tree[pos] === "Or") { pos++; v = or(v, parseTerm()); }
    return v;
  }

  // Term = Factor ( "And" Factor )*
  function parseTerm() {
    let v = parseFactor();
    while (pos < tree.length && tree[pos] === "And") { pos++; v = and(v, parseFactor()); }
    return v;
  }

  // Factor = "(" Expr ")" | NestedArray | CourseRef | ConditionNote | (skip stray)
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
      const sub = run(tok, ops);
      if (!sub.complete) complete = false;
      return sub.value;
    }

    if (tok && typeof tok === "object" && tok.note) {
      pos++;
      return ops.note ? ops.note(tok) : null;
    }

    if (tok && typeof tok === "object" && tok.subject && tok.number) {
      pos++;
      return ops.course ? ops.course(tok) : null;
    }

    pos++;               // ")", stray operator, junk
    return null;
  }

  const value = parseExpr();
  return { value, complete: complete && pos >= tree.length };
}

/**
 * Fold a prereq token list with a caller-supplied algebra.
 *
 * @template T
 * @param {any[]|null|undefined} tree
 * @param {PrereqAlgebra<T>} ops
 * @returns {T|null} null when the tree carries no operand at all
 */
export function foldPrereqTree(tree, ops) {
  return run(tree, ops).value;
}

/**
 * Did the parse read the whole token list?
 *
 * A token that is neither an operand nor the operator the position expects
 * TERMINATES the parse, so everything after it is silently discarded —
 * `[CS2500, 42, "And", MATH1341]` reads as `CS2500` alone, and a leading `"Or"`
 * makes an entire tree read as "no prerequisites".
 *
 * That behaviour is deliberately left alone rather than "fixed", because no
 * recovery is provably right: skipping the junk token INVENTS the conjunction
 * `CS2500 And MATH1341`, and truncating DROPS a real requirement. Both are
 * wrong, in opposite directions, and the token list is telling us we cannot
 * read this course's prerequisites at all.
 *
 * Measured instead: **all 2,614 prereq trees in the shipped catalog parse to
 * completion**, so today the question never arises. This function is the
 * tripwire for that ceasing to be true — the same role `deepPools` plays for
 * requirementDemand's shallow read — so a scrape that starts emitting malformed
 * trees is loud rather than silent.
 *
 * Corequisite lists are NOT covered: every consumer reads them as a flat array
 * of refs and never applies this grammar, so their 51 non-ref entries are
 * skipped rather than truncating anything.
 */
export function prereqParseComplete(tree) {
  return run(tree, { course: () => 1, note: () => 1, or: () => 1, and: () => 1 }).complete;
}

/** The canonical id of a course reference, as every consumer keys courses. */
export const refId = (tok) =>
  `${String(tok.subject).toUpperCase()}${tok.number}`;

/**
 * Every course id a prereq tree mentions, regardless of structure.
 *
 * Structure-blind on purpose: callers that want "which courses appear" (the
 * course bank's dependency view, a depth pre-pass) should not have to know the
 * grammar, and callers that need the boolean shape should fold instead.
 */
export function prereqRefIds(tree) {
  const out = new Set();
  foldPrereqTree(tree, {
    course: (tok) => { out.add(refId(tok)); return 1; },
    note: () => 1,
    or: () => 1,
    and: () => 1,
  });
  return out;
}
