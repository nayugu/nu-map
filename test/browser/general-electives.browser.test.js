// BROWSER · the audit never ticks a box for a requirement it did not measure.
//
// ── Why this cannot be a Node test ──────────────────────────────────
//
// The rule is pure and lives in `generalElectivesWorthShowing` +
// `sectionProgress`, with `test/unit/general-electives.test.js` on it and a
// corpus invariant proving the consequence over all 1,722 shipped programs.
// None of that evaluates a React component body, and this defect was ONLY ever
// visible as a rendered row: a ticked checkbox, "0/0 SH", and a full progress
// bar, on a degree whose total the catalog never gave us.
//
// `GradPanel` carries its own copy of the section renderer — it does not import
// planModel's — so the printed report and the panel could be fixed
// independently and one of them silently left wrong. That is the specific thing
// this file rules out.
//
// A second reason it has to run in a browser: for most of this session the
// panel's copy was INVISIBLE to grep, because GradPanel.jsx contained a literal
// NUL byte and every text tool treated the file as binary. A search for
// `placedSH` came back empty and the defect looked like it lived only in the
// export. The byte is fixed; the test is what stops the conclusion from
// depending on that.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const P = (year, college, folder) =>
  `../../data/northeastern/programs/undergraduate/${year}/${college}/${folder}/requirements.json`;

// Verified against the shipped tree rather than assumed, which is the whole
// point of picking these two:
//   · Foundation Year states NO `totalCreditsRequired`, so there is no residual
//     to take and the allowance is unknown — the case that shipped a ✓.
//   · Computer Science BSCS states 134 SH and leaves real room, so it must keep
//     its row. A fix that hid the section outright would pass every assertion
//     about the first program and destroy the feature.
const NO_TOTAL = P(2026, "admission", "foundation_year");
const HAS_ROOM = P(2026, "computer-information-science", "computer_science_bscs_(boston)");

describe("General Electives · a row only when there is something to say", () => {
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

  const seed = (major, placements) => `(${((mj, pl) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() }]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad", entSem: "fall", entYear: 2025,
      gradSem: "spring", gradYear: 2029, currentSemId: "fall2025",
      major: mj, major2: "", minor1: "", placements: pl, specialTermPl: {},
      semOrders: {}, placedOut: [], substitutions: [] }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${JSON.stringify(placements)})`;

  /**
   * Open the requirements panel and read every section row as ONE synchronous
   * DOM snapshot.
   *
   * Not as a series of locator calls: choosing a program remounts the panel, and
   * a `count()` on one row followed by a read of another can straddle that and
   * sit out its whole timeout on an element that merely blinked. One `evaluate`
   * either sees a mounted panel or sees none, and "none" is an answer the poll
   * can legitimately retry.
   */
  async function sections(major, placements = {}) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, placements));
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
    assert.ok(opened, "could not open the graduation panel — something is covering it");

    // Poll for the panel's text to mention ANY requirement section, then read.
    // Polling a condition rather than the clock; the requirements load lazily.
    let text = "";
    for (let i = 0; i < 150; i++) {
      text = await page.evaluate(() => document.body.innerText);
      if (/\bSH\b/.test(text) || /General Electives/.test(text)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    return text;
  }

  test("a program with no stated total shows no General Electives row at all", async () => {
    // The exact render that shipped: "General Electives" beside "0/0 SH".
    // Asserted on the STRING rather than on a count, because the count was 1
    // both before and after — what changed is whether it claims anything.
    const text = await sections(NO_TOTAL);
    assert.doesNotMatch(text, /General Electives/,
      "a program with no stated degree total still offers a free-elective figure");
    assert.doesNotMatch(text, /0\/0 SH/,
      "the exact row that read as a satisfied requirement");
  });

  test("a program that does leave room keeps its row, with a real denominator", async () => {
    // The regression guard. Hiding the section unconditionally would satisfy the
    // test above and delete a real feature from every degree that has one.
    const text = await sections(HAS_ROOM);
    assert.match(text, /General Electives/,
      "a degree with a real free-elective allowance lost its row");
    // Some positive denominator — not pinned to a number, which moves with the
    // parse on every edition roll and would fail for no defect.
    const m = text.match(/General Electives[\s\S]{0,80}?(\d+)\/(\d+) SH/);
    assert.ok(m, `no "n/m SH" figure beside the row — got:\n${text.slice(0, 400)}`);
    assert.ok(Number(m[2]) > 0,
      `the denominator is ${m[2]}, which is the defect this file exists for`);
  });

  test("credit placed against an UNKNOWN allowance shows the SH and no denominator", async () => {
    // Found by `scripts/mutation-probe.js`, not by review: setting
    // `allowanceUnknown = false` in GradPanel killed nothing, because every other
    // assertion here is about a row that is ABSENT. The panel's unknown-but-occupied
    // branch — a student on a program with no stated total who has actually placed
    // courses — was reachable and untested.
    //
    // It is the case that matters most, too. The row appears precisely because there is
    // credit to report, and without the branch `hasSplit` takes over and prints
    // `…/${requiredSH}` with `requiredSH` null.
    const text = await sections(NO_TOTAL, { CS1800: "fall2025" });

    assert.match(text, /General Electives/,
      "placed credit did not bring the row back — worth-showing is ignoring placedSH");
    assert.doesNotMatch(text, /null/,
      "`null` reached the screen — the split renderer ran on an unknown allowance");
    assert.doesNotMatch(text, /General Electives[\s\S]{0,60}?\d+\s*\/\s*0\s*SH/,
      "an unknown allowance is being reported as a measured zero");

    // The SH is stated, with no denominator after it. Anchored to the row so a figure
    // elsewhere on the page cannot satisfy it.
    const row = text.match(/General Electives[\s\S]{0,60}/)?.[0] ?? "";
    assert.match(row, /\d+\s*SH/, `no credit figure beside the row — got: ${row}`);
    assert.doesNotMatch(row, /\d+\s*\/\s*\d+\s*SH/,
      "a denominator appeared for an allowance we cannot measure");
  });
});
