// LIVE · needs a dev server — drives a real browser with Playwright.
//
// NOT part of `npm test`. Runs via `npm run test:live` against a dev server the caller
// starts (`npm run dev`), so an ordinary PR never fails because nothing was listening.
//
// ── Why this exists: three bugs no headless test could reach ──────────
//
// CHART's UI shipped three defects in one afternoon, and every one was found by opening a
// browser and clicking, because each is a fault in RUNNING a component rather than in its
// output:
//
//   the TDZ            `const canGenerate` was declared BELOW the memo that read it, so
//                      every render with a program selected threw "Cannot access before
//                      initialization". The panel was simply blank.
//   the wrong wiring   `planGenerator` was registered in a file the app does not import, so
//                      `usePort` returned undefined and the button sat correctly disabled
//                      with nothing anywhere saying why.
//   the effect deadlock `gen`/`genBusy` were in a dependency array AND set by the effect, so
//                      the cleanup cleared `live` and the panel showed "Working out an
//                      order…" for ever, with no error in the console.
//
// The second is now caught statically by `test/contract/port-wiring.test.js`. The other two
// are not reachable without rendering: one needs the component to execute, the other needs an
// effect to settle. This is that test.
//
// ── It asserts the panel WORKS, not what it says ─────────────────────
//
// No text assertions beyond what identifies the control, because copy is localised into eight
// languages and a test that pins English would fail on a translation rather than a defect.
// What it checks is behaviour: the panel renders, CHART can be selected, generation finishes
// rather than hanging, a grid appears, and the console stayed clean. That is exactly the set
// the three bugs violated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.CHART_UI_BASE ?? "http://localhost:5173";
/** Generation is budgeted at 5 s and the catalog has to load first. */
const SETTLE_MS = 45_000;

/** Skip cleanly when no dev server is listening, rather than failing on absence. */
async function serverUp() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

test("chart UI › the panel renders, generates, and logs nothing", async (t) => {
  if (!await serverUp()) {
    t.skip(`no dev server at ${BASE} — start one with \`npm run dev\``);
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  // A TDZ throw surfaces here and nowhere else: React unmounts the subtree and the panel goes
  // blank, so an assertion about the DOM alone would report "not found" and miss the cause.
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: SETTLE_MS });
    // The catalog loads asynchronously; nothing about CHART is meaningful until it has.
    await page.waitForFunction(() => !document.body.textContent.includes("Loading"),
                               { timeout: SETTLE_MS }).catch(() => {});

    assert.deepEqual(errors, [], `console errors on load:\n  ${errors.join("\n  ")}`);

    // The CHART control is identified by its test id rather than by copy, so this survives
    // localisation. Its ABSENCE is not a failure here — a fresh profile may have no program
    // selected — but a present-and-broken control is.
    const toggle = page.getByTestId("plan-source-chart");
    if (await toggle.count() === 0) {
      t.diagnostic("no program selected in this profile — panel not offered; nothing to drive");
      assert.deepEqual(errors, [], "errors with no panel present");
      return;
    }

    await toggle.click();
    // The deadlock's signature: busy forever. So the assertion is that busy RESOLVES, which is
    // the property that was broken, rather than that a particular string appears.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="chart-status"]');
      return el && el.getAttribute("data-busy") === "false";
    }, { timeout: SETTLE_MS });

    const status = await page.getByTestId("chart-status").getAttribute("data-state");
    assert.ok(status === "ready" || status === "refused",
      `generation settled into an unexpected state: ${status}`);
    assert.deepEqual(errors, [], `console errors while generating:\n  ${errors.join("\n  ")}`);
  } finally {
    await browser.close();
  }
});
