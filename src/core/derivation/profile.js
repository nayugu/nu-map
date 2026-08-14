// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the search profile  (pure)
//
// Depth against node index, one line. It is the primary form for one reason that no
// prettier alternative shares: **it is the same chart at both scales.**
//
// Node counts are bimodal — measured p50 52, p90 17,144, max 20,176, with 51% of plans
// at ≤60 nodes and about a third at 17k–20k. So any form that works only for the small
// population is a form for half the corpus, and any form that summarises the large one
// stops being a trace. A 52-node staircase and a 17,144-node sawtooth are both this
// chart, and the difference between the two pictures IS the insight.
//
// How to read it:
//
//   rising           committing cards, one level per card
//   a downward step  a backtrack: that card's terms were all rejected
//   a sawtooth       thrash — the search hammering at the same depth
//   a drop to zero   a restart, or the next rung: a NEW tree
//   touching the top every card has a term
//
// ── The downsample must preserve the ENVELOPE, never average ─────────
//
// This is the single implementation detail most likely to be got wrong, so it is the
// one this file exists to get right. At 20,000 nodes and ~700 px there are ~30 nodes to
// a pixel, and the mean depth of a bucket is a smooth curve through the middle of a
// sawtooth: it erases exactly the backtracks that are the content. So a bucket carries
// its MIN and MAX depth and the chart draws a band, which is lossless about the one
// thing being asked ("how far did it get, and how far back did it fall") while being
// honest that a bucket is many nodes.
// ═══════════════════════════════════════════════════════════════════

import { NODE } from "./events.js";

/**
 * How many buckets a downsampled profile has.
 *
 * 720, which is about one bucket per CSS pixel at the panel's width. Sampling finer than
 * the pixels cannot be seen and sampling coarser throws away detail that could have been.
 */
export const PROFILE_BUCKETS = 720;

/**
 * The node count under which the profile is drawn node-for-node.
 *
 * `PROFILE_BUCKETS` itself: below that there are fewer nodes than buckets, so bucketing
 * is a no-op with extra arithmetic. Stated as a derived constant rather than a second
 * number, because two numbers that must agree eventually will not.
 */
export const EXACT_BELOW = PROFILE_BUCKETS;

/**
 * The profile, as buckets of (min depth, max depth, last depth, worst outcome).
 *
 * `last` is what a single-line rendering draws; `lo`/`hi` are the band. `worst` carries
 * the most severe node outcome in the bucket so a marker can sit where the search hit a
 * wall — severity being "the thing a reader most needs to see survives compression",
 * which is the same argument as the envelope.
 *
 * @param {object} snapshot a `createTrace().snapshot()`
 * @param {number} [buckets]
 * @returns {{buckets: {at:number, lo:number, hi:number, last:number, worst:number}[],
 *            exact: boolean, nodes: number, maxDepth: number, cards: number}}
 */
export function searchProfile(snapshot, buckets = PROFILE_BUCKETS) {
  const depth = snapshot?.depth ?? [];
  const result = snapshot?.result ?? [];
  const n = depth.length;
  const cards = snapshot?.roster?.length ?? 0;
  if (!n) return { buckets: [], exact: true, nodes: 0, maxDepth: 0, cards };

  let maxDepth = 0;
  for (let i = 0; i < n; i++) if (depth[i] > maxDepth) maxDepth = depth[i];

  // ── Severity, not recency ─────────────────────────────────────────
  //
  // When a bucket holds thirty nodes it holds thirty outcomes, and the reader wants the
  // interesting one. Ranked so that a wall (budget, time) outranks a refused complete
  // assignment, which outranks an ordinary backtrack, which outranks nothing happening.
  // `SOLVED` sits at the top because there is exactly one of it and losing it would mean
  // the chart could not show where the answer was found.
  const severity = (code) => (
    code === NODE.SOLVED ? 6
    : code === NODE.BUDGET || code === NODE.TIME ? 5
    : code === NODE.GOAL_BAR ? 4
    : code === NODE.GOAL_WITNESS ? 3
    : code === NODE.EMPTY_DOMAIN ? 2
    : code === NODE.EXHAUSTED ? 1
    : 0);

  if (n <= buckets) {
    return {
      buckets: depth.map((d, i) => ({ at: i, lo: d, hi: d, last: d, worst: result[i] ?? 0 })),
      exact: true, nodes: n, maxDepth, cards,
    };
  }

  const out = [];
  // Ceil, so the last bucket is never a wide one holding the remainder — a fat final
  // bucket reads as the search slowing down at the end, which it did not.
  const per = Math.ceil(n / buckets);
  for (let b = 0; b * per < n; b++) {
    const s = b * per;
    const e = Math.min(n, s + per);
    let lo = depth[s], hi = depth[s], worst = 0;
    for (let i = s; i < e; i++) {
      const d = depth[i];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
      const sv = severity(result[i] ?? 0);
      if (sv > severity(worst)) worst = result[i] ?? 0;
    }
    out.push({ at: s, lo, hi, last: depth[e - 1], worst });
  }
  return { buckets: out, exact: false, nodes: n, maxDepth, cards };
}

/**
 * Where each attempt starts, in bucket coordinates.
 *
 * The restart and rung boundaries are the only annotation the profile needs: a drop to
 * zero is visible, but WHY it dropped — a nogood learned, or a convention given up — is
 * not, and those are different events that look identical.
 */
export function attemptMarks(snapshot, profile) {
  const n = profile?.nodes ?? 0;
  if (!n) return [];
  const scale = profile.exact ? 1 : (profile.buckets.length / n);
  return (snapshot?.attempts ?? []).map((a, i) => ({
    index: i,
    at: a.at,
    x: profile.exact ? a.at : Math.min(profile.buckets.length - 1, Math.floor(a.at * scale)),
    tier: a.tier,
    rung: a.rung ?? null,
    gave: a.gave ?? null,
    restart: a.restart ?? 0,
    // How many nodes this attempt spent. The last one runs to the end of the recording.
    nodes: ((snapshot.attempts[i + 1]?.at) ?? n) - a.at,
  }));
}

/**
 * The node where the answer was found, if there is one.
 *
 * ── The LAST such node, and both words are load-bearing ─────────────
 *
 * Every node on the winning spine returns true, so `SOLVED` marks a whole path rather than a
 * point. The first would name the root — the start of the search — and the DEEPEST was the
 * first version here and is wrong for a subtler reason that a corpus test caught: a single
 * generate can contain TWO searches.
 *
 * `withPackerRetry` runs the ladder, has its plan refused by the hard criteria, and runs the
 * packer instead; `generatePlan` can then re-derive without breadth guidance and run the whole
 * pipeline again. So a recording may hold an arrangement that was found and then thrown away,
 * followed by the one that shipped — and picking by depth can name the FIRST, marking a stage
 * as "produced this plan" when its plan was discarded.
 *
 * The last `SOLVED` is unambiguous on both counts: inside a successful attempt the goal test is
 * both the deepest node and the last recorded, and across retries the final search's goal test
 * is the last of all. One scan from the end.
 */
export function solvedAt(snapshot) {
  const result = snapshot?.result ?? [];
  for (let i = result.length - 1; i >= 0; i--) if (result[i] === NODE.SOLVED) return i;
  return -1;
}
