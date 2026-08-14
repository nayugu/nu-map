// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the literal tree  (pure)
//
// "You go down one, and if it fails you go down another, and if that succeeds you go to
// the next level." That is exactly what `attemptPlacement` does, and for the half of the
// corpus that finishes in a few dozen nodes it can be drawn as itself — no summary, no
// aggregate, one mark per node the engine actually expanded.
//
// ── Why this is reconstructible at all ──────────────────────────────
//
// The recording is a DFS PRE-ORDER: nodes are appended in the order `step()` enters them.
// In a pre-order, a node's parent is the most recent earlier node one level shallower —
// there is no ambiguity to resolve and no id to store, so the tree costs one linear pass
// over three flat arrays. The only thing that had to be ADDED to the engine for this is
// the term on each incoming edge (`from` in `step`), because depth and card alone say
// which level a node is on and not which branch.
//
// ── The CUT LEAVES are half the tree, and were missing ──────────────
//
// A node exists only where the search DESCENDED, so the first version of this drew
// Architecture as 36 levels and one node per level: a bare chain, from a search that had
// in fact cut 21 branches. "The engine considered exactly one option per card" is what
// that picture says, and it is false.
//
// So a rejected term is drawn too, as a leaf on the node that tried it, carrying the cause
// it died of. A level then reads correctly: a handful of terms attempted, most cut
// immediately, at most one continuing downward. Recorded positionally by `trace.branch`.
//
// What this makes visible is the corpus's real headline, and it is not the one the design
// expected: for the small population the engine's first choice usually works, so the tree
// is a tall staircase with a thin fringe rather than a bush. That is worth SHOWING rather
// than smoothing away — "it never had to go back" is a fact about the degree.
//
// ── And why it is not the primary view ──────────────────────────────
//
// It serves 51% of programs (≤60 nodes) and is unreadable for the third that run to
// 17,000–20,000. Drawing 17,144 nodes is not a picture of a search, it is a texture. So
// the panel leads with the profile, which is honest at both scales, and offers the tree
// where the tree is genuinely legible — and SAYS which case the reader is in, because a
// view that silently changes what it is showing is worse than one that explains itself.
// ═══════════════════════════════════════════════════════════════════

import { NODE, DEAD, CAUSES, CUT_POSITIONS_PER_ATTEMPT } from "./events.js";

/**
 * The most nodes worth drawing as a tree.
 *
 * 600. Above it the marks are below a pixel apart at any width the panel has, so the
 * drawing stops carrying node identity — which is the only thing the tree adds over the
 * profile. Measured against the corpus distribution this covers the 57% of plans at ≤500
 * nodes with room to spare, and excludes the 17k–20k mode entirely, which is the intended
 * split rather than a coincidence.
 */
export const DRAWABLE_NODES = 600;

/**
 * The most MARKS worth drawing, nodes and cut leaves together.
 *
 * Two limits are needed because the two counts are not proportional: cuts outnumber nodes
 * about nine to one on average, and the ratio varies by a lot — Architecture cuts 21
 * branches across 36 nodes, Business Administration cuts 8,567 across 1,012. So a program
 * can pass the node bound and still be a wall of leaves, which is the failure the node
 * bound alone would let through.
 */
export const DRAWABLE_MARKS = 1800;

// Under `CUT_POSITIONS_PER_ATTEMPT`, and that is a REQUIREMENT rather than a coincidence: the
// recorder stops keeping cut positions past that many per attempt, so declaring an attempt
// drawable above it would draw a tree with leaves silently missing. Asserted in the unit suite,
// because a wrong number here produces a plausible picture rather than an error.
if (DRAWABLE_MARKS > CUT_POSITIONS_PER_ATTEMPT) {
  throw new Error("DRAWABLE_MARKS exceeds what the trace records per attempt");
}

const DEAD_SET = new Set(DEAD);

/**
 * One attempt's tree, as nodes with parent links and layout coordinates.
 *
 * @param {object} snapshot
 * @param {number} [attempt] which attempt to build; default the one that SOLVED, else the
 *   longest — the two questions a reader has are "how did it succeed" and "what did it
 *   spend its time on", and those are the two attempts that answer them.
 * @returns {{nodes: object[], attempt: number, drawable: boolean, span: number,
 *            width: number, depth: number}}
 */
export function searchTree(snapshot, attempt = null) {
  const attempts = snapshot?.attempts ?? [];
  const total = snapshot?.depth?.length ?? 0;
  if (!total) return { nodes: [], attempt: -1, drawable: false, span: 0, width: 0, depth: 0 };

  const ai = attempt != null ? attempt : pickAttempt(snapshot);
  const start = attempts[ai]?.at ?? 0;
  const end = attempts[ai + 1]?.at ?? total;
  const span = end - start;

  // The cuts belonging to this attempt, gathered before the drawable decision — because the
  // decision depends on them and because a second pass over 116,000 entries to find out is
  // the kind of thing that gets written once and then done twice.
  const cutNode = snapshot.cutNode ?? [];
  const byParent = new Map();
  let cutsHere = 0;
  for (let k = 0; k < cutNode.length; k++) {
    const p = cutNode[k];
    if (p < start || p >= end) continue;
    cutsHere++;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(k);
  }

  if (span > DRAWABLE_NODES || span + cutsHere > DRAWABLE_MARKS) {
    return { nodes: [], attempt: ai, drawable: false, span, cuts: cutsHere,
             width: 0, depth: 0 };
  }

  const { depth, card, edge, result, roster, terms } = {
    depth: snapshot.depth, card: snapshot.card, edge: snapshot.edge,
    result: snapshot.result, roster: snapshot.roster ?? [], terms: snapshot.terms ?? [],
  };

  // Parent resolution: the last node seen at depth-1. One array of the current spine, which
  // is what a DFS stack IS — so this reconstruction is the same shape as the thing it
  // reconstructs, and there is nothing to get subtly wrong.
  const spine = [];
  const nodes = [];
  let maxDepth = 0;
  for (let i = start; i < end; i++) {
    const d = depth[i];
    spine.length = d;                        // everything deeper is popped
    const parent = d > 0 ? (spine[d - 1] ?? -1) : -1;
    spine[d] = nodes.length;
    if (d > maxDepth) maxDepth = d;
    const c = card[i];
    nodes.push({
      index: nodes.length,
      node: i,                               // its position in the whole recording
      seq: snapshot.cutAt?.[i] ?? 0,          // for ordering against the cut leaves
      depth: d,
      parent,
      card: c,
      // The goal test carries no card; naming it is what stops the deepest row reading as a
      // mystery mark. It is the moment the search asks "is this arrangement acceptable".
      title: c >= 0 ? (roster[c]?.title ?? "") : null,
      goal: c < 0,
      term: edge[i],
      termLabel: edge[i] >= 0 ? `${terms[edge[i]]?.label ?? ""} ${terms[edge[i]]?.term ?? ""}`.trim() : "",
      result: result[i] ?? NODE.PENDING,
      dead: DEAD_SET.has(result[i]),
      solved: result[i] === NODE.SOLVED,
      children: [],
    });
  }
  // ── The cuts, as leaves on the node that tried them ───────────────
  //
  // In recorded order within each parent, so a level reads left to right as the search tried
  // it: `termPreference`'s ordering is a real decision and reordering the fringe would hide
  // which term it reached for first.
  //
  // Interleaved with the descended child by RECORDING position, not appended after it —
  // a term cut before the one that worked belongs to its left.
  const localOf = new Map(nodes.map(nd => [nd.node, nd.index]));
  const cutCause = snapshot.cutCause ?? [];
  const cutTerm = snapshot.cutTerm ?? [];
  for (const [p, ks] of byParent) {
    const parent = localOf.get(p);
    if (parent === undefined) continue;
    for (const k of ks) {
      nodes.push({
        index: nodes.length,
        node: -1,                            // not a node the engine counted
        seq: k + 0.5,
        depth: nodes[parent].depth + 1,
        parent,
        card: nodes[parent].card,
        title: nodes[parent].title,
        goal: false,
        cut: true,
        term: cutTerm[k],
        termLabel: cutTerm[k] >= 0
          ? `${terms[cutTerm[k]]?.label ?? ""} ${terms[cutTerm[k]]?.term ?? ""}`.trim() : "",
        cause: CAUSES[cutCause[k]] ?? null,
        result: NODE.PENDING,
        dead: true,
        solved: false,
        children: [],
      });
      if (nodes[nodes.length - 1].depth > maxDepth) maxDepth = nodes[nodes.length - 1].depth;
    }
  }
  for (const nd of nodes) if (nd.parent >= 0) nodes[nd.parent].children.push(nd.index);
  // ── Back into TRY order ───────────────────────────────────────────
  //
  // The cut leaves were appended after every node, so the child lists are in construction
  // order rather than in the order the search reached for each branch. The two streams are
  // ordered in themselves and not against each other, which is what `cutAt` exists for: a
  // node records how many cuts preceded it, so a cut with a smaller stream index was tried
  // first. `+0.5` on the cut breaks the tie in the only direction that can be right.
  for (const nd of nodes) {
    if (nd.children.length < 2) continue;
    nd.children.sort((a, b) => nodes[a].seq - nodes[b].seq);
  }

  // ── x is a LEAF COUNT, so siblings never overlap ─────────────────
  //
  // Laid out by counting leaves rather than by dividing the width per level: a level with
  // one node and a level with forty would otherwise be spaced identically, and the picture
  // would imply a uniform branching factor the search does not have.
  let cursor = 0;
  const place = (idx) => {
    const nd = nodes[idx];
    if (!nd.children.length) { nd.x = cursor++; return; }
    for (const c of nd.children) place(c);
    nd.x = (nodes[nd.children[0]].x + nodes[nd.children[nd.children.length - 1]].x) / 2;
  };
  for (const nd of nodes) if (nd.parent < 0) place(nd.index);

  return { nodes, attempt: ai, drawable: true, span, width: Math.max(1, cursor), depth: maxDepth };
}

/**
 * Which attempt to show by default.
 *
 * The one that SOLVED, because "how was this plan reached" is the question the panel is
 * open to answer. Failing that the longest, because for a refusal the interesting attempt
 * is the one that did the work.
 */
export function pickAttempt(snapshot) {
  const attempts = snapshot?.attempts ?? [];
  const total = snapshot?.depth?.length ?? 0;
  if (!attempts.length) return 0;
  const result = snapshot.result ?? [];
  for (let a = attempts.length - 1; a >= 0; a--) {
    const s = attempts[a].at;
    const e = attempts[a + 1]?.at ?? total;
    for (let i = s; i < e; i++) if (result[i] === NODE.SOLVED) return a;
  }
  let best = 0, bestSpan = -1;
  for (let a = 0; a < attempts.length; a++) {
    const span = (attempts[a + 1]?.at ?? total) - attempts[a].at;
    if (span > bestSpan) { bestSpan = span; best = a; }
  }
  return best;
}

/**
 * Every attempt with its size, so a reader can pick a different one.
 *
 * `drawable` counts the cut leaves too, because that is what decides whether the picture is
 * legible — see `DRAWABLE_MARKS`. Computed in one pass over the cut stream for all attempts
 * at once: doing it per attempt would re-scan 116,000 entries up to 44 times.
 */
export function attemptSizes(snapshot) {
  const attempts = snapshot?.attempts ?? [];
  const total = snapshot?.depth?.length ?? 0;
  const bounds = attempts.map((a, i) => [a.at, attempts[i + 1]?.at ?? total]);
  const cuts = new Array(attempts.length).fill(0);
  for (const p of snapshot?.cutNode ?? []) {
    // The attempts partition the node stream in order, so a linear scan of the bounds is a
    // few comparisons at 44 attempts and needs no index.
    for (let i = 0; i < bounds.length; i++) {
      if (p >= bounds[i][0] && p < bounds[i][1]) { cuts[i]++; break; }
    }
  }
  return attempts.map((a, i) => {
    const nodes = bounds[i][1] - bounds[i][0];
    return {
      index: i, tier: a.tier, rung: a.rung ?? null, gave: a.gave ?? null,
      restart: a.restart ?? 0,
      nodes, cuts: cuts[i],
      drawable: nodes <= DRAWABLE_NODES && nodes + cuts[i] <= DRAWABLE_MARKS,
    };
  });
}
