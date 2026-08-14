// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the cause matrix  (pure)
//
// For the saturated population: the third of degrees whose search runs to 17,000–20,000
// nodes. You cannot draw 17,144 nodes and should not pretend to — but every abandoned
// branch already carries a NAMED cause, and (card × cause) counts are true, compact, and
// more useful than a hairball.
//
// "MGSC 2301's placement was rejected 4,102 times, always for the slot cap" is a sentence
// an advisor can act on. It says the term is full before that card gets there, which is a
// statement about the degree's arithmetic rather than about our search.
//
// ── Why this is a magnitude and not a category ──────────────────────
//
// The values are counts, so the encoding is a SEQUENTIAL single hue — light to dark, one
// ramp. Nothing categorical, so nothing for `validate_palette.js` to check on this view:
// the check exists for adjacent-pair separation among identity colours, and a ramp has no
// pairs to separate. The four fates in the narrowing matrix are the categorical case.
//
// ── The honest caveat, and it must be shown ─────────────────────────
//
// A count here is "times this (card, term) pair was rejected", which is a count of BRANCH
// ATTEMPTS and not of distinct obstructions. A card near the top of the order is retried
// under every arrangement below it, so its counts are inflated by its POSITION as much as
// by its difficulty. That is why `perCard` also carries `depth` — the card's place in the
// search order — so a reader can see the confound rather than be misled by it.
// ═══════════════════════════════════════════════════════════════════

import { CAUSES } from "./events.js";

/**
 * (card × cause) counts, rows sorted by total rejections.
 *
 * @param {object} snapshot
 * @returns {{rows: object[], causes: string[], usedCauses: number[], total: number}}
 */
export function causeMatrix(snapshot) {
  const roster = snapshot?.roster ?? [];
  const counts = snapshot?.causeCounts ?? [];
  const nC = CAUSES.length;
  const order = firstOrder(snapshot);

  const rows = roster.map((card, i) => {
    const by = [];
    let total = 0;
    for (let c = 0; c < nC; c++) {
      const v = counts[i * nC + c] ?? 0;
      by.push(v);
      total += v;
    }
    return {
      card: i,
      id: card.id,
      title: card.title,
      target: card.target,
      by,
      total,
      // Where this card sat in the first attempt's order. See the caveat above: a card
      // early in the order is retried under everything below it, so position confounds
      // count and the reader is entitled to both numbers.
      depth: order.indexOf(i),
      // Terms tried and terms entered, for the thrash ratio. A pair tried forty times and
      // entered twice is the shape counting failures alone cannot show.
      tried: sumRow(snapshot?.termTries, i, snapshot?.nTerms ?? 0),
      entered: sumRow(snapshot?.termEnters, i, snapshot?.nTerms ?? 0),
    };
  });

  rows.sort((a, b) => b.total - a.total || a.depth - b.depth || a.id.localeCompare(b.id));

  // Only the causes that actually fired. A matrix with six empty columns is six columns of
  // white space claiming to be data, and the empty ones are empty for this degree
  // specifically — which is itself worth not implying otherwise.
  const usedCauses = [];
  for (let c = 0; c < nC; c++) {
    if (rows.some(r => r.by[c] > 0)) usedCauses.push(c);
  }

  return {
    rows,
    causes: [...CAUSES],
    usedCauses,
    total: rows.reduce((n, r) => n + r.total, 0),
  };
}

/** Column totals over the causes that fired, biggest first. */
export function causeTotals(matrix) {
  return matrix.usedCauses
    .map(c => ({ cause: matrix.causes[c], code: c,
                 count: matrix.rows.reduce((n, r) => n + r.by[c], 0) }))
    .sort((a, b) => b.count - a.count);
}

const sumRow = (arr, i, width) => {
  if (!arr || !width) return 0;
  let n = 0;
  for (let t = 0; t < width; t++) n += arr[i * width + t] ?? 0;
  return n;
};

/**
 * The first attempt's card order, or an identity order if none was recorded.
 *
 * The FIRST, not the last: it is the order the strict tier used, which is the one the
 * heuristics were designed for. A later rung reorders because `preferenceFree` changes
 * what "most constrained" means, and reporting a rung's order as "the order" would
 * describe a search that only ran because the first one failed.
 */
export function firstOrder(snapshot) {
  const a = (snapshot?.attempts ?? []).find(x => Array.isArray(x.order) && x.order.length);
  if (a) return a.order;
  return (snapshot?.roster ?? []).map((_, i) => i);
}
