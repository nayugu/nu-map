/**
 * bankRank.js — ordering the course bank's search results.
 *
 * Extracted from `BankPanel.jsx` for one reason: the property that matters
 * here is not testable in a browser. A mutation probe that moved the retired
 * rung ABOVE relevance survived the browser suite, because the natural test —
 * "type a retired course's own code and it still comes first" — matches
 * exactly one course, so there is nothing for it to outrank and the assertion
 * passes vacuously. Rank order between two hits of DIFFERENT score needs two
 * hits, and constructing that from real catalog data is far harder than
 * stating it directly. So the comparator is a pure function in core and
 * `test/unit/bank-rank.test.js` exercises the rungs against each other.
 *
 * (It also belongs here under the hexagonal rule: UI imports core, not the
 * other way round. But the reason it MOVED is the survivor.)
 *
 * ── The rungs, in order ─────────────────────────────────────────────
 *
 * 1. **score** — relevance, computed by the caller. Subject exact/prefix, code
 *    prefix, code substring, then title-only.
 * 2. **retirement** — a retired course sinks below a live one *of equal
 *    relevance*.
 * 3. **tieSort** — the caller's chosen A-Z / credit ordering.
 *
 * ── Why retirement is rung 2 and not rung 1 ─────────────────────────
 *
 * Measured after the 2023-2025 archive backfill took the retired set to 2,257
 * of 10,071 runtime courses (22.4%): **389 retired courses share a subject and
 * title with a live one**, because NEU renumbers rather than retires
 * (ALY 6015 → ALY 6125 "Intermediate Analytics"). On a title query neither
 * code token matches, so both score the same and the winner fell to rung 3 —
 * alphabetical by code, and the retired number is usually the lower one. The
 * retired twin ranked first in **292 of the 389**. A student searching by name
 * was offered, at the top, the course NEU no longer teaches.
 *
 * Above `score` it would be wrong in the other direction: typing a retired
 * course's own code is asking for that course, and burying it under every
 * loosely-matching live course makes it effectively unreachable — the filter
 * behaviour by another route.
 *
 * ── Why it is a tie-break at all, rather than a filter ──────────────
 *
 * `docs/catalog-editions-design.md` §8 step 7 argued a union course should be
 * removed from search: it is required by no program and exists only to resolve
 * a plan that already names it. That was right for a 368-course union produced
 * by ONE roll, and the backfill refutes it. Three years of archive editions are
 * courses students actually TOOK — a continuing student recording CS 2500 from
 * 2023 has to be able to find it. Filtering would break the use case the data
 * was scraped for.
 */

/** 0 for a live course, 1 for a retired one — so ascending order sinks it. */
export const retiredRank = (course) => (course?.retired ? 1 : 0);

/**
 * Compare two scored bank hits.
 *
 * @param {{c: object, score: number}} a
 * @param {{c: object, score: number}} b
 * @param {(x: object, y: object) => number} tieSort  caller's A-Z / SH ordering
 * @returns {number} negative when `a` sorts first
 */
export function compareBankHits(a, b, tieSort) {
  return (
    b.score - a.score
    || retiredRank(a.c) - retiredRank(b.c)
    || tieSort(a.c, b.c)
  );
}
