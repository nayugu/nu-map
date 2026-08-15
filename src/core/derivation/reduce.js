// ═══════════════════════════════════════════════════════════════════
// DERIVATION · events → a model  (pure)
//
// One function the UI calls and four modules it composes. Everything from a recorded run
// to a renderable model is here, in `src/core/`, so it is unit-testable without a browser
// — which is where the hostile tests go, and the reason the split exists at all.
//
// ── The stage spine is the only element that shows the FOREST ────────
//
// A full generate is not one tree. It is demand → narrowing → up to 40 restarts × up to 4
// relaxation rungs, each rung a DIFFERENT CONSTRAINT SET → possibly a greedy packer →
// hill climbing over complete assignments. Only the middle of that is a tree at all, and
// no single picture may be captioned "the search". So the spine names the stages, marks
// the one that answered, and says what each gave up — small, exact, and the frame every
// other view sits inside.
//
// It is drawn with EMPHASIS rather than magnitude: the stage that produced the plan takes
// the accent, the ones that failed are recessive gray. That is the honest encoding, because
// exactly one attempt produced the plan and the others are the cost of finding it.
// ═══════════════════════════════════════════════════════════════════

import { NODE } from "./events.js";
import { searchProfile, attemptMarks, solvedAt } from "./profile.js";
import { causeMatrix, causeTotals, firstOrder } from "./causes.js";
import { narrowingMatrix, inSearchOrder } from "./narrowing.js";
import { attemptSizes, pickAttempt } from "./tree.js";

/**
 * The node count above which a program is "saturated" — the upper mode.
 *
 * 2,000. The measured distribution is bimodal with almost nothing between 2,000 and
 * 17,000: 63% of plans are at or below 2,000 and the rest sit at 17k–20k. So the cut can
 * be anywhere in that gap and the classification is stable — which is why it is worth
 * classifying at all rather than showing a continuum, and why the number does not need
 * defending to a hundred nodes.
 */
export const SATURATED_NODES = 2000;

/**
 * A recorded run, as the panel needs it.
 *
 * @param {object} snapshot from `createTrace().snapshot()`
 * @returns {object|null} null for a snapshot with nothing in it, so a caller can render
 *   the absence rather than an empty chart claiming a search happened.
 */
export function deriveModel(snapshot) {
  if (!snapshot || !(snapshot.roster?.length)) return null;
  // ── There was a `stale` guard here, and it was wrong ────────────────
  //
  // It returned null for any recording marked `stale`, to stop the panel walking a reader
  // through a plan that had been thrown away. But `withPackerRetry` — the only place that ever
  // marked it — reached that line ONLY when both of its passes refused, so there was never a
  // plan involved and never anything to misrepresent. The guard fired exclusively on refused
  // degrees and blanked the one view they have. See the note there; the marker is gone.
  //
  // Nothing replaces it. A recording that genuinely described a discarded plan would be a real
  // hazard, but no path produces one: every caller that returns a PLAN returns the pass the
  // recording holds. A guard against a state the code cannot reach, encoding a belief that is
  // false, is worse than no guard — this one cost every refused-with-a-retry degree its
  // explanation for as long as it existed.

  const profile = searchProfile(snapshot);
  const marks = attemptMarks(snapshot, profile);
  const causes = causeMatrix(snapshot);
  const narrowing = narrowingMatrix(snapshot);
  const order = firstOrder(snapshot);
  const attempts = attemptSizes(snapshot);
  const solved = solvedAt(snapshot);

  const stage = (name) => (snapshot.stages ?? []).find(s => s.name === name) ?? null;
  const demand = stage("demand-done");
  const narrowed = stage("narrowing-done");
  const searchDone = stage("search-done");
  const improved = stage("improve-done");
  const refused = stage("refused");
  const packer = (snapshot.stages ?? []).filter(s => s.name === "packer-done");
  const retries = (snapshot.stages ?? []).filter(s => s.name === "retry");
  const nogoods = (snapshot.stages ?? []).filter(s => s.name === "nogood");

  return {
    // ── The spine, in the order the pipeline runs ───────────────────
    stages: buildSpine({
      demand, narrowed, attempts, searchDone, improved, refused, packer, retries, nogoods,
      snapshot, solved,
    }),
    profile,
    marks,
    causes,
    causeTotals: causeTotals(causes),
    narrowing,
    // Rows in search order, since the matrix is a picture of a search and its rows are its
    // levels. See `inSearchOrder`.
    narrowingRows: inSearchOrder(narrowing, order),
    order,
    attempts,
    defaultAttempt: pickAttempt(snapshot),
    solved,
    summary: {
      nodes: profile.nodes,
      cards: snapshot.roster.length,
      terms: snapshot.terms?.length ?? 0,
      legalPairs: narrowed?.legalPairs ?? null,
      rejects: causes.total,
      restarts: attempts.filter(a => a.tier === "strict").length - 1,
      rungs: attempts.filter(a => a.tier === "rung").length,
      relaxed: searchDone?.relaxed ?? [],
      moves: improved?.moves ?? 0,
      packed: packer.some(p => p.ok),
      refused: !!refused,
      refusedReason: refused?.reason ?? null,
      truncated: !!snapshot.truncated,
      // WHICH population this program is in, and therefore which view leads. Stated in the
      // model rather than decided in the component, so the panel and the tests agree about
      // it — and so the panel can say WHY it is showing a matrix instead of a tree.
      saturated: profile.nodes > SATURATED_NODES,
      // ── The two numbers a person can actually picture ─────────────
      //
      // `takenBack` is how many times the engine put a course somewhere, got stuck further down,
      // and undid it — a node whose every term was tried and failed. It is the one count in the
      // whole recording that maps onto something a human does at a whiteboard, and it is the
      // concrete form of the otherwise abstract "branches rejected".
      //
      // `arrangementsLog10` is the size of the space, as an exponent, and it exists because
      // "13,019 placements" is unreadable in isolation: against 10^31 possible layouts it becomes
      // the point rather than a big number. An UPPER bound — the product of each course's own
      // window, so it counts layouts a prerequisite between two courses forbids — and the panel
      // says so on hover. The exact count is #P-complete in general and the text explainer
      // already declined to compute it for the same reason.
      takenBack: (() => {
        let n = 0;
        for (const r of snapshot.result ?? []) if (r === NODE.EXHAUSTED) n += 1;
        return n;
      })(),
      arrangementsLog10: (() => {
        let log = 0;
        for (const r of narrowing.rows) if (r.legalCount > 0) log += Math.log10(r.legalCount);
        return Math.round(log);
      })(),
      // Whether the attempt the panel would OPEN on is legible as a tree — not whether any
      // attempt is. A flag that is true because restart 37 happens to be small would offer a
      // view of a tree the reader did not ask about.
      drawableTree: !!attempts[pickAttempt(snapshot)]?.drawable,
      cuts: snapshot.cuts ?? 0,
    },
  };
}

/**
 * The stages, each with what it cost and whether it answered.
 *
 * `answered` is set on exactly one stage where a plan was produced, and on NONE where the
 * degree was refused. That single flag is what the accent renders, and it is what makes the
 * spine a statement rather than a list.
 *
 * ── "Found an arrangement" is not "produced the plan" ────────────────
 *
 * A corpus test caught this claiming otherwise, and the distinction is real rather than
 * pedantic. The search can find a complete, legal arrangement that the HARD CRITERIA then
 * refuse — an empty term, a term of nothing but unlabelled electives — and if the packer behind
 * it also fails, the degree is refused while the recording still holds a solved search.
 * `information_design_and_visualization_graduate_certificate` is exactly that.
 *
 * Marking that stage "produced this plan" is false in the most misleading direction available:
 * the panel would accent a success inside a refusal. So a refused run gets `arrangement` on that
 * stage instead, which says what actually happened — an arrangement was found and rejected
 * afterwards — and `answered` on nothing.
 */
function buildSpine({ demand, narrowed, attempts, searchDone, improved, refused, packer,
                      retries, nogoods, snapshot, solved }) {
  const out = [];
  out.push({
    key: "demand", kind: "fixed",
    cards: demand?.cells ?? snapshot.roster.length,
    sh: demand?.sh ?? null,
  });
  out.push({
    key: "narrowing", kind: "fixed",
    cards: narrowed?.cards ?? snapshot.roster.length,
    terms: narrowed?.terms ?? (snapshot.terms?.length ?? 0),
    legalPairs: narrowed?.legalPairs ?? null,
  });

  // The strict tier is ONE stage with a restart count, not 41 stages. Each restart is the
  // same constraint set with one nogood removed, so calling them separate stages would
  // claim four decisions where the engine made one.
  const strict = attempts.filter(a => a.tier === "strict");
  if (strict.length) {
    out.push({
      key: "strict", kind: "search", gave: null,
      restarts: strict.length - 1,
      nodes: strict.reduce((n, a) => n + a.nodes, 0),
      learned: nogoods.length,
      ...verdict(solvedIn(snapshot, strict, solved), refused),
    });
  }
  for (const a of attempts.filter(x => x.tier === "rung")) {
    out.push({
      key: `rung-${a.rung}`, kind: "search", gave: a.gave, nodes: a.nodes,
      ...verdict(solvedIn(snapshot, [a], solved), refused),
    });
  }
  for (const p of packer) {
    out.push({ key: "packer", kind: "greedy", only: !!p.only, ...verdict(!!p.ok, refused) });
  }
  if (retries.length) {
    // A retry is a whole second pass over demand and search under different assumptions,
    // so it is shown rather than folded away. The reader is otherwise looking at one
    // recording that contains two searches with no explanation for the seam.
    out.push({ key: "retry", kind: "note", because: retries.map(r => r.because) });
  }
  if (improved) {
    out.push({
      key: "improve", kind: "local",
      moves: improved.moves ?? 0, trades: improved.trades ?? 0,
      reclaimed: improved.reclaimed ?? 0, depthTrades: improved.depthTrades ?? 0,
    });
  }
  if (refused) {
    out.push({
      key: "refused", kind: "refusal",
      reason: refused.reason ?? null,
      exhaustedSpace: !!refused.exhaustedSpace,
    });
  }
  return out;
}

/**
 * One stage's verdict: it produced the plan, or it merely found an arrangement.
 *
 * Split rather than a boolean because a refusal that contains a solved search is a real state
 * and the two readings send a person to different places — "this stage produced your plan" is
 * an explanation, "this stage found an arrangement the criteria then refused" is a complaint
 * about the degree.
 */
const verdict = (won, refused) => (!won ? {} : refused ? { arrangement: true } : { answered: true });

/** Did the winning node fall inside any of these attempts? */
function solvedIn(snapshot, group, solved) {
  if (solved < 0) return false;
  const total = snapshot.depth?.length ?? 0;
  const all = snapshot.attempts ?? [];
  return group.some(a => {
    const s = all[a.index]?.at ?? 0;
    const e = all[a.index + 1]?.at ?? total;
    return solved >= s && solved < e;
  });
}

export { NODE };
