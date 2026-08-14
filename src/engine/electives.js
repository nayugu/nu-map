// ═══════════════════════════════════════════════════════════════════
// ELECTIVES — four rules, written down
//
// A free elective is the most flexible cell in a plan, and for most of this engine's life it
// has been treated as one undifferentiated thing: filler, to be placed wherever room was left.
// That is wrong in a way that shows up in every plan. Electives are not one thing, and what an
// elective is FOR decides where it belongs.
//
//   1. SPLIT THE POOL. Breadth need is 3-4 courses — the NUPath competencies a degree does not
//      already guarantee. If the pool is smaller than 3 slots or 8 SH, it is ALL breadth and
//      there are no depth electives to place.
//
//   2. BREADTH LEANS LATE, DISTRIBUTED. One or two to a term, never stacked at the end. These
//      are shallow by nature, so they are what a plan can afford to defer — but deferring all
//      of them produces the wall of placeholders a student sees in years three and four.
//
//   3. EVERY OTHER ELECTIVE HAS NO SPECIAL RULE. It enters the same unlock-then-depth ordering
//      as a major course. Where a major has deep chains of its own, these fill in around them;
//      where it does not, they ARE the depth and the ordering puts them early on its own. Same
//      rule, opposite-looking plans, because the inputs differ.
//
//   4. AN ELECTIVE NEVER TAKES A SLOT AN UNLOCKED MAJOR COURSE COULD USE. Measured on
//      `computer_science_and_mathematics_bs`: a reservation took Year 1 Summer 1 and pushed
//      CS 3100 back to Year 2 Fall. An elective can go anywhere; a major course, once its
//      prerequisites are met, has a reason to be exactly there.
//
// ── Why these are rules and not a score ─────────────────────────────
//
// Every one of them is decidable from data the engine already computes — the unmet competency
// codes, the pool's size, unlock value, chain depth. None needs a weight, a threshold to tune,
// or a metric to optimise against. A human can read the four lines above, look at a plan, and
// say whether it followed them. That property is worth more here than any objective function:
// the failures this engine has actually shipped were not close calls between good plans, they
// were plans that broke a rule nobody had written down.
// ═══════════════════════════════════════════════════════════════════

/**
 * How many courses of breadth a degree needs.
 *
 * Three to four, and bounded by what is actually unmet — a degree whose named courses already
 * carry most competencies needs fewer. Never more than the pool holds.
 */
export const BREADTH_NEED = 4;

/**
 * Rule 1: how many of this elective pool are breadth, and is the pool ALL breadth?
 *
 * The small-pool case is not an edge case, it is a common shape: a degree with two free
 * electives has no room for depth electives at all, and treating one of them as "depth" would
 * promise a student a choice the credits do not exist for.
 *
 * @param {number} n         elective cells in the pool
 * @param {number} poolSH    their combined credit
 * @param {number} unmet     unmet NUPath competencies
 * @returns {{count: number, all: boolean}}
 */
export function breadthSplit(n, poolSH, unmet) {
  if (n <= 0) return { count: 0, all: false };
  // Under three slots or eight credits there is nothing left over once breadth is served.
  if (n < 3 || poolSH <= 8) return { count: Math.min(n, unmet), all: true };
  return { count: Math.min(n, unmet, BREADTH_NEED), all: false };
}

/**
 * Rule 2: WHICH cells in the pool carry breadth — the later ones, distributed.
 *
 * The previous behaviour bound breadth to cells 0..k-1, so the shallowest electives in the
 * degree were also the earliest, and the depth a student could show at co-op recruiting was
 * pushed behind them. This walks from the back and steps by an even stride, so `k` breadth
 * cells among `n` land spread across the later portion rather than clustered at the very end.
 *
 * Indices, not terms: which TERM a cell lands in is the search's decision. This says which
 * cells carry the competency, and the ordering does the rest — a cell marked breadth is
 * shallow, and shallow cells sort late under the same rule that sorts everything else.
 *
 * @returns {Set<number>} cell indices that carry breadth
 */
export function breadthIndices(n, count) {
  const out = new Set();
  if (count <= 0 || n <= 0) return out;
  if (count >= n) { for (let i = 0; i < n; i++) out.add(i); return out; }
  // Stride across the back, from the last cell forward. A stride of `n / count` spreads them
  // evenly; starting at the end is what makes them lean late.
  const stride = n / count;
  for (let i = 0; i < count; i++) {
    const idx = Math.max(0, Math.round(n - 1 - i * stride));
    // Collisions only happen when count is close to n, where the exact placement no longer
    // matters — fall back to the next free index rather than dropping a competency.
    let k = idx;
    while (k >= 0 && out.has(k)) k--;
    out.add(k >= 0 ? k : out.size);
  }
  return out;
}
