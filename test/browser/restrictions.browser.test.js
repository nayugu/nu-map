// BROWSER · Banner's restrictions reach the course card.
//
// ── Why a browser test ─────────────────────────────────────────────
//
// Six links, every one invisible to Node:
//
//   restrictions.json
//     → stampRestrictions in courseNorm.js
//       → applied by the catalog loader (one of three)
//         → read as selCourse.restrictions in InfoPanel
//           → season labelled through claude.sem.* and termYear()
//             → kind named through info.restrictions.name.<Kind>
//               → code glossed through the shipped label map
//
// The fold is unit-tested and the stamp is verified through the Node loader,
// and all of that would be true of a block that renders nothing. `t()` returns
// the KEY when a translation is missing, so a typo'd locale key does not throw
// — it prints `info.restrictions.name.Majors` on screen. Only a browser catches
// that, which is why this file asserts no raw key leaks.
//
// Self-hosts via ensureBuild + serveDist rather than skipping when no dev
// server is up (see boot-smoke.browser.test.js on why a skip is how this class
// of bug travels).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS_BS = "../../data/northeastern/programs/undergraduate/2026/" +
  "computer-information-science/computer_science_bscs_(boston)/requirements.json";

const RESTR = JSON.parse(
  readFileSync(new URL("../../public/northeastern/restrictions.json", import.meta.url), "utf8"));

/** A course that really has restrictions in the shipped asset. */
const SUBJECT = "MEIE4701";

/**
 * The control, chosen at RUN TIME rather than hard-coded.
 *
 * The first draft named CS 1800 and broke as soon as the capture widened and
 * CS 1800 gained a restriction. The asset grows every time another term is
 * scraped, so any fixed control is a test that expires. Picked here as: a real
 * CS course, 4 SH or more so the board does not file it under the collapsible
 * "other credits" group, and absent from the asset.
 */
function pickControl(restrictions) {
  const catalog = JSON.parse(
    readFileSync(new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"));
  for (const c of catalog) {
    const id = `${c.subject}${c.number}`;
    if (c.subject !== "CS") continue;
    if ((c.credits ?? 0) < 4) continue;
    if (restrictions.courses[id]) continue;
    return { id, pattern: new RegExp(`${c.subject}\\s*${c.number}`) };
  }
  return null;
}

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

describe("restrictions · the course card", () => {
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
    return text;
  }

  test("a restricted course shows its kinds, values and the term they came from", async () => {
    assert.ok(RESTR.courses[SUBJECT], `${SUBJECT} has no restrictions in the shipped asset`);
    const text = await panelFor(SUBJECT, /MEIE\s*4701/);

    assert.match(text, /Restrictions/, "the block did not render");
    // The kind, translated — not the raw Banner noun and not a locale key.
    // `Majors:` rather than `Class standing:`, because the latter also appears
    // in the standing box above and would pass for the wrong reason.
    assert.match(text, /Majors:/);
    // A value, glossed from the shipped label map rather than shown as a code.
    assert.match(text, /Mechanical Engineering/);
    assert.doesNotMatch(text, /\bMECE\b/, "a raw Banner code leaked instead of its label");
    // The season and its year, through the app's own summer wording.
    assert.match(text, /Summer B 2024/,
      "the term must be named, and summers are 'Summer B' not 'Summer 2'");
    // Coverage: every section, so a fraction would be noise.
    assert.match(text, /every section · Summer B 2024/);
  });

  test("a restriction that differs BY SEASON shows both readings", async () => {
    // The whole reason the fold keeps every term. MEIE 4701 is Industrial-only
    // in Fall and Mechanical-only in Summer B; a newest-term-only view would
    // show one and silently drop the other, which is the reading an IE student
    // needs. Skips rather than fails while the per-CRN backfill is incomplete —
    // Fall is 6,805 individual requests and may not be captured yet.
    const seasons = new Set((RESTR.courses[SUBJECT] ?? []).map(e => e.season));
    if (seasons.size < 2) {
      console.log(`      (skipped: ${SUBJECT} captured in ${[...seasons]} only — backfill pending)`);
      return;
    }
    const text = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.match(text, /Industrial Engineering/,  "the Fall reading is missing");
    assert.match(text, /Mechanical Engineering/,  "the Summer B reading is missing");
    assert.match(text, /· Fall 2024/);
    assert.match(text, /· Summer B 2024/);
  });

  test("the Classes row is not duplicated under the standing box", async () => {
    // The standing box directly above says "Junior standing or above". Printing
    // `Class standing: Junior · Senior` beneath it is the same fact twice in
    // adjacent boxes — suppressed when it adds nothing, kept when standing
    // varies by section or season.
    const text = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.match(text, /Class standing: Junior standing or above/, "the standing box should show");
    assert.doesNotMatch(text, /Junior · Senior/,
      "the uniform Classes restriction should not repeat the standing box");
  });

  test("no locale key leaks to the screen", async () => {
    // `t()` falls back to the KEY, so a missing or typo'd key renders as
    // `info.restrictions.name.Majors` rather than throwing. This is the only
    // check that catches it.
    const text = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.doesNotMatch(text, /info\.restrictions/, "an untranslated key reached the UI");
    assert.doesNotMatch(text, /claude\.sem\./, "an untranslated season key reached the UI");
    assert.doesNotMatch(text, /\{(kind|n|total)\}/, "an uninterpolated placeholder reached the UI");
  });

  test("a course with no restriction data shows no block", async () => {
    // The control that makes the test above mean something: a course placed the
    // same way, on the same board, that simply is not in the asset.
    const control = pickControl(RESTR);
    assert.ok(control, "no unrestricted 4+ SH CS course left — pick a different subject");
    const text = await panelFor(control.id, control.pattern);
    // Anchored on labels unique to this block: "Restrictions" alone is too
    // common a word elsewhere on the page to prove absence.
    assert.doesNotMatch(text, /Class standing:/);
    assert.doesNotMatch(text, /every section ·/);
  });
});
