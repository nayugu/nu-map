// BROWSER · the co-op prep note reaches the screen.
//
// ── Why a browser test ─────────────────────────────────────────────
//
// The chain has five links and every one of them is invisible to Node:
//
//   coop-courses.json → prep
//     → stampCoopPrep in courseNorm.js  (per-course { observations })
//       → applied by the catalog loader
//         → read as selCourse.coopPrep in InfoPanel.jsx
//           → rendered through t("info.coopPrep.body", { count })
//             → and the locale key exists in all 8 files
//
// The stamp is verified in Node and the loader parity is verified by a source
// scan, and both would be true of a note that never appeared — a missing locale
// key or a typo'd field name renders nothing at all, silently. Nothing in Node
// evaluates a React component body.
//
// Self-hosts via ensureBuild + serveDist, like minor-overlap and maintenance,
// rather than skipping when no dev server is up. A skip is how this class of
// bug travels (see boot-smoke.browser.test.js).
//
// ── What it asserts, and what it deliberately does not ─────────────
//
// It asserts the note appears for a course that HAS the marker, with the real
// observation count, and does NOT appear for one that lacks it. It does not
// assert wording beyond the count, because the English string is free to change
// and the locale files are the place that owns it.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const CS_BS = "../../data/northeastern/programs/undergraduate/2026/" +
  "computer-information-science/computer_science_bscs_(boston)/requirements.json";

// The marker under test, read from the shipped asset rather than hardcoded, so
// a re-derive that changes the count updates the expectation with it.
const PREP = JSON.parse(
  readFileSync(new URL("../../public/northeastern/coop-courses.json", import.meta.url), "utf8")
).prep ?? {};

/** Course ids that really exist, so a control cannot be a phantom. */
const CATALOG = new Set(
  JSON.parse(readFileSync(new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"))
    .map(c => `${c.subject}${c.number}`)
);

/**
 * Seeded through addInitScript, NOT evaluate()+reload — the app writes the live
 * plan on unload, so a reload overwrites anything poked into localStorage
 * first (see coop-grant.browser.test.js).
 */
const seed = (placements) => `(${((pl, major) => {
  const P = "ncp-";
  localStorage.setItem(P + "plan-index", JSON.stringify([
    { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
  ]));
  localStorage.setItem(P + "plan-data-default", JSON.stringify({
    version: 1, studentType: "undergrad",
    entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
    currentSemId: "fall2025",
    major, minor1: null, placements: pl,
    specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
  }));
  localStorage.setItem(P + "tour-seen", "true");
}).toString()})(${JSON.stringify(placements)},${JSON.stringify(CS_BS)})`;

describe("co-op · the prep note", () => {
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

  /** Open the info panel for one placed course and return the page text. */
  async function panelFor(courseId, label) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed({ [courseId]: "fall2025" }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    const card = page.getByText(label).first();
    assert.ok(await card.count(), `${courseId} was not placed on the board`);
    await card.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    // Proof the PANEL opened. Without it a click swallowed by a modal leaves
    // the assertions below passing against an empty board.
    assert.match(text, /Prerequisite|NUpath|UNLOCKS|Class standing|Before co-op/,
      "the info panel does not appear to have opened");
    return text;
  }

  test("a prep course states how many published plans agree", async () => {
    const obs = PREP.CS1210?.observations;
    assert.ok(Number.isFinite(obs),
      "CS1210 is no longer in coop-courses.json prep — re-point this test at a course that is");
    const text = await panelFor("CS1210", /CS\s*1210/);
    assert.match(text, new RegExp(`\\b${obs}\\b`),
      `the note must quote the real observation count (${obs})`);
    assert.match(text, /before the first co-op/i);
  });

  test("a course with no prep marker carries no note", async () => {
    // The control that makes the test above mean something: CS 1800 is required
    // by the same program and placed the same way, it simply is not prep.
    //
    // It must be a course that EXISTS. The first draft used CS 2500, which is
    // not in the catalog at all (nor is CS 2510 — though `CS 2501 Lab for
    // CS 2500` is). The board silently rendered nothing, so `PREP.CS2500 ===
    // undefined` passed for the wrong reason and the control proved nothing.
    // CLAUDE.md records this exact trap under "verify, never assume".
    assert.ok(CATALOG.has("CS1800"), "the control course must exist in the catalog");
    assert.equal(PREP.CS1800, undefined, "CS1800 unexpectedly has a prep marker");
    const text = await panelFor("CS1800", /CS\s*1800/);
    assert.doesNotMatch(text, /before the first co-op/i);
  });
});
