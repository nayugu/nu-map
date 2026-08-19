// ═══════════════════════════════════════════════════════════════════
// RECORDING THE SEARCH MUST NOT CHANGE THE SEARCH.
//
// The derivation view is worth nothing if the act of watching moves the answer. This is the
// same class of claim `chart-propagator-neutral.test.js` makes about a pruning propagator, one
// notch stronger: a propagator is ALLOWED to change which rung answers, because it spends
// fewer nodes. A trace is allowed to change nothing at all.
//
// ── The two ways a sink could break it ──────────────────────────────
//
//   MUTATION   the recorder is handed numbers and strings and copies them. It is never handed
//              a plan, a domain or a term object, so there is nothing to write through. Cheap
//              to argue and worth testing anyway, because `roster()` and `domains()` DO receive
//              engine objects and a `push` instead of a spread would be invisible in review.
//   THE CLOCK  `placeCells` refuses when the wall clock runs out. So anything that slows a node
//              down can turn a plan into a refusal — a genuine behavioural change, arrived at
//              without touching a single decision. This is the real risk, and it is why the
//              clock is FROZEN below: the invariant under test is about traversal, and with a
//              live clock a failure here would be indistinguishable from scheduler noise.
//              The overhead itself is measured separately, by `chart-probe --trace`, which runs
//              against the real clock and is the right instrument for that question.
//
// Frozen-clock neutrality plus a measured overhead inside run-to-run noise is the strongest
// pair of statements available: the first says the sink cannot change an answer, the second
// says it is not close to being able to via the one route the first excludes.
//
// ── What is compared ────────────────────────────────────────────────
//
// The EMITTED DOCUMENT, not the report. Two runs can agree on every statistic and put a course
// in a different term — the report carries counts, and a count is exactly the thing that
// survives a re-sequencing. A refusal is compared as its reason and detail, for the same
// reason: "refused" is not one outcome.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan, createTrace } from "../../src/engine/index.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
import { deriveModel } from "../../src/core/derivation/reduce.js";
import { searchTree } from "../../src/core/derivation/tree.js";
import { narrowingMatrix } from "../../src/core/derivation/narrowing.js";
import { buildSteps, frameAt, frameCount, frameLoad } from "../../src/core/derivation/steps.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);

const ORDER_FILE = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(ORDER_FILE)
  ? JSON.parse(readFileSync(ORDER_FILE, "utf8")) : { edges: [], coopPrep: [] };

function degreePrograms() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const key of readdirSync(cd)) {
        const rf = join(cd, key, "requirements.json");
        if (!existsSync(rf)) continue;
        const data = JSON.parse(readFileSync(rf, "utf8"));
        if (!(data.requirementSections ?? []).length) continue;
        if (!(data.totalCreditsRequired > 0)) continue;
        const pf = join(cd, key, "plan.json");
        out.push({ lvl, key, data,
                   plan: existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null });
      }
    }
  }
  return out;
}

/** Seeded shuffle: the corpus is ordered by college and the alphabetical head is atypical. */
function sample(list, n) {
  let seed = 0x5eed11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const N = process.env.CHART_CORPUS === "all" ? Infinity : 24;
const PROGRAMS = sample(degreePrograms(), N);

const generate = (p, variant, trace) => generatePlan({
  program: p.data, publishedPlan: variant, courseMap, ports, depthIndex,
  observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
  studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
  timeBudgetMs: 1200, trace,
  // See the header: frozen, so the invariant is about traversal rather than about the machine.
  now: () => 0,
});

/** The plan as a student sees it. Same canonicalisation as the propagator-neutral suite. */
const canonical = (out) => {
  if (out.refused) return `REFUSED ${out.refused.reason} :: ${out.refused.detail ?? ""}`;
  const plan = out.plan?.plans?.[0];
  const lines = [];
  for (const y of plan?.years ?? []) {
    for (const t of y.terms ?? []) {
      const walk = (es, d) => {
        for (const e of es ?? []) {
          lines.push(`${"  ".repeat(d)}${e.coop ? "COOP" : e.vacation ? "VAC" : "CELL"} `
            + `${e.text ?? ""} [${e.sh ?? 0}] `
            + `{${(e.options ?? []).map(g => [...g].sort().join("+")).sort().join("/")}}`);
          walk(e.children, d + 1);
        }
      };
      lines.push(`== ${y.label ?? ""} / ${t.term ?? ""}`);
      walk(t.entries, 0);
    }
  }
  return lines.join("\n");
};

test("recording the search does not change the plan", () => {
  const differ = [];
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const plain = generate(p, variant, null);
      const traced = generate(p, variant, createTrace());
      if (canonical(plain) !== canonical(traced)) {
        differ.push(`${p.lvl}/${p.key}#${vi}`);
      }
    });
  }
  assert.deepEqual(differ, [],
    `tracing changed the outcome for ${differ.length} shape(s): ${differ.slice(0, 5).join(", ")}`);
});

test("every node the engine counted appears in the recording", () => {
  // ── Why this is worth its own test ──────────────────────────────────
  //
  // Because the first version of the instrumentation was off by a handful, and a handful is the
  // worst size of error: the profile still drew, still looked like a search, and simply ended a
  // few nodes before the search did. The gap came from recording AFTER the budget check, so the
  // node that exceeds the budget was counted by the engine and never recorded — one per attempt
  // that ran out, four on International Business.
  //
  // ── And why it is not a plain equality, which is what it caught next ──
  //
  // Written as `recorded === report.nodes` it failed on a dozen shapes at exactly DOUBLE, plus
  // several at "engine 0, recorded 17". Both are the test being wrong, and instructively so:
  //
  //   double        `generatePlan` can run the whole pipeline TWICE — the ladder's plan refused
  //                 by the hard criteria falls through to the packer, and a breadth-bound refusal
  //                 re-derives without guidance. `report.nodes` is the surviving run's; the
  //                 recording holds both, which is the honest thing for it to do.
  //   engine 0      a pre-flight or `mostly-unschedulable` refusal carries no node count at all,
  //                 so the "engine" side was reading an absent field as zero.
  //
  // So the invariant is stated at the strength it has: the recording accounts for every node,
  // the attempts partition it exactly, and where there was a single search the two numbers agree.
  const bad = [];
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const trace = createTrace();
      const out = generate(p, variant, trace);
      const snap = trace.snapshot();
      if (snap.truncated) return;                    // truncation is declared, not a defect
      const label = `${p.lvl}/${p.key}#${vi}`;

      // 1. The attempts partition the node stream: no node belongs to none of them, and none is
      //    claimed twice. A boundary recorded at the wrong offset would put a rung's nodes under
      //    the previous rung's name, which is the kind of error the pictures cannot show.
      const model = deriveModel(snap);
      if (model) {
        const summed = model.attempts.reduce((n, a) => n + a.nodes, 0);
        if (model.attempts.length && summed !== snap.nodes) {
          bad.push(`${label}: attempts sum to ${summed}, recorded ${snap.nodes}`);
        }
      }

      // 2. The recording agrees with the pass it is a recording OF.
      //
      // Not with `report.nodes`, and that distinction took two goes to get right. A generate can
      // run the pipeline twice — a criteria refusal falls through to the packer, a breadth-bound
      // refusal re-derives without guidance — and the recording RESETS on each pass, because the
      // cell set changes underneath it and the old card indices would point at courses that no
      // longer exist. So `report.nodes` can belong to a pass the recording no longer holds.
      //
      // The `search-done` stage carries the node count of the recorded pass, and that is the
      // number the recording can honestly be held to.
      const searchDone = (snap.stages ?? []).find(x => x.name === "search-done");
      if (searchDone && snap.nodes !== searchDone.nodes) {
        bad.push(`${label}: that pass spent ${searchDone.nodes}, recorded ${snap.nodes}`);
      }
    });
  }
  assert.deepEqual(bad, [], bad.slice(0, 5).join(" | "));
});

test("every card-term pair gets exactly one fate", () => {
  // A fate that fell through every branch would render as "not offered that season", which is a
  // false claim about the catalog rather than a blank cell. So the counts must sum to the whole
  // grid, on every shape.
  for (const p of PROGRAMS.slice(0, 12)) {
    const variant = p.plan?.plans?.[0] ?? null;
    const trace = createTrace();
    generate(p, variant, trace);
    const snap = trace.snapshot();
    if (!snap.roster.length) continue;
    const m = narrowingMatrix(snap);
    const sum = Object.values(m.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, m.rows.length * m.terms.length,
      `${p.key}: ${sum} fates for ${m.rows.length}x${m.terms.length} pairs`);
    // And a card that was PLACED must have its term marked chosen — the one cell in the whole
    // matrix a reader will look for first.
    for (const r of m.rows) {
      if (r.at == null) continue;
      assert.equal(r.cells[r.at].fate, "chosen", `${p.key}: ${r.id} at term ${r.at}`);
    }
  }
});

test("the reconstructed tree is a tree, and it is the recorded one", () => {
  // The reconstruction rests on the recording being a DFS pre-order — a node's parent is the
  // most recent earlier node one level shallower. If that assumption is ever false the result is
  // not an error, it is a plausible tree that is not the search's, so it is checked structurally.
  for (const p of PROGRAMS.slice(0, 12)) {
    const variant = p.plan?.plans?.[0] ?? null;
    const trace = createTrace();
    generate(p, variant, trace);
    const snap = trace.snapshot();
    if (!snap.nodes) continue;
    const model = deriveModel(snap);
    if (!model) continue;
    for (const a of model.attempts) {
      if (!a.drawable) continue;
      const tree = searchTree(snap, a.index);
      if (!tree.drawable) continue;
      let roots = 0;
      for (const nd of tree.nodes) {
        if (nd.parent < 0) { roots++; assert.equal(nd.depth, 0, `${p.key}: root at depth ${nd.depth}`); continue; }
        assert.ok(nd.parent < nd.index, `${p.key}: parent ${nd.parent} not before ${nd.index}`);
        assert.equal(tree.nodes[nd.parent].depth, nd.depth - 1,
          `${p.key}: node ${nd.index} at depth ${nd.depth} under depth ${tree.nodes[nd.parent].depth}`);
      }
      // Exactly one root: an attempt is one call to `step(0)`.
      assert.equal(roots, 1, `${p.key}: attempt ${a.index} has ${roots} roots`);
      // Every engine node in range is present, and the extra marks are all cut leaves.
      const real = tree.nodes.filter(nd => nd.node >= 0).length;
      assert.equal(real, tree.span, `${p.key}: ${real} nodes drawn for a span of ${tree.span}`);
      assert.ok(tree.nodes.every(nd => nd.node >= 0 || nd.cut),
        `${p.key}: a mark is neither a node nor a cut`);
    }
  }
});

test("the walkthrough reproduces the plan it claims to explain", () => {
  // ── The one invariant the whole hero view rests on ──────────────────
  //
  // The walkthrough steps through the search's winning path and then replays phase 2's swaps. If
  // those two do not add up to the assignment that shipped, the reader is watching a plan being
  // built that is not the plan in front of them — which is worse than showing nothing, and it
  // would look completely plausible.
  //
  // Two specific ways it could break, and this catches both:
  //
  //   the chosen term is recorded on the CHILD node, not on the node that decided it, because the
  //   term a card keeps is the one the search recursed on. Reading it off the wrong node is an
  //   off-by-one that produces a full, wrong walkthrough.
  //   phase 2's moves are captured by DIFFING each named pass, so a pass added later without a
  //   diff would silently drop its moves and the last few courses would sit in the wrong rows.
  const bad = [];
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const trace = createTrace();
      const out = generate(p, variant, trace);
      if (out.refused) return;
      const snap = trace.snapshot();
      const model = deriveModel(snap);
      const steps = buildSteps(snap, model);
      if (!steps) { bad.push(`${p.key}#${vi}: no steps for a plan that generated`); return; }
      // ── Asserted for the PACKER too, which is how this shipped broken ──
      //
      // This read `steps.via === "search" && !steps.reconciles`, excusing packed plans on the
      // grounds that they have no per-course sequence to check. True of the spine and false of the
      // GRID: the panel still drew a grid and still animated phase 2's moves over it, so it did
      // show a plan — one missing every course no move happened to touch.
      // `environmental_studies_and_philosophy_ba` ended its walkthrough showing 9 of 34 courses
      // and this test passed. The exemption was the bug.
      //
      // Reconciliation is a claim about what the GRID ends up holding, and every route that
      // produces a grid owes it.
      if (!steps.reconciles) {
        const n = steps.passes.reduce((k, q) => k + q.moves.length, 0);
        bad.push(`${p.key}#${vi}: via=${steps.via}, ${steps.place.length} steps + `
          + `${n} moves do not reproduce the ${steps.final.length}-course plan`);
      }
      // A search-built plan must have a step per course. The packer legitimately has none — it is
      // a greedy pass with no tree — and the panel says so rather than stepping through nothing.
      if (steps.via === "search" && steps.place.length !== steps.final.length) {
        bad.push(`${p.key}#${vi}: ${steps.place.length} steps for ${steps.final.length} courses`);
      }
      // Every step's term must be one the card was actually allowed. A step that places a course
      // in a term outside its own domain is the walkthrough inventing a legal move.
      const legal = new Map((snap.domainRows ?? []).map(r => [r.id, new Set(r.legal)]));
      for (const s of steps.place) {
        const dom = legal.get(snap.roster[s.card]?.id);
        if (dom && !dom.has(s.term)) {
          bad.push(`${p.key}#${vi}: ${s.title} placed in term ${s.term}, not in its domain`);
          break;
        }
      }
    });
  }
  assert.deepEqual(bad, [], bad.slice(0, 5).join(" | "));
});

test("every frame of the walkthrough is a plan the engine could have held", () => {
  // ── Reconciliation is about the LAST frame, and that was the hole ───
  //
  // The test above proves the walkthrough ends on the plan that shipped. It says nothing at all
  // about the thirty-odd frames before it, and for as long as that was the only claim, those
  // frames were drawn on the reader's screen with nothing having looked at them once.
  //
  // They were wrong on 406 of 786 plans. Phase 2's log is a diff PER PASS — its entries are two
  // complete assignments subtracted, simultaneous and unordered — and the view stepped through
  // them one at a time. Every proper prefix of a pass is a state that never existed, and for
  // `reclaimFromFiller`, whose every move is half of an exchange, it is a term holding both
  // sides at once: `physics_and_music_with_concentration_in_music_technology_bs_(boston)` drew
  // a 21 SH first semester — five cards in a four-slot fall, 2 SH over the registration cap —
  // and then took the general elective back out two frames later.
  //
  // ── Why capacity, and not "is it one of the states we recorded" ─────
  //
  // Because the second question can only be asked of the recording, and the recording is what
  // was wrong. `capSH` and `slots` come from `termCapacity` and `termSlotCap`, the same two
  // functions `fitsCapacity` screens every mutation with, so this is an INDEPENDENT statement:
  // no assignment the search or the objective ever holds exceeds them, therefore any frame that
  // does is a plan neither phase built. It catches the next view that invents a state whatever
  // route it invents it by, including one that groups the passes correctly and then draws
  // something else.
  const bad = [];
  let frames = 0;
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const trace = createTrace();
      const out = generate(p, variant, trace);
      if (out.refused) return;
      const snap = trace.snapshot();
      const steps = buildSteps(snap, deriveModel(snap));
      if (!steps) return;
      for (let k = 0; k <= frameCount(steps); k++) {
        frames++;
        const load = frameLoad(steps, frameAt(steps, k));
        steps.terms.forEach((tm, ti) => {
          // `null` only for a recording made without the caps — no route in the engine does
          // that, and skipping is still better than inventing a bound to compare against.
          if (tm.capSH != null && load.sh[ti] > tm.capSH) {
            bad.push(`${p.key}#${vi} frame ${k}: ${tm.full} holds ${load.sh[ti]} SH, cap ${tm.capSH}`);
          }
          if (tm.slots != null && load.slots[ti] > tm.slots) {
            bad.push(`${p.key}#${vi} frame ${k}: ${tm.full} holds ${load.slots[ti]} courses, cap ${tm.slots}`);
          }
        });
      }
    });
  }
  assert.ok(frames > 0, "no frames checked");
  assert.deepEqual(bad, [], `${bad.length} frames over capacity | ${bad.slice(0, 5).join(" | ")}`);
});

test("the walkthrough ends on the EMITTED DOCUMENT, not merely on the recorded assignment", () => {
  // ── One step further out than `reconciles`, deliberately ────────────
  //
  // Reconciliation compares the walkthrough with `snapshot.assignment`, and both of those come
  // out of the recorder. It is a statement about the recording being self-consistent, and there
  // is a whole stage after it: `emitPlan` turns `improved.termOf` into the plan.json document
  // that `applySamplePlan` puts on the student's grid. Nothing compared the two ends.
  //
  // The reader's complaint is about THAT pair — "the process video differs from the actual final
  // generated plan" — so that is the pair asserted here: the last frame of the walkthrough
  // against the artifact, card by card and term by term.
  //
  // ── Matched by ORDER, and this is not fussiness ─────────────────────
  //
  // The obvious key is the year's heading plus the season, and it is wrong: `nanomedicine_ms#4`
  // publishes two years both headed "Year 2", so keying on it merges nine cards with three and
  // reports a plan that agrees perfectly as a mismatch. The first draft of this check did
  // exactly that and produced two false alarms. `emitPlan` walks the shape in order and trims
  // only the blank runs at either end, so the non-empty terms line up one for one.
  const bad = [];
  let terms = 0;
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const trace = createTrace();
      const out = generate(p, variant, trace);
      if (out.refused) return;
      const snap = trace.snapshot();
      const steps = buildSteps(snap, deriveModel(snap));
      if (!steps) return;

      const last = frameAt(steps, frameCount(steps));
      const inTerm = steps.terms.map(() => []);
      for (const [card, ti] of last) {
        // A card whose term is off the end of the shape has nowhere to be drawn, and losing it
        // silently is the failure this test exists for — so it is counted as a term short
        // rather than skipped.
        if (inTerm[ti]) inTerm[ti].push(steps.roster[card]?.text ?? "");
      }
      const video = inTerm.filter(l => l.length);
      // Co-op markers are not coursework and the search never places them; every other entry is
      // a cell, printed by the same `cellText` the roster carries.
      const shipped = [];
      for (const y of out.plan.plans[0].years) {
        for (const t of y.terms) {
          const list = (t.entries ?? []).filter(e => !e.coop).map(e => e.text);
          if (list.length) shipped.push(list);
        }
      }
      if (video.length !== shipped.length) {
        bad.push(`${p.key}#${vi}: ${video.length} filled terms in the walkthrough, `
          + `${shipped.length} in the plan`);
        return;
      }
      terms += shipped.length;
      for (let k = 0; k < shipped.length; k++) {
        const a = [...video[k]].sort().join(" | ");
        const b = [...shipped[k]].sort().join(" | ");
        if (a !== b) bad.push(`${p.key}#${vi} term ${k}: walkthrough [${a}] vs plan [${b}]`);
      }
    });
  }
  assert.ok(terms > 0, "no terms compared");
  assert.deepEqual(bad, [], bad.slice(0, 4).join(" | "));
});

test("a pass is one step, so the halves of an exchange are never drawn apart", () => {
  // The structural half of the claim above, and the one that makes it hold by construction
  // rather than by measurement: `buildSteps` hands out passes, not moves, so a caller cannot
  // reach a frame inside a pass even if it tries. `frameAt` is the only sequence there is —
  // `BuildSteps` renders exactly what it returns — so this pins the contract at its source.
  //
  // Checked on the plans that actually have a multi-move pass, because on a plan whose passes
  // each moved one course the property is true of the broken code too.
  let multi = 0;
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    variants.forEach((variant, vi) => {
      const trace = createTrace();
      const out = generate(p, variant, trace);
      if (out.refused) return;
      const snap = trace.snapshot();
      const steps = buildSteps(snap, deriveModel(snap));
      if (!steps || !steps.passes.some(q => q.moves.length > 1)) return;
      multi++;
      // Consecutive frames past the placements differ by a WHOLE pass: every move of it, and
      // nothing else. A view stepping move-by-move would show a difference of one here.
      const base = steps.place.length;
      for (let i = 0; i < steps.passes.length; i++) {
        const before = frameAt(steps, base + i);
        const after = frameAt(steps, base + i + 1);
        const moved = [...after].filter(([c, tm]) => before.get(c) !== tm).map(([c]) => c);
        const expect = steps.passes[i].moves.filter(m => before.get(m.card) !== m.to)
          .map(m => m.card);
        assert.deepEqual(new Set(moved), new Set(expect),
          `${p.key}#${vi}: frame ${base + i + 1} does not apply pass ${steps.passes[i].pass} whole`);
      }
      // And every move of one pass carries the engine's own stamp for it, so the grouping is
      // the recording's and not a guess made from the pass's name.
      for (const q of steps.passes) {
        assert.equal(new Set(q.moves.map(m => m.seq)).size, 1,
          `${p.key}#${vi}: pass ${q.pass} groups moves from more than one seq`);
      }
    });
  }
  assert.ok(multi > 0, "no plan in the corpus has a pass that moved more than one course");
});

test("a refusal still records a derivation", () => {
  // The case where the process is the ONLY account there is: a refused degree has no plan to
  // read instead. This asserts the panel has something to show, not that any particular program
  // refuses — the corpus's refusal set moves with the data.
  let checked = 0;
  for (const p of PROGRAMS) {
    const variants = p.plan?.plans?.length ? p.plan.plans : [null];
    for (let vi = 0; vi < variants.length; vi++) {
      const trace = createTrace();
      const out = generate(p, variants[vi], trace);
      if (!out.refused) continue;
      const snap = trace.snapshot();
      // A PRE-FLIGHT refusal legitimately records nothing beyond demand: no cards were ever
      // narrowed or placed, so there is no search to show and the panel says so.
      if (!snap.roster.length) continue;
      const model = deriveModel(snap);
      assert.ok(model, `${p.key}#${vi}: refused with a roster and no model`);
      assert.ok(model.stages.length >= 2, `${p.key}#${vi}: ${model.stages.length} stages`);
      // Nothing "produced this plan", because there is no plan. A stage that found a complete
      // arrangement the criteria then refused is marked `arrangement` instead — see
      // `buildSpine`, where the first version of this got it wrong and this test caught it.
      assert.ok(!model.stages.some(s => s.answered),
        `${p.key}#${vi}: a refusal claims a stage produced a plan`);
      checked++;
      if (checked >= 3) return;
    }
  }
});
