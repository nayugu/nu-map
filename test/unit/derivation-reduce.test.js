// ═══════════════════════════════════════════════════════════════════
// THE DERIVATION REDUCERS, ATTACKED.
//
// These run against SYNTHETIC recordings, which is the point: the corpus can produce a 13,000
// node search over 32 cards and it cannot produce a snapshot with a negative depth, a card
// index past the roster, an assignment naming a card that does not exist, or 40,000 nodes in
// 719 buckets. Every one of those is reachable in the browser — a snapshot crosses a module
// boundary as plain data — and each would render as a picture rather than as an error.
//
// The confirming tests are omitted deliberately. "A 5-node profile has 5 buckets" is arithmetic
// restated; what pays here is the envelope property, the fate totality, and the junk inputs.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTrace, NULL_TRACE } from "../../src/engine/trace.js";
import {
  NODE, CAUSES, EXCLUSION, FATE, causeCode, CAUSE_OTHER, EXCLUSION_PRIORITY,
  CUT_POSITIONS_PER_ATTEMPT,
} from "../../src/core/derivation/events.js";
import { searchProfile, attemptMarks, solvedAt, PROFILE_BUCKETS } from "../../src/core/derivation/profile.js";
import { causeMatrix, causeTotals, firstOrder } from "../../src/core/derivation/causes.js";
import { narrowingMatrix, inSearchOrder } from "../../src/core/derivation/narrowing.js";
import { searchTree, attemptSizes, pickAttempt, DRAWABLE_MARKS } from "../../src/core/derivation/tree.js";
import { deriveModel } from "../../src/core/derivation/reduce.js";
import { FATE_GROUP, FATE_LEGEND, fateStyle, rampAlpha } from "../../src/ui/derivation/palette.js";

/**
 * A recording built by hand, so a test can state exactly what the search did.
 *
 * `depths` is the DFS pre-order; `results` the outcome of each. Everything else is derived, so
 * a test says only what it is about.
 */
function fake({ cards = 3, terms = 4, depths = [0, 1, 2, 3], results = null,
                cuts = [], assignment = null, attempts = [{ tier: "strict", restart: 0 }],
                excluded = null } = {}) {
  const t = createTrace();
  t.roster(
    Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, title: `Card ${i}`, sh: 4 })),
    Array.from({ length: terms }, (_, i) => ({ label: `Year ${i}`, term: "Fall" })));
  t.domains(Array.from({ length: cards }, (_, i) => ({
    id: `c${i}`,
    legal: excluded ? [...Array(terms).keys()].filter(x => !excluded[i]?.some(e => e.term === x))
                    : [...Array(terms).keys()],
    excluded: excluded?.[i] ?? [],
  })));
  for (const a of attempts) t.attempt(a);
  t.order([...Array(cards).keys()]);
  const idx = [];
  depths.forEach((d, k) => {
    const ci = d < cards ? d : -1;
    const n = t.node(d, ci, k === 0 ? -1 : 0);
    idx.push(n);
    t.result(n, results ? results[k] : NODE.PENDING);
    for (const c of cuts.filter(x => x.at === k)) t.branch(n, c.card ?? ci, c.term, c.cause ?? 0);
  });
  if (assignment) t.chosen(assignment);
  return t.snapshot();
}

// ── The envelope, which is the one thing the downsample must not lose ──

test("the downsample keeps the extremes of every bucket, never their average", () => {
  // A sawtooth: deep, floor, deep, floor. Its MEAN depth is flat, which is exactly the picture
  // that must not be drawn — averaging turns thrash into a smooth line and erases the content.
  const n = PROFILE_BUCKETS * 4;
  const depths = Array.from({ length: n }, (_, i) => (i % 2 ? 0 : 30));
  const snap = fake({ cards: 31, depths });
  const p = searchProfile(snap);
  assert.equal(p.exact, false);
  assert.ok(p.buckets.length <= PROFILE_BUCKETS + 1);
  // Every bucket spans the full range, because every bucket contains both extremes.
  for (const b of p.buckets) {
    assert.equal(b.lo, 0, "a bucket lost its floor");
    assert.equal(b.hi, 30, "a bucket lost its peak");
  }
  // And the global max survives, which a mean would have reported as 15.
  assert.equal(Math.max(...p.buckets.map(b => b.hi)), 30);
});

test("one deep spike in a flat run survives the downsample", () => {
  // The hostile case for a min/max bucket is a SINGLE outlier among thousands: if the bucketing
  // sampled instead of scanning, the one node that reached depth 39 would be dropped, and the
  // chart would say the search never got past 1. That is the difference between "it nearly had
  // it" and "it never came close".
  const depths = Array.from({ length: 20000 }, () => 1);
  depths[13777] = 39;
  const p = searchProfile(fake({ cards: 40, depths }));
  assert.equal(Math.max(...p.buckets.map(b => b.hi)), 39);
});

test("the profile's ceiling is the card count, not the deepest node reached", () => {
  // A search that got two thirds of the way must not be drawn touching the top. Scaling to the
  // observed maximum would make every refusal look like a success.
  const p = searchProfile(fake({ cards: 30, depths: [0, 1, 2, 3, 4] }));
  assert.equal(p.cards, 30);
  assert.equal(p.maxDepth, 4);
});

// ── Junk that a module boundary can deliver ────────────────────────

test("the reducers survive an empty, absent or malformed snapshot", () => {
  for (const junk of [null, undefined, {}, { roster: [] }, { depth: [], roster: [{ id: "x" }] },
                      { roster: [{ id: "a", title: "A" }], depth: null, result: undefined }]) {
    assert.doesNotThrow(() => searchProfile(junk));
    assert.doesNotThrow(() => causeMatrix(junk));
    assert.doesNotThrow(() => narrowingMatrix(junk));
    assert.doesNotThrow(() => searchTree(junk));
    assert.doesNotThrow(() => attemptSizes(junk));
    assert.doesNotThrow(() => solvedAt(junk));
    assert.doesNotThrow(() => firstOrder(junk));
  }
  // `deriveModel` returns null for a snapshot with no roster rather than an empty model, so a
  // caller renders the absence instead of a chart claiming a search happened.
  assert.equal(deriveModel(null), null);
  assert.equal(deriveModel({}), null);
  assert.equal(deriveModel({ roster: [] }), null);
});

test("a card index past the roster is ignored rather than trusted", () => {
  const t = createTrace();
  t.roster([{ id: "a", title: "A" }], [{ label: "Y1", term: "Fall" }]);
  // Out of range in both directions, plus a term index that does not exist.
  t.branch(0, 5, 0, 0);
  t.branch(0, -3, 0, 0);
  t.branch(0, 0, 99, 0);
  const snap = t.snapshot();
  assert.equal(snap.causeCounts.length, CAUSES.length);       // one card
  // The out-of-range card wrote nothing; the out-of-range TERM still counted its cause, because
  // the cause is a property of the card and not of the term.
  assert.equal(snap.causeCounts.reduce((a, b) => a + b, 0), 1);
  assert.doesNotThrow(() => narrowingMatrix(snap));
});

test("an assignment naming a card the roster does not have does not shift the matrix", () => {
  // The failure this excludes: `chosen` landing on the wrong ROW. An index-keyed assignment plus
  // a stale roster is exactly how a matrix ends up marking the wrong card as taken, and it would
  // look completely plausible.
  const snap = fake({ cards: 2, terms: 3, assignment: [[0, 1], [7, 2]] });
  const m = narrowingMatrix(snap);
  assert.equal(m.rows[0].at, 1);
  assert.equal(m.rows[0].cells[1].fate, FATE.CHOSEN);
  assert.equal(m.rows[1].at, null);
  assert.ok(m.rows[1].cells.every(c => c.fate !== FATE.CHOSEN));
});

// ── Fate resolution ────────────────────────────────────────────────

test("a term excluded twice reports the reason that bound FIRST", () => {
  // Stated once in `EXCLUSION_PRIORITY` rather than falling out of push order. A card whose
  // prerequisites are not done by term 1 is not "not offered in term 1" — the season question
  // was never reached, and reporting it would send a reader to the catalog over a chain.
  const snap = fake({
    cards: 1, terms: 3,
    excluded: [[
      { term: 1, reason: EXCLUSION.NOT_OFFERED },
      { term: 1, reason: EXCLUSION.BEFORE_PREREQS },
      { term: 2, reason: EXCLUSION.LEARNED },
      { term: 2, reason: EXCLUSION.PRECEDENCE_WINDOW },
    ]],
  });
  const m = narrowingMatrix(snap);
  assert.equal(m.rows[0].cells[1].fate, EXCLUSION.BEFORE_PREREQS);
  assert.equal(m.rows[0].cells[2].fate, EXCLUSION.PRECEDENCE_WINDOW);
});

test("every fate has a display group, and every group a legend entry", () => {
  // The failure mode without this: an unmapped fate falls to the default and renders as the
  // "legal" ground — so a term the card cannot use would be drawn as one it could.
  for (const f of Object.values(FATE)) {
    assert.ok(FATE_GROUP[f], `fate ${f} has no display group`);
  }
  const groups = new Set(FATE_LEGEND.map(([g]) => g));
  for (const g of Object.values(FATE_GROUP)) {
    assert.ok(groups.has(g), `group ${g} is drawn and never explained in the legend`);
  }
  // And each group resolves to a style with something to paint.
  for (const [g] of FATE_LEGEND) {
    for (const mode of ["light", "dark"]) {
      assert.ok(fateStyle(g, mode).fill, `${g}/${mode} has no fill`);
    }
  }
});

test("the whole grid is accounted for whatever the exclusions say", () => {
  // Over every width and every subset of reasons: the counts must sum to cards x terms. A single
  // unhandled combination shows up as a blank cell, which reads as "not offered" and is a claim
  // about the catalog we did not make.
  for (let cards = 1; cards <= 6; cards++) {
    for (let terms = 1; terms <= 8; terms++) {
      const reasons = Object.values(EXCLUSION);
      const excluded = Array.from({ length: cards }, (_, i) =>
        Array.from({ length: terms }, (_, tt) => ({
          term: tt, reason: reasons[(i + tt) % reasons.length],
        })).filter((_, tt) => (i + tt) % 3 !== 0));
      const snap = fake({ cards, terms, excluded, assignment: [[0, 0]] });
      const m = narrowingMatrix(snap);
      const sum = Object.values(m.counts).reduce((a, b) => a + b, 0);
      assert.equal(sum, cards * terms, `${cards}x${terms}`);
    }
  }
});

// ── Causes ─────────────────────────────────────────────────────────

test("an unknown cause lands in `other`, never in bucket zero", () => {
  // Bucket 0 is `term-at-credit-cap`. A cause nobody added to the enumeration silently
  // attributed to the credit cap is worse than an honest "another reason": the first is a
  // specific false claim, the second is an admission.
  assert.equal(causeCode("a-cause-invented-next-year"), CAUSE_OTHER);
  assert.equal(causeCode(undefined), CAUSE_OTHER);
  assert.equal(causeCode(null), CAUSE_OTHER);
  assert.notEqual(CAUSE_OTHER, 0);
  // And every enumerated cause round-trips.
  CAUSES.forEach((c, i) => assert.equal(causeCode(c), i));
});

test("cause rows are ordered by count and carry their position in the search order", () => {
  const snap = fake({
    cards: 3, terms: 4, depths: [0, 1, 2],
    cuts: [{ at: 0, card: 0, term: 1, cause: 0 }, { at: 0, card: 0, term: 2, cause: 0 },
           { at: 1, card: 1, term: 0, cause: 3 }],
  });
  const m = causeMatrix(snap);
  assert.equal(m.rows[0].id, "c0");
  assert.equal(m.rows[0].total, 2);
  assert.equal(m.total, 3);
  // The confound is exposed, not hidden: depth is where the card sat in the order.
  assert.equal(m.rows[0].depth, 0);
  // Only the causes that fired get a column.
  assert.deepEqual(m.usedCauses, [0, 3]);
  assert.equal(causeTotals(m)[0].count, 2);
});

test("the ramp is monotone and never paints a zero", () => {
  // A magnitude encoding needs exactly one property, and a sqrt is easy to get wrong at the
  // ends: 0 must be invisible (there is no small count, there is no count) and the maximum must
  // be the darkest.
  assert.equal(rampAlpha(0, 100), 0);
  assert.equal(rampAlpha(5, 0), 0);
  assert.equal(rampAlpha(-1, 10), 0);
  let last = -1;
  for (let v = 1; v <= 100; v++) {
    const a = rampAlpha(v, 100);
    assert.ok(a > last, `not monotone at ${v}`);
    assert.ok(a > 0 && a <= 0.9, `out of band at ${v}: ${a}`);
    last = a;
  }
});

// ── The tree ───────────────────────────────────────────────────────

test("the tree refuses to draw what it cannot draw, and says how big it was", () => {
  const snap = fake({ cards: 40, depths: Array.from({ length: 5000 }, (_, i) => i % 40) });
  const tree = searchTree(snap);
  assert.equal(tree.drawable, false);
  assert.equal(tree.span, 5000);
  assert.deepEqual(tree.nodes, []);
});

test("too many CUT LEAVES also makes a tree undrawable, even with few nodes", () => {
  // The bound the node count alone would let through: cuts outnumber nodes about nine to one and
  // the ratio varies a lot, so 300 nodes can carry 8,000 leaves. That is a wall, not a picture.
  const cuts = [];
  for (let k = 0; k < DRAWABLE_MARKS + 50; k++) cuts.push({ at: 1, term: 0, cause: 0 });
  const snap = fake({ cards: 4, terms: 4, depths: [0, 1, 2, 3], cuts });
  assert.equal(searchTree(snap).drawable, false);
});

test("the trace stops keeping cut POSITIONS before a drawable attempt could lose one", () => {
  // The invariant `tree.js` throws on at load: `DRAWABLE_MARKS <= CUT_POSITIONS_PER_ATTEMPT`.
  // Restated as a test because a wrong pair of numbers draws a tree with leaves missing, which
  // is a plausible picture rather than an error.
  assert.ok(DRAWABLE_MARKS <= CUT_POSITIONS_PER_ATTEMPT);
  const t = createTrace();
  t.roster([{ id: "a", title: "A" }], [{ label: "Y1", term: "Fall" }]);
  t.attempt({ tier: "strict", restart: 0 });
  const n = t.node(0, 0, -1);
  for (let k = 0; k < CUT_POSITIONS_PER_ATTEMPT + 500; k++) t.branch(n, 0, 0, 0);
  const snap = t.snapshot();
  assert.equal(snap.cuts, CUT_POSITIONS_PER_ATTEMPT);
  // The COUNTS are uncapped, because that is what the saturated view is built from.
  assert.equal(snap.causeCounts[0], CUT_POSITIONS_PER_ATTEMPT + 500);
  // A fresh attempt gets a fresh allowance: the interesting tree is often not the first.
  t.attempt({ tier: "rung", rung: 0, gave: "term-width" });
  const n2 = t.node(0, 0, -1);
  t.branch(n2, 0, 0, 0);
  assert.equal(t.snapshot().cuts, CUT_POSITIONS_PER_ATTEMPT + 1);
});

test("the default attempt is the one that solved, not the last or the biggest", () => {
  const t = createTrace();
  t.roster([{ id: "a", title: "A" }, { id: "b", title: "B" }],
           [{ label: "Y1", term: "Fall" }]);
  // Attempt 0: long and failed. Attempt 1: two nodes and solved.
  t.attempt({ tier: "strict", restart: 0 });
  for (let k = 0; k < 50; k++) t.result(t.node(k % 2, k % 2, 0), NODE.EXHAUSTED);
  t.attempt({ tier: "rung", rung: 0, gave: "term-width" });
  t.result(t.node(0, 0, -1), NODE.SOLVED);
  t.result(t.node(1, 1, 0), NODE.SOLVED);
  const snap = t.snapshot();
  assert.equal(pickAttempt(snap), 1);
  // And `solvedAt` returns the DEEPEST solved node, since every node on the winning spine is
  // marked solved and the root would point at the start of the search.
  assert.equal(snap.depth[solvedAt(snap)], 1);
});

test("attempt marks stay inside the bucket range after downsampling", () => {
  // An off-by-one here draws a rung boundary past the right edge of the plot, or at x=0 for a
  // rung that started two thirds of the way through.
  const t = createTrace();
  t.roster(Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `C${i}` })),
           [{ label: "Y1", term: "Fall" }]);
  for (let a = 0; a < 4; a++) {
    t.attempt({ tier: a ? "rung" : "strict", rung: a - 1, restart: 0 });
    for (let k = 0; k < 900; k++) t.node(k % 5, k % 5, 0);
  }
  const snap = t.snapshot();
  const p = searchProfile(snap);
  const marks = attemptMarks(snap, p);
  assert.equal(marks.length, 4);
  for (const m of marks) {
    assert.ok(m.x >= 0 && m.x < p.buckets.length, `mark at ${m.x} of ${p.buckets.length}`);
    assert.ok(m.nodes > 0, "an attempt with no nodes");
  }
  // The marks are in order, and their node counts sum to the recording.
  assert.deepEqual([...marks].sort((a, b) => a.at - b.at).map(m => m.index), [0, 1, 2, 3]);
  assert.equal(marks.reduce((n, m) => n + m.nodes, 0), snap.nodes);
});

test("NULL_TRACE answers every call the engine makes, and stays frozen", () => {
  // The engine calls these unguarded in a few places by design. A missing member would be a
  // TypeError inside the search — a crash where a plan was expected.
  const live = createTrace();
  for (const k of Object.keys(live)) {
    if (k === "enabled") continue;
    assert.equal(typeof NULL_TRACE[k], "function", `NULL_TRACE is missing ${k}`);
  }
  assert.equal(NULL_TRACE.node(0, 0, 0), -1);
  assert.equal(NULL_TRACE.snapshot(), null);
  assert.equal(NULL_TRACE.cardOf("anything"), -1);
  assert.throws(() => { NULL_TRACE.spy = 1; }, TypeError);
});

test("a cell the roster never saw resolves to -1 rather than growing the roster", () => {
  // Growing it mid-run would renumber every matrix silently. -1 records nothing about that cell,
  // which is the honest answer to "the pipeline handed the search cells the trace was not shown".
  const t = createTrace();
  t.roster([{ id: "known", title: "K" }], [{ label: "Y1", term: "Fall" }]);
  assert.equal(t.cardOf("known"), 0);
  assert.equal(t.cardOf("unknown"), -1);
  assert.equal(t.snapshot().roster.length, 1);
});

test("the stage spine marks at most one stage as the one that answered", () => {
  const t = createTrace();
  t.roster([{ id: "a", title: "A" }], [{ label: "Y1", term: "Fall" }]);
  t.domains([{ id: "a", legal: [0], excluded: [] }]);
  t.stage("demand-done", { cells: 1, sh: 4 });
  t.stage("narrowing-done", { cards: 1, terms: 1, legalPairs: 1 });
  t.attempt({ tier: "strict", restart: 0 });
  t.result(t.node(0, 0, -1), NODE.SOLVED);
  t.attempt({ tier: "rung", rung: 0, gave: "term-width" });
  t.node(0, 0, -1);
  t.stage("search-done", { nodes: 2, restarts: 0, relaxed: [] });
  t.stage("improve-done", { moves: 1 });
  t.chosen([[0, 0]]);
  const m = deriveModel(t.snapshot());
  assert.equal(m.stages.filter(s => s.answered).length, 1);
  assert.equal(m.stages.find(s => s.answered).key, "strict");
  assert.equal(m.summary.moves, 1);
});

test("the term index fits the column the trace stores it in", () => {
  // `edge` and `cutTerm` are Int8Array, so a shape with more than 127 study terms would wrap and
  // draw branches to the wrong terms. The longest plan CHART builds is PharmD at 24 terms plus
  // `MAX_EXTRA_TERMS` of stretch, so the bound is not close — asserted rather than trusted,
  // because the failure is silent and looks like a plausible tree.
  const t = createTrace();
  t.roster([{ id: "a", title: "A" }],
           Array.from({ length: 40 }, (_, i) => ({ label: `Y${i}`, term: "Fall" })));
  const n = t.node(0, 0, 39);
  t.branch(n, 0, 39, 0);
  const snap = t.snapshot();
  assert.equal(snap.edge[0], 39);
  assert.equal(snap.cutTerm[0], 39);
  assert.ok(snap.nTerms <= 127, "a shape wider than Int8Array can hold");
});

test("rows in search order follow the order, and unknown cards fall to the end", () => {
  const snap = fake({ cards: 4, terms: 2 });
  const m = narrowingMatrix(snap);
  const rows = inSearchOrder(m, [2, 0, 3]);          // card 1 missing from the order
  assert.deepEqual(rows.map(r => r.card), [2, 0, 3, 1]);
});
