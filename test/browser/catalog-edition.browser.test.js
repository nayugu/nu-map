// BROWSER · the catalog-edition prompt, and the program box under it.
//
// `test/unit/cohort-version.test.js` proves which edition is OFFERED. Every
// line of it passed while the app was broken, because the defect was not in
// the choice — it was that the offered path was absent from the cohort's own
// option list, and `SearchCombo` resolves its display by searching that list.
// So the requirements changed underneath the student while the search input
// went EMPTY, with no error, no page error, and no way back. Nothing in Node
// evaluates a component body, so nothing in Node could see it.
//
// Measured before the fix, on this exact seed: input "Computer Science, BSCS
// (Boston)" → click Switch → input "". The banner fired for 338 of 498
// undergraduate majors for every cohort the app then had.
//
// Three states, and the third is the one that pays:
//
//   A · pinned      cohort 2026, plan 2026  → no prompt, box named
//   B · behind      cohort 2027, plan 2026  → prompt says 2027, box named
//   C · ahead       cohort 2024, plan 2027  → prompt says 2026, and Switch
//                                             moves the plan BACKWARD
//
// C is the repair path for every plan the old newer-only banner pushed
// forward. A newer-only check returns nothing there, so a test suite without
// C would pass on a fix that leaves those students stranded.
//
// Like boot-smoke and minor-overlap, this FAILS rather than skips when a
// browser is unavailable: a skip is how this class of bug travels.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const PROGRAM = (year) =>
  `../../data/northeastern/programs/undergraduate/${year}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;

/** Held in both editions, so every case below is reachable on one program. */
const P2026 = PROGRAM(2026);
const P2027 = PROGRAM(2027);
const NAME  = "Computer Science, BSCS (Boston)";

describe("catalog editions · the prompt and the program box", () => {
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

  /** Seeded through addInitScript — the app writes the live plan on unload. */
  const seed = (major, entYear) => `(${((mj, ey) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad",
      entSem: "fall", entYear: ey, gradSem: "spring", gradYear: ey + 4,
      currentSemId: "fall" + ey,
      major: mj, minor1: "", placements: {},
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${entYear})`;

  async function openPanel(major, entYear) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, entYear));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    await page.getByRole("button", { name: /^Graduation$/ }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    const input = page.locator('[data-claude-focus="major"] input').first();
    // Proof the panel actually OPENED. Without it a click swallowed by a modal
    // leaves an empty board, and "the box is not blank" fails for the wrong
    // reason while "no prompt" passes for free.
    const body = await page.evaluate(() => document.body.innerText);
    assert.match(body, /GPA requirements|NUPATH|NUPath/,
      `the graduation panel did not open:\n${body.slice(0, 600)}`);

    const read = async () => {
      const text = await page.evaluate(() => document.body.innerText);
      return {
        box: await input.inputValue(),
        // The year the prompt NAMES, not merely that a prompt exists — the
        // direction is the whole point and a boolean cannot see it.
        promptYear: (text.match(/Your catalog edition is (\d{4})/) ?? [])[1] ?? null,
      };
    };
    const savedPath = () => page.evaluate(() =>
      JSON.parse(localStorage.getItem("ncp-plan-data-default")).major);

    return { ctx, page, read, savedPath, errors };
  }

  test("A · a correctly pinned plan gets no prompt and keeps its name", async () => {
    // Every cohort from fall 2023 to spring 2026 lands here. This is the 338.
    const { ctx, read, errors } = await openPanel(P2026, 2025);
    const s = await read();
    assert.equal(s.promptYear, null,
      `a correctly pinned plan was told to leave its own edition (offered ${s.promptYear})`);
    assert.equal(s.box, NAME, "the program box lost its name");
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("B · a plan behind its cohort is named AND prompted", async () => {
    // Reachable with no click at all — a share link, or editing the entry term.
    // Before the fix the box here was blank on arrival.
    const { ctx, read, errors } = await openPanel(P2026, 2026);
    const s = await read();
    assert.equal(s.promptYear, "2027", "the prompt did not name the cohort's edition");
    assert.equal(s.box, NAME,
      "the box is blank while the requirements below it are loaded — the original defect");
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("C · a plan AHEAD of its cohort is offered the way back, and taking it sticks", async () => {
    // The rescue. A fall-2023 entrant whose plan the old banner moved to 2027.
    const { ctx, page, read, savedPath, errors } = await openPanel(P2027, 2023);

    const before = await read();
    assert.equal(before.promptYear, "2026",
      "a stranded plan was not offered the way back to its own edition");
    assert.equal(before.box, NAME, "the box is blank before the switch");

    await page.getByRole("button", { name: /^Switch$/ }).first().click();
    await page.waitForTimeout(3000);

    const after = await read();
    // The property the whole change turns on: switching may never empty the box.
    assert.equal(after.box, NAME,
      "Switch emptied the program box — the offered path is not in the cohort's option list");
    assert.equal(after.promptYear, null,
      "the prompt survived being obeyed, so it would reappear forever");
    assert.match(await savedPath(), /\/2026\//,
      "the repaired edition did not reach the saved plan");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
