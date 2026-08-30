// BROWSER · the 50% double-counting cap RENDERS on a minor card.
//
// `test/unit/minor-overlap.test.js` proves the arithmetic, and every line of it
// would still pass if the row never reached the screen — nothing in Node
// evaluates a React component body, which is the outage `boot-smoke` exists
// for. And `boot-smoke` cannot cover this one: it loads a plan with no minor,
// so `MinorBlock` — and therefore `SharedCredit` inside it — renders nothing at
// all in the state every other browser test runs in.
//
// The chain this closes:
//
//   the plan names a minor
//     → GradPanel allocates BOTH majors and hands down their claimed keys
//       → MinorBlock measures the overlap against the same placedSet
//         → the row draws, with the figure and the way out
//
// Like boot-smoke and maintenance, it FAILS rather than skips when a browser is
// unavailable: a skip is how this class of bug travels.
//
// The pair is real, not constructed. Criminal Justice, Minor requires 20 SH and
// its first three courses (CRIM 1100/1110/1120, 12 SH) are all required by the
// Business Administration and Criminal Justice BS — 12 SH against a 10 SH cap,
// over by 2. It is one of three over-cap pairs found by sweeping 500 (major,
// minor) combinations.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const PROGRAM = (lvl, college, key) =>
  `../../data/northeastern/programs/${lvl}/2026/${college}/${key}/requirements.json`;

const BACJ  = PROGRAM("undergraduate", "business", "business_administration_and_criminal_justice_bs");
const CS_BS = PROGRAM("undergraduate", "computer-information-science", "computer_science_bscs_(boston)");
const CJ_MINOR = PROGRAM("undergraduate", "social-sciences-humanities", "criminal_justice_minor");

/** The minor's own required courses. Every one is also required by BACJ. */
const CRIM = { CRIM1100: "fall2025", CRIM1110: "fall2025", CRIM1120: "spr2026" };

describe("minor · the double-counting cap", () => {
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

  /**
   * Seeded through addInitScript, NOT evaluate()+reload — the app writes the
   * live plan on unload, so a reload overwrites anything poked into
   * localStorage first (see coop-grant.browser.test.js).
   */
  const seed = (major, minor1, placements) => `(${((mj, mn, pl) => {
    const P = "ncp-";
    localStorage.setItem(P + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(P + "plan-data-default", JSON.stringify({
      version: 1,
      studentType: "undergrad",
      entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
      currentSemId: "fall2025",
      major: mj, minor1: mn, placements: pl,
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(P + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${JSON.stringify(minor1)},${JSON.stringify(placements)})`;

  async function panelText({ major, minor1, placements = {}, expectMinor = true }) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, minor1, placements));
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
    const text = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    assert.ok(!/no longer in the catalog/.test(text), "a seeded program did not load");
    // Proof the panel actually OPENED. Without it a click swallowed by the
    // tour modal leaves an empty board, and every `doesNotMatch` below passes
    // for the worst possible reason.
    assert.match(text, /GPA requirements|NUPATH|NUPath/,
                 `the graduation panel did not open:\n${text.slice(0, 600)}`);
    if (expectMinor) assert.match(text, /Criminal Justice, Minor/, "the minor card is not on screen");
    return text;
  }

  test("a minor whose courses the major already requires reports the overage", async () => {
    const text = await panelText({ major: BACJ, minor1: CJ_MINOR, placements: CRIM });
    assert.match(text, /Double counting/, "the row is missing entirely");
    // 12 SH of the minor's 20 SH requirement, against a 10 SH cap.
    assert.match(text, /12\s*\/\s*10 SH/, `figure missing from:\n${text.slice(0, 2000)}`);
    assert.match(text, /2 SH over the limit/, "the overage is not stated");
    assert.match(text, /courses your major doesn’t count/, "the way out is not stated");
  });

  test("the same minor under an unrelated major shares nothing", async () => {
    // The control. Without it the assertions above would pass on a row that
    // always says "over" — and the failure that matters most here is a false
    // violation, which would tell a student to take courses they do not owe.
    const text = await panelText({ major: CS_BS, minor1: CJ_MINOR, placements: CRIM });
    assert.match(text, /Double counting/, "the row should still show the budget");
    assert.match(text, /0\s*\/\s*10 SH/, `expected an empty share, got:\n${text.slice(0, 2000)}`);
    assert.doesNotMatch(text, /over the limit/, "a false violation against an unrelated major");
  });

  test("no minor at all draws no row", async () => {
    // `SharedCredit` lives inside `MinorBlock`, so this is really a check that
    // the cap cannot leak onto a major card, where the policy does not apply:
    // two majors double-count freely at Northeastern.
    const text = await panelText({ major: BACJ, minor1: "", placements: CRIM, expectMinor: false });
    assert.doesNotMatch(text, /Double counting/);
  });
});
