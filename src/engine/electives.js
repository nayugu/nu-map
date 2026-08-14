// ═══════════════════════════════════════════════════════════════════
// ELECTIVES — what a general elective is FOR, and therefore where it goes
//
// A general elective is the most flexible cell in a plan — any level, any subject, no
// ordering requirement — and the engine treated that flexibility as licence to defer it.
// That is why they stack. Electives are the least constrained cells, so most-constrained-first
// ordering places them LAST, and by then only the late terms have room. The clumping is an
// artifact of WHEN they are chosen, not of any decision about where they belong.
//
// They are also not one thing. About half the pool exists to satisfy NUPath competencies the
// degree does not otherwise guarantee; the rest is the student's own depth. Those two have
// opposite placement logic, and treating them as one category is what makes every plan wrong
// at one end or the other.
//
// The rules live in `docs/chart-elective-rules.md`. This file owns the two that are pure
// arithmetic over the pool — the split and which cells carry it — and nothing about terms.
// Which TERM a cell lands in is the search's decision; rules 2, 4 and 5 are enforced there.
//
// ── Why these are rules and not a score ─────────────────────────────
//
// Every one is decidable from data the engine already computes — the unmet competency codes,
// the pool's size, unlock value, chain depth. None needs a weight, a threshold to tune, or a
// metric to optimise against. A human can read the rules, look at a plan, and say whether it
// followed them. That property is worth more here than any objective function: the failures
// this engine has shipped were not close calls between good plans, they were plans that broke
// a rule nobody had written down.
// ═══════════════════════════════════════════════════════════════════

/**
 * NUPath competencies, in full.
 *
 * Thirteen, not twelve: eleven competencies, but competency 9 ("Writing Across Audiences and
 * Genres") is awarded as three separate codes — `WF`, `WD`, `WI`. Carried here only as the
 * ceiling `remaining` is sanity-checked against; the working figure is MEASURED from the
 * catalog's own attribute data rather than assumed, because a scrape that has lost a code
 * should shrink the breadth need rather than invent a cell for something we cannot see.
 */
export const NUPATH_CODES = 13;

/**
 * Competencies one well-chosen course carries.
 *
 * ── The one estimate in this file, and it is named so it can be argued with ──
 *
 * Not a fact about the catalog: it is what a student ACHIEVES picking well. Many courses carry
 * one code, a good number carry two, and a student who reads the list can cover six
 * competencies in four courses. Set at 1.5 because that is the efficiency the rest of the
 * arithmetic assumes, and it is the figure the worked example in the design doc rests on.
 *
 * It is deliberately NOT derived from `attributes` coverage. That data covers 1,516 of 7,966
 * courses, so the mean codes-per-labelled-course would be a statement about our scrape's
 * completeness rather than about what a student can do. An honest estimate beats a precise
 * measurement of the wrong population.
 *
 * Raising it shrinks the breadth need and hands more cells to depth; lowering it does the
 * reverse. It is the knob, and there is exactly one of it.
 */
export const CODES_PER_COURSE = 1.5;

/**
 * A count, coerced to a non-negative whole number — and `NaN` is a count of nothing.
 *
 * `?? 0` is not enough and the difference is not theoretical. Both inputs here are computed
 * upstream from scraped credit figures — `geCells` is `ceil(geSH / unitSH)` — and `??` catches
 * `null` and `undefined` while passing `NaN` straight through. `Math.floor(NaN)` is `NaN`,
 * `NaN <= 0` is false, so a `NaN` pool used to walk past the guard and come back out as a `NaN`
 * breadth count and a `NaN` depth count. Downstream that is worse than a throw: `breadthIndices`
 * returns an empty set for it, so every cell silently loses its role and nothing reports why.
 *
 * Found by a hostile unit test, not by a plan — which is the point of writing them.
 */
const whole = (x) => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);

/**
 * Rule 1: how much of this elective pool is BREADTH, and how much is the student's own depth.
 *
 * Computed per degree from what the major already guarantees, not from a constant:
 *
 *     satisfied   NUPath codes the major's REQUIRED courses carry, whatever the student picks
 *     remaining   13 − satisfied
 *     breadth     ceil(remaining / 1.5)     ~1.5 codes per course, picking efficiently
 *     depth       cells − breadth
 *
 * Worked, from the design doc: a degree allowing 10 general electives whose required courses
 * leave 6 competencies remaining needs about 4 courses to cover them, leaving 6 electives free
 * for anything.
 *
 * ── What this pins down that the old fixed 3–4 did not ──────────────
 *
 * The previous version took `min(cells, unmet, 4)` — effectively ONE CELL PER UNMET CODE up to
 * a ceiling of four. That is the wrong shape twice over. It ignores that a course can carry two
 * codes, so it over-reserves by about a third; and the ceiling of 4 is a constant that no
 * degree's arithmetic produced.
 *
 * `satisfied` counts only what the major guarantees NO MATTER WHAT. A code carried by one
 * branch of a choice is not satisfied — the student may take the other branch. That reasoning
 * is `breadthCodes`'s already, and `remaining` is simply how many codes it returns: derived
 * from the catalog's own attribute data rather than from `13 − satisfied`, so a competency our
 * scrape cannot see reduces the need instead of reserving a cell for a code we cannot name.
 *
 * Where the arithmetic leaves `depth <= 0` the pool is entirely breadth and there are no depth
 * electives to place. That is the small-pool case, and it falls out of the formula rather than
 * needing a threshold of its own — a degree with two free electives has no room for depth, and
 * calling one of them "depth" would promise a student a choice the credits do not exist for.
 *
 * @param {object} args
 * @param {number} args.cells       general-elective cells in the pool
 * @param {number} args.remaining   unmet competencies — `breadthCodes(...).length`
 * @returns {{breadth: number, depth: number, all: boolean}}
 */
export function breadthSplit({ cells, remaining } = {}) {
  const n = whole(cells);
  if (n <= 0) return { breadth: 0, depth: 0, all: false };
  // Clamped at the real ceiling: a run reporting more unmet codes than NUPath has is a bug
  // upstream, and reserving 14 cells for 13 competencies would be its most expensive symptom.
  const unmet = Math.min(NUPATH_CODES, whole(remaining));
  // Ceil, not round: half a course of breadth is a whole cell to a student, and under-reserving
  // costs a graduation while over-reserving costs a slot they can spend freely anyway.
  const need = Math.ceil(unmet / CODES_PER_COURSE);
  const breadth = Math.min(n, need);
  return { breadth, depth: n - breadth, all: breadth >= n };
}

/**
 * Rule 3: WHICH cells in the pool carry breadth — the later ones, distributed.
 *
 * Breadth courses are shallow by nature, so they are what a plan can afford to defer. But
 * deferring ALL of them is what produces the wall of placeholders, so they lean late and
 * spread rather than clustering at the very end. Rule 2's per-term cap is what actually keeps
 * the lean from becoming a clump; this only decides which cells are which.
 *
 * The previous behaviour bound breadth to cells `0..k-1`, which is backwards: it put the
 * shallowest electives earliest and pushed the student's depth behind them.
 *
 * Indices, not terms. Which TERM a cell lands in is the search's decision. This says which
 * cells carry the competency, and the ordering does the rest.
 *
 * @param {number} n      cells in the pool
 * @param {number} count  how many carry breadth
 * @returns {Set<number>} cell indices that carry breadth
 */
export function breadthIndices(rawN, rawCount) {
  const out = new Set();
  // Same `NaN` hole as `breadthSplit`, and it failed louder here: with `n = NaN` the two guards
  // below are both false, `stride` is `NaN`, and the collision fallback `out.add(k >= 0 ? k :
  // out.size)` added index 0 to a pool of NaN cells. An index into a pool that does not exist.
  const n = whole(rawN);
  const count = whole(rawCount);
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
