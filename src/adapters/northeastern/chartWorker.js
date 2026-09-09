// ═══════════════════════════════════════════════════════════════════
// CHART WORKER — the search, off the main thread
//
// ── Why a worker and not "better async" ────────────────────────────
//
// `generatePlan` is synchronous CPU work. `async`/`await` does not make
// synchronous work yield: an `await` before it only moves WHEN the block
// starts, never that it blocks. So no amount of restructuring in the component
// can keep the year selector clickable while a search runs — measured, the main
// thread was frozen for 85.7 seconds, and after the request-wide deadline
// landed it was still frozen for 6.
//
// A worker is the only arrangement in which that is structurally impossible.
// The UI does not wait on CHART, it listens for it: the catalog year, the
// audit, the board and every other control keep running at full speed while a
// plan is being worked out, and a plan that never arrives costs a greyed tab
// rather than a locked page.
//
// ── What crosses the boundary ──────────────────────────────────────
//
// The whole `courseMap`, per request. Measured rather than feared:
// `structuredClone` of all 8,521 courses is 29 ms, against the 6,000 ms it is
// buying back, and the result travelling the other way clones in 1 ms.
//
// Sending it beats having the worker fetch the catalog itself, and that is a
// correctness argument rather than a performance one: the map the planner holds
// is NOT the file on disk. `PlannerContext` materializes repeat instances onto
// it and sums `repeatTotalSh` for accumulate requirements. A worker that loaded
// the file would plan against a subtly different catalog than the audit the
// student is looking at — the two-derivations-of-one-fact failure this codebase
// keeps paying for. Copying is 29 ms; disagreeing is silent.
//
// `ports`, the depth index and the calibration are built HERE from that map,
// because they carry functions and functions do not survive `postMessage`.
// Rebuilding the depth index per request is deliberate: it costs the worker, not
// the person, and a cache keyed on a map that legitimately changes per plan is
// how the wrong index gets used.
// ═══════════════════════════════════════════════════════════════════

import { generatePlan, DEFAULT_PREFERENCES, createTrace } from "../../engine/index.js";
import { buildDepthIndex } from "../../engine/prereqDepth.js";
import enginePorts from "./enginePorts.js";
import chartCalibration from "./chartCalibration.js";

self.onmessage = (e) => {
  const { id, args } = e.data ?? {};
  try {
    const {
      programData, publishedPlan = null, donorPlan = null, courseMap,
      studentType, concentration = null, preferences = null,
      wantTrace = true, totalBudgetMs, order = {},
    } = args ?? {};

    const sink = wantTrace ? createTrace() : null;
    const out = generatePlan({
      trace: sink,
      program: programData,
      publishedPlan,
      donorPlan,
      courseMap,
      ports: enginePorts(courseMap),
      depthIndex: buildDepthIndex(courseMap),
      observedOrder: order.edges ?? [],
      coopPrep: order.coopPrep ?? [],
      positions: order.positions ?? null,
      totalBudgetMs,
      studentType,
      concentration,
      calibration: chartCalibration,
      preferences: preferences ?? DEFAULT_PREFERENCES,
      repeatable: (cid) => !!courseMap[cid]?.repeatable,
    });

    const derivation = sink ? sink.snapshot() : null;
    self.postMessage({
      id,
      result: out.refused
        ? { refused: out.refused, derivation }
        : { plan: out.plan.plans[0], report: out.report, derivation },
    });
  } catch (err) {
    // A throw in here must reach the panel as a refusal, not as silence. The
    // main thread cannot see this stack, so the message carries it: a worker
    // that dies quietly is indistinguishable from one still working, and the
    // panel would wait out its whole timeout for an answer that already failed.
    self.postMessage({
      id,
      error: String(err?.stack ?? err?.message ?? err),
    });
  }
};
