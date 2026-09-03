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
  const seed = (major, minor1, placements, substitutions = []) => `(${((mj, mn, pl, sb) => {
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
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: sb,
    }));
    localStorage.setItem(P + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${JSON.stringify(minor1)},${JSON.stringify(placements)},${JSON.stringify(substitutions)})`;

  async function panelText({ major, minor1, placements = {}, substitutions = [],
                             expectMinor = true }) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, minor1, placements, substitutions));
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
    // WAIT for the row, do not assume it. A minor's requirements JSON loads
    // asynchronously, so on a loaded machine the fixed pause above can expire
    // before `SharedCredit` has anything to draw — and then a test reads a
    // figure that is not on screen yet and fails as though the number were
    // wrong. Observed once here, on the assertion that is a `doesNotMatch`:
    // the absent row made that half pass for free while its partner failed.
    if (expectMinor) {
      await page.locator("text=Double counting").first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});   // let the assertions below report what is missing
    }
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
    // 12 SH of the minor's 20 SH requirement is double counted against a 10 SH
    // ceiling. The bar measures the MINOR, not the cap: 10 SH of it counts and
    // the 2 SH past the ceiling does not, so the minor is 10 of 20 done — not
    // the 12 of 20 its own progress bar shows.
    // The excess is the only figure the collapsed row prints, and it encodes
    // the whole arithmetic: 12 SH double counted against a 10 SH ceiling.
    assert.match(text, /2 past the limit/, `the excess is missing from:\n${text.slice(0, 2000)}`);
    // A FACT, not an instruction. "2 SH have to come from courses that do not
    // overlap" is misleading for the student who has already satisfied every
    // requirement row: nothing has to come from anywhere, they have done the
    // work — 2 SH of it simply does not count.
    assert.match(text, /2 SH does not count toward the minor/,
                 "the consequence is not stated");
  });

  test("the same minor under an unrelated major shares nothing", async () => {
    // The control. Without it the assertions above would pass on a row that
    // always says "over" — and the failure that matters most here is a false
    // violation, which would tell a student to take courses they do not owe.
    const text = await panelText({ major: CS_BS, minor1: CJ_MINOR, placements: CRIM });
    assert.match(text, /Double counting/, "the row should still show the budget");
    // Every one of the 12 SH placed counts, so the figure is the whole of it
    // and no amber band exists. The collapsed row cannot say more than that:
    // credit inside the cap counts like any other, so "nothing is shared" and
    // "some is shared, within the limit" are deliberately the same picture.
    // That the courses are not shared AT ALL is proved on the board instead,
    // by the badge test below that expects no badge.
    assert.doesNotMatch(text, /past the limit/, "a false share against an unrelated major");
    // Keyed on the amber sentence itself, which is the only thing the over-cap
    // state adds — a phrase that no longer appears anywhere would make this
    // pass for free.
    assert.doesNotMatch(text, /does not count toward the minor/,
                        "a false violation against an unrelated major");
  });

  // ── Substitutions ───────────────────────────────────────────────
  // A substitution puts a VIRTUAL key in the placed set, so one course can be
  // claimed under two names — the minor's requirement key and the major's own
  // — and an intersection of keys sees nothing. ACCT 1201 is a BACJ
  // requirement and no part of the minor; substituted for CRIM 1120 it is
  // double counted, and before the fix the panel reported 8 SH instead of 12
  // and called the plan comfortable.

  const SUB_PLACE = { CRIM1100: "fall2025", CRIM1110: "fall2025", ACCT1201: "spr2026" };
  const SUB = [{ from: "ACCT1201", to: "CRIM1120" }];

  test("a major course substituted for a minor requirement is counted", async () => {
    const text = await panelText({ major: BACJ, minor1: CJ_MINOR,
                                   placements: SUB_PLACE, substitutions: SUB });
    assert.match(text, /Double counting/, "the row is missing entirely");
    assert.match(text, /2 past the limit/,
                 `the substituted course was not charged:\n${text.slice(0, 2000)}`);
    assert.match(text, /2 SH does not count toward the minor/);
  });

  test("the same plan WITHOUT the substitution is 4 SH lighter", async () => {
    // The control that makes the test above a measurement of the substitution
    // rather than of the placements: same board, no swap, and the minor's third
    // requirement simply goes unmet.
    const text = await panelText({ major: BACJ, minor1: CJ_MINOR, placements: SUB_PLACE });
    assert.match(text, /Double counting/, "the row is missing entirely");
    assert.doesNotMatch(text, /past the limit/,
                        `nothing is over without the substitution:\n${text.slice(0, 2000)}`);
    assert.doesNotMatch(text, /does not count toward the minor/);
  });

  // ── The 2× badge on the card ────────────────────────────────────
  // The row above proves the arithmetic reaches the panel. This proves it
  // reaches the BOARD, which is a different chain: RelevanceContext has to
  // allocate from the same placed set the panel does and publish the cap
  // app-wide, and none of that runs in Node.

  /**
   * Card text for the board, without opening the graduation panel.
   *
   * `search` types into the course bank first, which is the only way to reach
   * the UNPLACED state: an eligible course the student has not placed lives in
   * the bank, and the bank does not list the catalog until asked.
   */
  async function boardText({ major, minor1, placements = {}, substitutions = [],
                             search = null }) {
    assert.equal(launchError, null, "chromium unavailable");
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, minor1, placements, substitutions));
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
    if (search) {
      await page.getByPlaceholder(/search/i).first().fill(search);
      await page.waitForTimeout(1200);
    }
    // Every badge on the page, by its accessible label — the glyph is a COUNT
    // ("2×"), so it cannot tell the three states apart on its own. The label
    // carries the same two sentences the hover card shows.
    const badges = await page.evaluate(() =>
      [...document.querySelectorAll("span[aria-label]")]
        .filter(el => /^\d+×$/.test(el.textContent.trim()))
        .map(el => el.getAttribute("aria-label")));
    const text = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    assert.match(text, /CRIM\s*1100/, "the board did not render the placed courses");
    return badges;
  }

  test("a placed course counting toward both is badged, and says so", async () => {
    const badges = await boardText({ major: BACJ, minor1: CJ_MINOR, placements: CRIM });
    assert.equal(badges.length, 3, `expected one per CRIM course, got ${badges.length}`);
    for (const b of badges) {
      // One major + one minor = two credentials.
      assert.match(b, /Counts toward 2 programs/);
      // This pair is over its cap, so every badge in the shared set says so.
      assert.match(b, /credit past that half does not count toward the minor/);
    }
  });

  test("the substituting course carries the badge, on the board", async () => {
    // The other half of the same fact, and the one that keeps the two surfaces
    // honest: the panel charges ACCT 1201 against the minor's budget, so the
    // card on the board must say so too. The badge is drawn on the REAL course
    // — CRIM 1120 is not on the board at all — which is why attribution has to
    // follow the substitution rather than the key.
    const badges = await boardText({ major: BACJ, minor1: CJ_MINOR,
                                     placements: SUB_PLACE, substitutions: SUB });
    assert.equal(badges.length, 3,
      `expected CRIM 1100, CRIM 1110 and the substituting ACCT 1201: ${JSON.stringify(badges)}`);
    for (const b of badges) assert.match(b, /Counts toward 2 programs/);
  });

  test("hovering the badge explains what its colour means", async () => {
    // The colour is the state and a colour cannot say why. The card has to
    // carry the meaning AND the minor's own figures — 12 SH against a 10 SH
    // cap — because no single course is the one over the limit.
    assert.equal(launchError, null, "chromium unavailable");
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(BACJ, CJ_MINOR, CRIM));
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

    const badge = page.locator("span").filter({ hasText: /^\d+×$/ }).first();
    await badge.waitFor({ state: "visible", timeout: 10_000 });
    const before = await page.evaluate(() => document.body.innerText);
    // Keyed on text only the hover card carries — the badge itself is just
    // "2×", and the graduation panel is not open in this test.
    assert.doesNotMatch(before, /credit past that half does not count toward the minor/,
      "the card must not be on screen before anyone hovers");

    await badge.hover();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.body.innerText);
    await ctx.close();

    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    assert.match(after, /Counts toward 2 programs/, "no title in the hover card");
    assert.match(after, /credit past that half does not count toward the minor/, "the colour's meaning is missing");
    // The minor, named, with its own budget — the same phrasing and the same
    // meter as the graduation panel's row (`grad.share.cap`).
    assert.match(after, /Criminal Justice, Minor\s+2 past the limit/);
  });

  test("an ELIGIBLE course is badged differently from one already counted", async () => {
    // The third state, and the one the board alone cannot show: a course the
    // student has not placed. CRIM 1120 is left off the plan and found through
    // the bank, where it must read as a possibility rather than a fact.
    const badges = await boardText({ major: BACJ, minor1: CJ_MINOR,
                                     placements: { CRIM1100: "fall2025", CRIM1110: "fall2025" },
                                     search: "CRIM 1120" });
    const would = badges.filter(b => /Would count toward/.test(b));
    assert.ok(would.length >= 1, `no eligible-state badge among: ${JSON.stringify(badges)}`);
    // The unplaced state says "if you take it", never "counts" — the whole
    // difference between the grey badge and the green one.
    assert.match(would[0], /haven’t placed this yet/);
    assert.doesNotMatch(would[0], /both count this course/);
  });

  test("the same courses under an unrelated major are not badged at all", async () => {
    // The control that matters: a badge that appeared here would be telling a
    // student they are banking overlap credit they are not banking.
    assert.deepEqual(await boardText({ major: CS_BS, minor1: CJ_MINOR, placements: CRIM }), []);
  });

  test("no minor selected means no badge, so it cannot leak onto a major", async () => {
    // Two majors double-count freely at Northeastern — no budget, nothing to
    // mark. The badge exists only for the overlap that has a cap.
    assert.deepEqual(await boardText({ major: BACJ, minor1: "", placements: CRIM }), []);
  });

  test("no minor at all draws no row", async () => {
    // `SharedCredit` lives inside `MinorBlock`, so this is really a check that
    // the cap cannot leak onto a major card, where the policy does not apply:
    // two majors double-count freely at Northeastern.
    const text = await panelText({ major: BACJ, minor1: "", placements: CRIM, expectMinor: false });
    assert.doesNotMatch(text, /Double counting/);
  });
});
