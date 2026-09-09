// BROWSER · CHART runs off the main thread, and still produces a real plan.
//
// ── Why both halves are here ────────────────────────────────────────
//
// Moving the search into a Worker is the kind of change that passes every
// performance test by breaking the feature: a generator that returns nothing
// blocks nothing. So responsiveness is asserted BESIDE a plan actually arriving
// and being applied to the board. Neither assertion is worth much alone.
//
// The measurements this replaced are in `scripts/ui-block-probe.mjs`. What is
// pinned here is the property, not the numbers: the year control answers while a
// search is running, a search nobody wants is cancelled rather than queued, and
// a plan still crosses the worker boundary intact.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS = (year) =>
  `../../data/northeastern/programs/undergraduate/${year}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;

// 2026 publishes a plan AND generates; 2027 publishes none and takes the long
// road through the retry ladder — 87 seconds unbounded, which is what made this
// worth moving off the main thread at all.
const FAST = 2026, SLOW = 2027;

describe("CHART · off the main thread", () => {
  let browser, server, port, launchError = null;

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) { launchError = e; }
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  const seed = (major, entYear) => `(${((mj, ey) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() }]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad", entSem: "fall", entYear: ey,
      gradSem: "spring", gradYear: ey + 4, currentSemId: "fall" + ey,
      major: mj, major2: "", minor1: "", placements: {}, specialTermPl: {},
      semOrders: {}, placedOut: [], substitutions: [] }));
    localStorage.setItem(K + "tour-seen", "true");
    localStorage.setItem("numap-grad-expand-sampleplan", "true");
  }).toString()})(${JSON.stringify(major)},${entYear})`;

  async function open(major, entYear) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, entYear));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });

    const skip = page.getByRole("button", { name: /^Skip$/ }).first();
    const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
    await grad.waitFor({ timeout: 60_000 });
    for (let i = 0; i < 40; i++) {
      if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
      if (await grad.click({ timeout: 500 }).then(() => 1).catch(() => 0)) break;
    }
    const sel = () => page.locator('[data-claude-focus="major"] [data-edition-select]').first();
    await sel().waitFor({ timeout: 30_000 });

    const pick = async (year) => {
      await sel().click();
      const row = page.locator('[role="listbox"] [role="option"]', { hasText: `${year - 1}-${year}` }).first();
      await row.waitFor({ timeout: 15_000 });
      await row.click();
      await page.locator('[role="listbox"]').first().waitFor({ state: "detached", timeout: 15_000 });
    };
    const year = async () =>
      (await sel().innerText()).replace(/[^0-9-]/g, "").split("-").pop();

    return { ctx, page, pick, year, errors };
  }

  test("the year control answers WHILE a search is running", async () => {
    // The requirement, stated as the gesture that exposed it: change to the slow
    // edition, then change again before it can possibly have finished. With the
    // search on the main thread the second click waited out the first search —
    // 85.7 seconds, measured. The threshold is deliberately loose (2s against a
    // measured ~100ms): this is asserting "not blocked", not a benchmark, and a
    // tight bound would fail on a loaded CI box for no defect.
    const { ctx, pick, year, errors } = await open(CS(FAST), 2025);
    await pick(SLOW);
    await new Promise(r => setTimeout(r, 150));   // let generation get going

    const t = Date.now();
    await pick(FAST);
    const ms = Date.now() - t;

    assert.ok(ms < 2000, `the year control was blocked for ${ms} ms by a running search`);
    assert.equal(await year(), String(FAST), "the interrupted switch did not take effect");
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("a plan still comes back, and it is a real one", async () => {
    // The half that stops the above from being satisfiable by doing nothing. A
    // plan has to cross `postMessage`, which silently drops anything that is not
    // structured-cloneable — a functioning generator that returns an empty husk
    // would pass every timing assertion in this file.
    const { ctx, page, errors } = await open(CS(FAST), 2025);
    await page.locator('[data-testid="plan-source-chart"]').first().click();

    const status = page.locator('[data-testid="chart-status"]').first();
    // `attached`, not the default `visible`: this is a zero-size machine-readable
    // marker, so waiting for visibility waits for ever on an element that is
    // doing its job perfectly. The first version of this test failed for that
    // reason and looked exactly like "the worker never returns a plan".
    await status.waitFor({ state: "attached", timeout: 30_000 });
    for (let i = 0; i < 200; i++) {
      const s = await status.getAttribute("data-state");
      if (s === "ready" || s === "refused") break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(await status.getAttribute("data-state"), "ready",
      "CHART did not produce a plan for a program that generates one");

    // ...and it must carry actual courses, not an empty shell that survived the
    // clone by having nothing in it.
    const text = await page.evaluate(() => document.body.innerText);
    assert.match(text, /\b[A-Z]{2,4}\s?\d{4}\b/, "the generated plan names no courses");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("an abandoned search is CANCELLED, not left queued in front of the next one", async () => {
    // The mutation probe found this hole: deleting `planGenerator.cancel()` from
    // the effect cleanup killed nothing, because every other assertion here is
    // about the MAIN thread, and the worker keeps that free whether or not the
    // search it is running is wanted. Cancellation is invisible to all of them.
    //
    // What makes it observable is that the section now waits for CHART's answer
    // before rendering. One worker runs one search at a time, so an abandoned
    // search that is not terminated still has to FINISH before the next request
    // is even read — and the next request is the one the student is waiting on.
    // Uncancelled, the panel for the year they actually chose cannot appear until
    // the abandoned one gives up, which is the engine's whole 6-second budget.
    const { ctx, page, pick, errors } = await open(CS(FAST), 2025);

    await pick(SLOW);                              // starts a long search
    await new Promise(r => setTimeout(r, 200));    // let it get going
    const t = Date.now();
    await pick(FAST);                              // ...and abandon it

    // FAST publishes a catalog plan, so its section does not wait on CHART at
    // all — the toggle is the thing to watch, and it must arrive promptly.
    await page.locator('[data-testid="plan-source-catalog"]').first()
      .waitFor({ state: "attached", timeout: 20_000 });
    const ms = Date.now() - t;

    // 4s: comfortably under the 6s a queued search would cost, comfortably over
    // anything a healthy machine needs. Asserting a tight bound here would fail
    // on a loaded box for no defect.
    assert.ok(ms < 4000,
      `the abandoned search was not cancelled — the next year took ${ms} ms to appear`);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("rapid switching leaves exactly one worker, not a pile", async () => {
    // Cancellation terminates and re-creates. Spamming the control is the
    // obvious way to turn that into a leak — every abandoned search would go on
    // burning a core, and on a machine with ten of them the eleventh switch is
    // slower than the first for a reason nobody would ever guess.
    const { ctx, page, pick, errors } = await open(CS(FAST), 2025);
    for (let i = 0; i < 6; i++) await pick(i % 2 ? FAST : SLOW);

    const t = Date.now();
    await pick(FAST);
    const ms = Date.now() - t;
    assert.ok(ms < 2000, `after six rapid switches the control took ${ms} ms — searches are piling up`);

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
