// ═══════════════════════════════════════════════════════════════════
// CHART · TRACE — the OUTPUT port, mirroring the input one
//
// `ports.js` is the contract for everything the engine needs to know and does not
// own. This is the contract for everything the engine LEARNS and does not keep: the
// order it considered cards in, the depth it reached at each node, and the named
// cause of every branch it cut. The engine emits to something it knows nothing about.
//
// ── Observation only, and that is a property to be TESTED ───────────
//
// A trace that changes a plan is a defect in the same class as a propagator that
// rewrites what it is asked to check. Two ways it could, and both are closed here:
//
//   MUTATION   the recorder is only ever handed numbers and strings it copies. It is
//              never handed a plan, a domain or a term, so there is nothing for it to
//              write through.
//   THE CLOCK  `placeCells` refuses when the wall clock runs out, so anything that
//              slows a node down can turn a plan into a refusal. This is the real
//              risk and it is why the hot path is COLUMNAR — see below.
//
// `chart-derivation-neutral.test.js` asserts the first over the corpus benchmark
// list: the same program, traced and untraced, must produce the identical plan.
//
// ── Why the per-node path is arrays and not events ──────────────────
//
// Measured, node counts are bimodal: p50 52, p90 17,144, max 20,176. So the common
// case is trivially cheap and the case that matters is twenty thousand nodes, where
// an object per node is twenty thousand allocations inside a loop whose own node
// costs 0.031 ms. That is affordable exactly once, in a browser, for one program —
// and NOT affordable in `verify-chart`, which generates 1,031 shapes in the monthly
// workflow.
//
// So the two populations of event get two representations, chosen by how many there
// are rather than by taste:
//
//   ~10 per run     stages, attempts, the card roster, the domains — plain objects,
//                   because there is nothing to optimise and they carry strings
//   ~20,000 per run one node — three writes into preallocated typed arrays
//
// A node therefore costs a bounds check and three stores, against a matching. The
// overhead is measured in `scripts/chart-bench.js --trace` and reported in
// `docs/chart-derivation-design.md`; if it ever stops being noise, the answer is to
// record less, never to let the clock decide a different plan.
//
// ── NULL_TRACE is the default, and it is free ───────────────────────
//
// Every call site is guarded (`if (trace)`), so a run with tracing off pays one
// truthiness check per branch. `NULL_TRACE` exists for the caller that wants a sink
// it can pass unconditionally, and is frozen so a bug cannot install state on it.
// ═══════════════════════════════════════════════════════════════════

// The vocabulary itself lives in `src/core/derivation/events.js`, which the reducers also
// read. Re-exported here so a caller inside the engine has one import for "the trace".
import {
  NODE, CAUSES, EXCLUSION, causeCode, CUT_POSITIONS_PER_ATTEMPT,
} from "../core/derivation/events.js";
export { NODE, CAUSES, EXCLUSION, causeCode, CAUSE_OTHER } from "../core/derivation/events.js";

/** A sink that forbids nothing, records nothing, and costs one property read. */
export const NULL_TRACE = Object.freeze({
  enabled: false,
  stage() {},
  cardOf() { return -1; },
  roster() {},
  domains() {},
  attempt() {},
  order() {},
  moves() {},
  node() { return -1; },
  result() {},
  branch() {},
  chosen() {},
  snapshot() { return null; },
});

/**
 * How many nodes to size the arrays for on the first allocation.
 *
 * 4,096, which covers 63% of programs outright (the measured distribution puts 57% at
 * ≤500 nodes and 63% at ≤2,000) and costs 28 KB. The saturated third grows to ~24,000
 * in three doublings, and a doubling is one `set` of a typed array — cheaper than the
 * matching a single node runs.
 */
const INITIAL_NODES = 4096;

/**
 * A recording sink.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxNodes] hard ceiling, so a caller that raises the node
 *   budget cannot make the trace unbounded. Truncation is RECORDED (`truncated`), not
 *   hidden: a profile that silently stops is a chart that lies about where the search
 *   ended.
 */
export function createTrace({ maxNodes = 200_000 } = {}) {
  let cap = INITIAL_NODES;
  let depth = new Int16Array(cap);
  let card = new Int16Array(cap);
  // The term the PARENT committed to reach this node — the label on the incoming edge, and
  // the one quantity a depth-and-card recording cannot recover. Without it a recorded run is
  // a list of levels; with it, it is the tree: level = card, branch = term.
  let edge = new Int8Array(cap);
  // How many cuts had been recorded when this node was created.
  //
  // The two streams are ordered in themselves and not against each other, so without this
  // there is no way to say whether a term was cut BEFORE or AFTER the one that worked — and
  // that ordering is `termPreference`'s output, which is a designed decision rather than an
  // accident. One comparison against this number puts a level's branches back in try order.
  let cutAt = new Int32Array(cap);
  let result = new Uint8Array(cap);
  let n = 0;
  let truncated = false;

  // ── The cut stream, sized separately ──────────────────────────────
  //
  // Measured, cuts outnumber nodes about nine to one: International Business records 13,019
  // nodes and 115,950 cuts. So they cannot share a capacity with the nodes, and `Int32` is
  // needed for the parent index because it points into a stream that can pass 32,767.
  let cutCap = INITIAL_NODES;
  let cutNode = new Int32Array(cutCap);
  let cutTerm = new Int8Array(cutCap);
  let cutCause = new Uint8Array(cutCap);
  let cuts = 0;
  let cutsTruncated = false;
  let cutsThisAttempt = 0;

  const stages = [];
  const attempts = [];
  let roster = [];
  let termLabels = [];
  // The shape's employment terms. Not part of the search's index space — see `roster`.
  let workTerms = [];
  let domainRows = [];
  let assignment = null;
  let moveLog = [];
  // How many whole pipelines have been recorded. See `roster()`: a retry resets the streams, and
  // this keeps the fact that an earlier pass existed.
  let passes = 1;
  // (card, cause) and (card, term) counters, sized once the roster is known. Flat
  // arrays rather than Maps: ~40 cards x 13 causes is 520 ints, and a Map lookup per
  // rejected branch is the one thing in here that would show up next to a matching.
  let causeCounts = null;
  let termTries = null;
  let termEnters = null;
  let nCards = 0;
  let nTerms = 0;
  // Cell id → roster index. The search reorders its cells every attempt and works on
  // COPIES of them, so a stable identity has to come from the id rather than from a
  // position — the same reason a concentration is resolved by title.
  const index = new Map();

  const grow = () => {
    const next = Math.min(maxNodes, cap * 2);
    if (next <= cap) { truncated = true; return false; }
    const d = new Int16Array(next); d.set(depth); depth = d;
    const c = new Int16Array(next); c.set(card); card = c;
    const e = new Int8Array(next); e.set(edge); edge = e;
    const k = new Int32Array(next); k.set(cutAt); cutAt = k;
    const r = new Uint8Array(next); r.set(result); result = r;
    cap = next;
    return true;
  };

  const growCuts = () => {
    // Ten times the node ceiling, because that is the measured ratio plus room. Truncation is
    // recorded, and it degrades the CAUSE POSITIONS only — the per-card counts are increments
    // into a fixed array and stay exact however many cuts there are, so the matrix that the
    // saturated population actually reads is never truncated.
    const next = Math.min(maxNodes * 10, cutCap * 2);
    if (next <= cutCap) { cutsTruncated = true; return false; }
    const a = new Int32Array(next); a.set(cutNode); cutNode = a;
    const b = new Int8Array(next); b.set(cutTerm); cutTerm = b;
    const c = new Uint8Array(next); c.set(cutCause); cutCause = c;
    cutCap = next;
    return true;
  };

  return {
    enabled: true,

    /**
     * A phase boundary — one of the seven the pipeline actually has.
     *
     * `detail` is copied as given and must be plain data: the panel renders it and the
     * engine must not be able to hand out a live reference to its own state.
     */
    stage(name, detail = {}) {
      stages.push({ name, at: n, ...detail });
    },

    /**
     * The cards, once, in the order everything else indexes by.
     *
     * This order is `plans` as built, NOT the search order — the search reorders per
     * attempt and each attempt records its own permutation. Keeping the roster stable
     * is what lets the narrowing matrix and the cause matrix share row identity.
     */
    roster(cards, terms, work = []) {
      // ── A second roster means a second PIPELINE, so the recording starts over ──
      //
      // `generatePlan` can run the whole thing twice: a refusal caused by breadth binding
      // re-derives the cells with the guidance off and searches again. That second pass has a
      // DIFFERENT CELL SET, so the id → index map is rebuilt — and every card index already in
      // the node stream then points at a different course.
      //
      // Measured on `network_science_phd`: the walkthrough put five courses in the wrong
      // semesters, silently and plausibly, because the spine was read with the new roster's
      // numbering against the old roster's nodes. Caught by the reconciliation invariant, not by
      // anything failing.
      //
      // Concatenating the two passes is not fixable by renumbering, because the first pass
      // describes cells that no longer exist. Resetting is both correct and the more honest
      // record: what survives is the pass that produced the answer, which is the only one the
      // reader's plan came from. `passes` keeps the fact that there was an earlier attempt.
      if (roster.length) {
        n = 0; cuts = 0; cutsThisAttempt = 0;
        truncated = false; cutsTruncated = false;
        // ── `retry` survives, because it is ABOUT the seam ────────────
        //
        // The reset wiped every stage, including the `retry` marker that `generatePlan` and
        // `withPackerRetry` push immediately BEFORE starting the second pass — so the marker
        // was destroyed by the very pass it announces, every time, and the spine could never
        // draw the seam it has a `note` kind for. `buildSpine`'s own comment says a retry "is
        // shown rather than folded away"; it never was.
        //
        // Safe to carry where the others are not: the reset exists because card indices are
        // rebuilt, and a stage holds no card index — the node stream, the attempts and the
        // domain rows do, and those still go. `retry` is the one stage that describes the
        // PIPELINE rather than the pass, so it is the one that should outlive a pass.
        const carried = stages.filter(s => s.name === "retry");
        stages.length = 0; attempts.length = 0;
        stages.push(...carried);
        domainRows = []; assignment = null; moveLog = [];
        passes += 1;
      }
      roster = cards.map(c => ({
        id: c.id, title: c.title ?? "", target: c.target ?? null,
        sh: c.sh ?? 0, kind: c.kind ?? null, geRole: c.geRole ?? null,
        subject: c.subject ?? null,
        // ── How this card READS, straight from `emit.cellText` ──────────
        //
        // `code` stood here — "the course this cell names, when it names exactly one" — and this
        // whitelist is where that limitation became invisible. The engine can compute the card's
        // real wording, but a field the recorder does not copy does not exist downstream, so the
        // view fell back to the requirement's title and drew "Computer Science Fundamental
        // Courses" beside a preview reading `CS 1800 and CS 1802`.
        //
        // Three fields, because the planner's card has three parts and the walkthrough draws the
        // planner's card: what it says, whether the plan decided it, and the course's own title
        // for the second line.
        text: c.text ?? null,
        named: !!c.named,
        // The individual courses a named cell resolves to, which the view draws as separate
        // cards exactly as the board does. Null for a reservation, which resolves to none.
        courses: c.courses ?? null,
        candidates: c.candidates ?? null,
      }));
      termLabels = terms.map(t => ({
        // `termLabel` is the shape's field name for the season, and reading `term` instead gave
        // every row the bare year — which is why the grid showed "Year 1" four times over.
        label: t.label ?? "", term: t.termLabel ?? t.term ?? "", weight: t.weight ?? 1,
        work: !!t.work, optional: !!t.optional,
        // ── What ties a term to a SEMESTER, and why the walkthrough needs it ──
        //
        // The shape is relative — "Year 1 Fall" — because a published plan is written for
        // whoever starts next. The planner is absolute: "Fall 2027". The derivation view draws
        // the reader's own grid, so it has to land each term on the semester the plan will
        // actually occupy, and these two fields are the whole join (`termSemesters` in
        // `core/derivation/steps.js`). Without them the walkthrough could only print the shape's
        // own words, which name a row the reader does not have.
        //
        // Free: ~14 terms per run, copied once in `roster()`, nowhere near the node path.
        semTypeId: t.semTypeId ?? "", yearIndex: t.yearIndex ?? null,
      }));
      // ── The WORK terms, which the search never sees ──────────────────
      //
      // `studyTerms` filters co-op terms out of the layout — there is nothing to place in a term
      // the student spends employed — so the term list above is study terms only, and every index
      // in the node stream is an index into IT. That is correct for the search and wrong for a
      // picture of the plan: the walkthrough drew a four-year degree with its two co-ops simply
      // missing, and a plan with no co-ops in it is a different plan.
      //
      // So they travel separately, never in `termLabels`. Appending them would renumber every
      // term index in the recording, which is the same class of bug as the second roster above.
      workTerms = (work ?? []).map(t => ({
        label: t.label ?? "", term: t.termLabel ?? t.term ?? "", weight: t.weight ?? 1,
        semTypeId: t.semTypeId ?? "", yearIndex: t.yearIndex ?? null,
      }));
      index.clear();
      roster.forEach((r, i) => index.set(r.id, i));
      nCards = roster.length;
      nTerms = termLabels.length;
      causeCounts = new Int32Array(nCards * CAUSES.length);
      termTries = new Int32Array(nCards * nTerms);
      termEnters = new Int32Array(nCards * nTerms);
    },

    /**
     * A cell id's stable row, or -1 for a cell the roster never saw.
     *
     * -1 rather than a throw, and rather than appending: a card the roster does not know
     * about means the pipeline handed the search a cell set the trace was not shown, and
     * the honest answer is to record nothing about it. Growing the roster mid-run would
     * silently renumber the matrices instead.
     */
    cardOf(id) {
      const i = index.get(id);
      return i === undefined ? -1 : i;
    },

    /** Per card: the terms that survived, and what removed each of the rest. */
    domains(rows) {
      domainRows = rows.map(r => ({
        id: r.id,
        legal: [...(r.legal ?? [])],
        excluded: (r.excluded ?? []).map(x => ({ term: x.term, reason: x.reason })),
      }));
    },

    /**
     * A new tree. One per restart and one per relaxation rung, because a rung is a
     * DIFFERENT CONSTRAINT SET and therefore not a continuation of the same search.
     */
    attempt(info) {
      attempts.push({ at: n, cutsAt: cuts, ...info, order: null, keys: null });
      cutsThisAttempt = 0;
    },

    /**
     * The `byConstraint` permutation this attempt is walking, as roster indices — and the KEYS
     * that produced it.
     *
     * ── Why the keys, and not just the order ────────────────────────
     *
     * "Why is the engine looking at this course now?" is the question the walkthrough could not
     * answer. It could say a course landed in Fall 2027 and why it did not fit the two terms
     * before; it could not say why THIS course was being placed at all, at this point, out of the
     * twenty still unplaced. The answer is entirely in this sort — the DFS takes the cards in this
     * order and nothing else decides it — so the honest way to explain a step is to show the sort
     * that chose it, with the numbers it sorted on.
     *
     * Recorded per attempt beside the order, because the two must agree: `preferenceFree` and
     * `sameReqMax` change what "most constrained" means, so a rung re-sorts and its keys change
     * with it. One list of keys for the run would be a caption from a different attempt.
     *
     * Cost is one small object per card per attempt — tens of them, next to a recording of
     * twenty thousand nodes — and it is written once per sort, never in the node path.
     *
     * @param {number[]} indices  roster indices, in the order the attempt walks
     * @param {object[]} [keys]   `{ filler, claim, terms, options, depth }` per entry, aligned
     */
    order(indices, keys = null) {
      if (!attempts.length) return;
      const a = attempts[attempts.length - 1];
      a.order = [...indices];
      a.keys = keys ? keys.map(k => ({ ...k })) : null;
    },

    /**
     * One node. Returns its index, which the caller hands back to `result`.
     *
     * `cardIndex` is -1 for the goal test at the bottom of the order, which is a node
     * the engine counts and is not a placement. `from` is -1 at the root.
     *
     * `Int8Array` for the edge, so a shape with more than 127 study terms would wrap. The
     * longest plan CHART builds is six years plus stretch — PharmD, at 24 — and
     * `MAX_EXTRA_TERMS` caps the stretch at 4, so the bound is not close. Asserted in the
     * unit suite rather than left to a comment.
     */
    node(d, cardIndex, from = -1) {
      if (n >= cap && !grow()) return -1;
      depth[n] = d;
      card[n] = cardIndex;
      edge[n] = from;
      cutAt[n] = cuts;
      result[n] = NODE.PENDING;
      return n++;
    },

    /** What ended that node. */
    result(index, code) {
      if (index >= 0 && index < n) result[index] = code;
    },

    /**
     * A branch cut, or taken.
     *
     * ── One call for both, and why the cuts need POSITIONS ────────────
     *
     * Counting matters because the interesting quantity is the RATIO: a (card, term) pair
     * tried forty times and entered twice is the shape of thrash, and recording only the
     * failures cannot show it.
     *
     * But the counts alone made the tree WRONG, and it took drawing one to notice. A node
     * exists only where the search descended, so a rejected term produced no node at all —
     * and the reconstructed tree of Architecture came out 36 levels deep and ONE wide, a
     * bare chain, while 21 branches had in fact been cut. That picture says "the engine
     * considered exactly one option per card", which is false and is the opposite of what a
     * search tree is for.
     *
     * So a cut is also recorded POSITIONALLY, against the node that was trying it, in its
     * own three columns. The node columns still hold nodes only, so `recorded === nodes`
     * stays an equality against a real engine quantity, and the cuts hang off them.
     */
    branch(node, cardIndex, term, cause, entered = false) {
      if (!causeCounts || cardIndex < 0 || cardIndex >= nCards) return;
      if (term >= 0 && term < nTerms) {
        termTries[cardIndex * nTerms + term] += 1;
        if (entered) termEnters[cardIndex * nTerms + term] += 1;
      }
      if (entered) return;
      // Counted always. This is the array the saturated population's cause matrix reads, it
      // is one increment, and capping it would be capping the answer.
      causeCounts[cardIndex * CAUSES.length + cause] += 1;
      // Positioned only while this attempt could still be drawn. See
      // `CUT_POSITIONS_PER_ATTEMPT`.
      if (++cutsThisAttempt > CUT_POSITIONS_PER_ATTEMPT) return;
      if (cuts >= cutCap && !growCuts()) return;
      cutNode[cuts] = node;
      cutTerm[cuts] = term;
      cutCause[cuts] = cause;
      cuts++;
    },

    /**
     * Phase 2's net moves, in order, each attributed to the pass that made it.
     *
     * Plain objects because there are at most a couple of dozen — the measured maximum over
     * the corpus is 18 — so nothing here needs the columnar treatment the node stream gets.
     */
    moves(list) {
      moveLog = list.map(m => ({ pass: m.pass, card: m.card, from: m.from, to: m.to }));
    },

    /** The answer, as roster index → term. */
    chosen(pairs) {
      assignment = pairs.map(([i, ti]) => [i, ti]);
    },

    /**
     * Everything recorded, as plain data.
     *
     * The typed arrays are sliced, not handed out: the recorder may still be running
     * (the panel can be opened while a second generate is in flight) and a view into a
     * live buffer would show the wrong plan's search halfway through.
     */
    snapshot() {
      return {
        version: 1,
        passes,
        truncated,
        cutsTruncated,
        nodes: n,
        cuts,
        cutNode: Array.from(cutNode.subarray(0, cuts)),
        cutTerm: Array.from(cutTerm.subarray(0, cuts)),
        cutCause: Array.from(cutCause.subarray(0, cuts)),
        // Sliced to `n`: the tail of the last doubling is zeros and would render as a
        // run of depth-0 nodes the search never visited.
        depth: Array.from(depth.subarray(0, n)),
        card: Array.from(card.subarray(0, n)),
        edge: Array.from(edge.subarray(0, n)),
        cutAt: Array.from(cutAt.subarray(0, n)),
        result: Array.from(result.subarray(0, n)),
        stages: stages.map(s => ({ ...s })),
        attempts: attempts.map(a => ({ ...a, order: a.order ? [...a.order] : null })),
        roster: roster.map(r => ({ ...r })),
        terms: termLabels.map(t => ({ ...t })),
        workTerms: workTerms.map(t => ({ ...t })),
        domainRows: domainRows.map(r => ({
          id: r.id, legal: [...r.legal], excluded: r.excluded.map(x => ({ ...x })),
        })),
        assignment: assignment ? assignment.map(p => [...p]) : null,
        moveLog: moveLog.map(m => ({ ...m })),
        causeCounts: causeCounts ? Array.from(causeCounts) : [],
        termTries: termTries ? Array.from(termTries) : [],
        termEnters: termEnters ? Array.from(termEnters) : [],
        nCards, nTerms, causes: [...CAUSES],
      };
    },
  };
}
