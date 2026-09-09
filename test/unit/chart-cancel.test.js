// The worker plumbing, tested where it can be tested deterministically.
//
// ── Why a fake Worker rather than a browser ─────────────────────────
//
// Cancellation is close to invisible from the outside. The mutation probe made
// that concrete: deleting the cancel call killed nothing, because every browser
// assertion available was about the MAIN thread, and moving the search off it
// keeps the page responsive whether or not the search still running is one
// anybody wants. The difference cancellation makes is to the QUEUE, and a queue
// of one worker has no rendering.
//
// So the mechanism is asserted here against a stub, and the wiring — that the
// effect cleanup calls it — is asserted in the browser where the timing is
// observable. Neither covers the other, which is why both exist.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Every worker the adapter constructs during one test. */
let built = [];

class FakeWorker {
  constructor(url, opts) {
    this.url = String(url);
    this.opts = opts;
    this.posted = [];
    this.terminated = false;
    built.push(this);
  }
  postMessage(msg) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  /** Answer a message the way the real worker would. */
  reply(id, result) { this.onmessage?.({ data: { id, result } }); }
  fail(id, error)   { this.onmessage?.({ data: { id, error } }); }
}

let cancelChart, planGenerator;

/**
 * `generate` is async and awaits `observedOrder()` — a fetch that fails and is
 * caught — BEFORE it ever reaches the worker. So a synchronous assertion right
 * after calling it sees no worker at all, which is what the first version of
 * this file did and what made it look like the worker path was dead.
 */
const settle = () => new Promise(r => setTimeout(r, 0));

describe("CHART cancellation", () => {
  before(async () => {
    // `WORKER_OK` is decided at module load from these two globals, so they have
    // to exist BEFORE the import. That is the whole reason this file uses a
    // dynamic import instead of a static one.
    globalThis.Worker = FakeWorker;
    globalThis.document = {};
    const mod = await import("../../src/adapters/northeastern/planGenerator.js");
    cancelChart = mod.cancelChart;
    planGenerator = mod.default;
  });

  after(() => { delete globalThis.Worker; delete globalThis.document; });

  beforeEach(() => { cancelChart(); built = []; });

  test("cancelling TERMINATES the worker rather than asking it to stop", async () => {
    // A search is one synchronous call; a worker mid-search never reads its
    // message queue, so a "cancel" message would arrive after the work it was
    // meant to stop. Terminating is the only cancellation that cancels.
    const p = planGenerator.generate({
      programKey: "x", programData: { requirementSections: [{}], totalCreditsRequired: 100 },
      courseMap: {}, studentType: "undergraduate",
    });
    await settle();
    assert.equal(built.length, 1, "no worker was created");
    assert.equal(built[0].terminated, false);

    cancelChart();
    assert.equal(built[0].terminated, true, "the abandoned worker is still running");

    // ...and the caller is RELEASED. A promise left pending is the panel stuck
    // busy for ever on a search that no longer exists.
    const r = await p;
    assert.equal(r.cancelled, true, "an abandoned request must settle, and say so");
  });

  test("the next request gets a FRESH worker, not the terminated one", async () => {
    const a = planGenerator.generate({
      programKey: "x", programData: { requirementSections: [{}], totalCreditsRequired: 100 },
      courseMap: {}, studentType: "undergraduate",
    });
    await settle();
    cancelChart();
    await a;

    const b = planGenerator.generate({
      programKey: "y", programData: { requirementSections: [{}], totalCreditsRequired: 100 },
      courseMap: {}, studentType: "undergraduate",
    });
    await settle();
    assert.equal(built.length, 2, "the request was posted to a terminated worker");
    assert.equal(built[1].terminated, false);

    const w = built[1];
    w.reply(w.posted[0].id, { plan: { years: [] }, report: {} });
    const r = await b;
    assert.ok(r.plan, "the fresh worker's answer did not reach the caller");
  });

  test("a cancelled request cannot later be answered by a straggler", async () => {
    // The worker is gone, but a message already in flight must not resolve a
    // request that has been settled — that is how a previous catalog year's plan
    // lands beside the current year's audit.
    const p = planGenerator.generate({
      programKey: "x", programData: { requirementSections: [{}], totalCreditsRequired: 100 },
      courseMap: {}, studentType: "undergraduate",
    });
    await settle();
    const w = built[0];
    const id = w.posted[0].id;
    cancelChart();
    w.reply(id, { plan: { years: ["stale"] }, report: {} });

    const r = await p;
    assert.equal(r.cancelled, true, "a settled request was re-answered by a straggler");
    assert.equal(r.plan, undefined);
  });

  test("cancelling when nothing is running is harmless", () => {
    assert.doesNotThrow(() => cancelChart());
    assert.doesNotThrow(() => cancelChart());
    assert.equal(built.length, 0, "cancelling created a worker");
  });

  test("the port exposes cancel, because the UI must not know a worker exists", () => {
    assert.equal(typeof planGenerator.cancel, "function");
    assert.doesNotThrow(() => planGenerator.cancel());
  });
});
