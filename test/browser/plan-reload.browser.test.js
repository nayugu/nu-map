// BROWSER · a program choice survives a reload.
//
// `plan-persistence.test.js` checks the SHAPE of the save path — that the
// beforeunload handler reads current state through a ref rather than a closure.
// This checks the consequence, because the shape can be right while the save is
// still broken: the ref could be wired and `saveCurrentPlanToSlot` could write
// the wrong key, which is bug (2) in that file's own history.
//
// The bug this pins, measured on a real plan before the fix:
//
//   pick a concentration  → slot holds "Concentration in Artificial Intelligence"
//   reload                → slot holds ""
//
// The beforeunload handler's dependency array watched 12 fields while
// `captureCurrentPlan` writes 26, so it fired with the state of whichever
// render registered it and overwrote the correct slot on the way out. Fifteen
// fields were affected — major, both concentrations, both minors, plusOne,
// studentType, placedOut, appliedTemplate and the entry/graduation terms.
//
// It needed one of those to be the LAST change before leaving, which is why no
// behavioural test had caught it: place a course afterwards and the handler
// re-registers with a fresh closure and everything saves. So this test changes
// a program field and does NOTHING else before reloading. That order is the
// whole test.
//
// ⚠ The seed is IDEMPOTENT and that is load-bearing. `addInitScript` runs
// before EVERY navigation, so an unguarded seed re-writes the plan on reload
// and destroys exactly what is being measured — it made this bug look like it
// reproduced on an unrelated commit, and made a fixed build look broken.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS_BACS = "../../data/northeastern/programs/undergraduate/2026/computer-information-science/computer_science_bacs_(boston)/requirements.json";
const CONC = "Concentration in Artificial Intelligence";

describe("plan persistence · a choice survives a reload", () => {
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

  const seed = (major) => `(${((mj) => {
    const K = "ncp-";
    if (localStorage.getItem(K + "plan-index")) return;   // once, not per navigation
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad",
      entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
      currentSemId: "fall2025",
      major: mj, conc: "", minor1: "", placements: {},
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)})`;

  test("a concentration chosen and then left alone is still there after a reload", async () => {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(CS_BACS));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));

    const openPanel = async () => {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
      await grad.waitFor({ timeout: 30_000 });
      let opened = false;
      for (let i = 0; i < 40 && !opened; i++) {
        if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
        opened = await grad.click({ timeout: 500 }).then(() => true).catch(() => false);
      }
      assert.ok(opened, "could not open the graduation panel");
      await page.locator('[data-claude-focus="conc"] input').first().waitFor({ timeout: 30_000 });
    };
    const savedConc = () => page.evaluate(() =>
      JSON.parse(localStorage.getItem("ncp-plan-data-default")).conc);

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await openPanel();

    // Choose it through the real UI, so the whole state path is exercised.
    const box = page.locator('[data-claude-focus="conc"] input').first();
    await box.click();
    await box.fill("Artificial");
    const option = page.locator(`text=${CONC}`).first();
    await option.waitFor({ timeout: 15_000 });
    await option.click();
    await page.waitForFunction((want) =>
      JSON.parse(localStorage.getItem("ncp-plan-data-default")).conc === want,
      CONC, { timeout: 15_000 });
    assert.equal(await savedConc(), CONC, "the choice never reached the slot");

    // Nothing else. Reload immediately — that is the case that used to lose it.
    await page.reload({ waitUntil: "load", timeout: 60_000 });
    await openPanel();

    assert.equal(await savedConc(), CONC,
      "the concentration was wiped on reload — the unload handler wrote a stale closure");
    assert.equal(await box.inputValue(), CONC, "the panel does not show the restored concentration");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
