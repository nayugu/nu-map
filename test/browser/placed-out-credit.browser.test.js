// BROWSER · a placed-out course is not a General Elective, in the real app.
//
// The student report this exists for: placing out of CHNS 2101 (and so 1101 and
// 1102) listed all three under General Electives at 4 SH each. The unit tests in
// test/unit/placed-out-credit.test.js prove the derivation; this proves the PANEL,
// which builds its own sets (GradPanel does not use derivePlanSets), against the
// real catalog and a real degree, exactly as the student set it up.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

// A degree that names no Chinese course, so every CHNS course a student holds is
// a free elective if it counts at all. Same program the General Electives test
// uses for "has room".
const BSCS = "../../data/northeastern/programs/undergraduate/2026/computer-information-science/computer_science_bscs_(boston)/requirements.json";

describe("Placed-out courses earn no General Elective credit", () => {
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

  const seed = (placements, placedOut) => `(${((pl, po, mj) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() }]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad", entSem: "fall", entYear: 2025,
      gradSem: "spring", gradYear: 2029, currentSemId: "fall2025",
      major: mj, major2: "", minor1: "", placements: pl, specialTermPl: {},
      semOrders: {}, placedOut: po, substitutions: [] }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(placements)},${JSON.stringify(placedOut)},${JSON.stringify(BSCS)})`;

  /** The General Electives row's placed SH, read from the rendered panel. */
  async function generalElectiveSH(placements, placedOut) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(placements, placedOut));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });

    const skip = page.getByRole("button", { name: /^Skip$/ }).first();
    const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
    await grad.waitFor({ timeout: 60_000 });
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
      opened = await grad.click({ timeout: 500 }).then(() => true).catch(() => false);
    }
    assert.ok(opened, "could not open the graduation panel");

    let m = null, text = "";
    for (let i = 0; i < 150 && !m; i++) {
      text = await page.evaluate(() => document.body.innerText);
      m = text.match(/General Electives[\s\S]{0,80}?(\d+)\s*\/\s*(\d+)\s*SH/);
      if (!m) await new Promise(r => setTimeout(r, 100));
    }
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    assert.ok(m, `no General Electives figure on the panel — got:\n${text.slice(0, 400)}`);
    return Number(m[1]);
  }

  test("the student's case: placed out of CHNS 1101, 1102, 2101; took CHNS 2102", async () => {
    const sh = await generalElectiveSH({ CHNS2102: "fall2025" }, ["CHNS1101", "CHNS1102", "CHNS2101"]);
    assert.equal(sh, 4, `General Electives shows ${sh} SH; only CHNS 2102 (4 SH) was taken for credit`);
  });

  test("control: the same courses TAKEN, not placed out, do count (the test can tell the difference)", async () => {
    const sh = await generalElectiveSH(
      { CHNS1101: "fall2025", CHNS1102: "fall2025", CHNS2101: "fall2025", CHNS2102: "fall2025" }, []);
    assert.equal(sh, 16, `taken courses should be free electives, got ${sh} SH`);
  });
});
