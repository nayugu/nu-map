// BROWSER · a plan holding a course the catalog no longer has must still open.
//
// ── Why this exists ────────────────────────────────────────────────
//
// `public/northeastern/catalog-courses.json` is a single CURRENT snapshot and
// the monthly scrape REPLACES it. So every catalog roll deletes courses out
// from under plans that already reference them. Measured for the 2026→2027
// roll (`scripts/edition-probe.js --snapshot --editions 2027 --all-subjects`):
// 974 of our 7,966 courses are absent from the live edition, plus 115 more in
// 10 subjects that no longer have a page at all — about 1,089 retirements.
// `scripts/lib/course-retention.js` rescues the ones a shipped program tree
// still names; CLAUDE.md's simulation of this same roll puts the remainder,
// deleted outright, at 367.
//
// A student who placed one of those 367 has an id in `placements` that
// resolves to nothing. Nothing filters it: the load effect in PlannerContext
// builds `courseMap` from the catalog alone and never reconciles the restored
// plan against it, so `courseMap[id]` is simply `undefined` downstream.
//
// That is not obviously survivable. `occupantCards` warns in as many words
// that "card rendering reads several of these without guarding — color.slice()
// was the one that threw", which is a crash reachable from a missing record.
// And this arrives unattended: the scrape pushes straight to main, so the roll
// lands on a Tuesday morning with nobody watching.
//
// ── What this asserts ──────────────────────────────────────────────
//
// Not that the retired course is rendered nicely — it is gone, and this repo's
// rule is to degrade to LESS information rather than to wrong information. Only
// that the blast radius is the one card:
//
//   1. the app mounts, with no page error and no recovery screen;
//   2. the rest of the plan still renders — a real course seeded beside the
//      dead one is on the board.
//
// (2) is the half worth having. "No error" is also true of a blank page, and a
// plan that silently opens EMPTY is the expensive failure here: it looks like
// the student's own work was lost.
//
// The dead id is synthetic rather than a real retirement, on purpose. A real
// one gets rescued by course-retention or comes back in a later edition, and
// then this test passes for a reason that has nothing to do with what it
// checks. `ZZZZ 9999` can never be in the catalog.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS_BS = "../../data/northeastern/programs/undergraduate/2026/" +
  "computer-information-science/computer_science_bscs_(boston)/requirements.json";

/** A course id the catalog cannot ever contain — a retirement that stays retired. */
const DEAD = "ZZZZ9999";

/**
 * A real course to sit beside it, chosen at RUN TIME.
 *
 * Hard-coding one is how the sibling restrictions test broke: the catalog is
 * rescraped monthly and any fixed pick eventually stops being what the test
 * assumed. Picked as: a real CS course of 4 SH or more, so the board shows it
 * as its own card rather than folding it into the collapsed "other credits"
 * group where this test could not see it.
 */
function pickLiveCourse() {
  const catalog = JSON.parse(
    readFileSync(new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"));
  for (const c of catalog) {
    if (c.subject !== "CS") continue;
    if ((c.credits ?? 0) < 4) continue;
    return { id: `${c.subject}${c.number}`, pattern: new RegExp(`${c.subject}\\s*${c.number}`) };
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

describe("a retired course in a saved plan", () => {
  let browser, server, port, launchError = null;
  const live = pickLiveCourse();

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) {
      // Recorded and asserted on, never skipped — a missing browser must show
      // up as a gap rather than as a green run.
      launchError = e;
    }
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  /**
   * Open a seeded plan and return what the page did.
   *
   * `union`, when given, is served in place of retired-courses.json. Serving it
   * by route interception rather than writing the file keeps the repo's real
   * artifact — which is legitimately EMPTY today, because the frozen 2026
   * snapshot is still the shipped catalog — out of the test's way. Writing it
   * would make the test pass by mutating the thing it is checking.
   */
  async function open(placements, union = null) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    assert.ok(live, "no 4 SH CS course in the catalog — the picker needs revisiting");

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(placements));
    if (union) {
      await ctx.route("**/northeastern/retired-courses.json", route =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(union) }));
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const mounted = await page.locator("[data-timeline-header]")
      .waitFor({ state: "visible", timeout: 45_000 }).then(() => true).catch(() => false);
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();
    await ctx.close();
    return { errors, mounted, bodyText };
  }

  test("the app still mounts", async () => {
    const { errors, mounted, bodyText } = await open({
      [DEAD]: "fall2025", [live.id]: "fall2025",
    });
    assert.ok(!/Something went wrong/i.test(bodyText),
      "the recovery screen is showing — a retired course took the whole app down");
    assert.deepEqual(errors, [],
      `a retired course in the plan logged errors:\n  ${errors.join("\n  ")}`);
    assert.ok(mounted, "no timeline header — the planner did not mount");
  });

  test("MEASUREMENT — what the credit total does", async () => {
    // Not a guard. This records the CURRENT behaviour so the cost of the roll
    // is written down somewhere other than a comment.
    //
    // `totalSHPlaced` sums `effectiveCourseMap[id]?.sh ?? 0` over placement
    // keys, and PlannerContext says so in as many words: "unknown ids resolve
    // to 0". So a retired course is not a crash — it is a silent subtraction.
    // The plan opens, looks fine, and is short by that course's credits with
    // nothing on screen saying why. Printed rather than asserted because the
    // number is the finding; Milestone A is what changes it.
    const withDead = await open({ [DEAD]: "fall2025", [live.id]: "fall2025" });
    const alone    = await open({ [live.id]: "fall2025" });
    const sh = (txt) => (txt.match(/(\d+)\s*(?:SH|credits?)/i) ?? [])[1] ?? "?";
    console.log(`    retired course seeded: total reads ${sh(withDead.bodyText)}`);
    console.log(`    retired course absent: total reads ${sh(alone.bodyText)}`);
    console.log(`    the dead id appears on screen: ${/ZZZZ\s*9999/.test(withDead.bodyText)}`);
  });

  test("THE FIX — a course in the retired union comes back", async () => {
    // The inversion of the measurement above, and the only end-to-end proof
    // that the union is wired to anything. The same plan, the same dead id,
    // the one difference being that retired-courses.json now carries its
    // record: the card must render and its credits must count.
    //
    // 8 SH is the assertion that matters. A card that draws but contributes
    // nothing would look fixed and still be short-changing the degree, which
    // is the exact failure this whole change exists to end.
    const union = [{
      subject: "ZZZZ", number: "9999", title: "Retired Course", credits: 4,
      description: "A course a frozen edition published and the current catalog does not.",
      scheduleType: "Lecture", nuPath: [], sections: [], prereqs: [], coreqs: [],
      lifespan: { firstEdition: 2026, lastEdition: 2026, editions: [2026], editionsHeld: 1 },
    }];
    const { errors, bodyText } = await open(
      { [DEAD]: "fall2025", [live.id]: "fall2025" }, union);

    assert.deepEqual(errors, [],
      `the union's record threw on render:\n  ${errors.join("\n  ")}`);
    assert.match(bodyText, /ZZZZ\s*9999/,
      "the retired course is in the union and still did not render — the merge is not reaching the board");
    // Anchored to the credit readout, not a bare /\b8\b/ — an unanchored digit
    // matches a course number, a year or a term label, so it would pass with
    // the total still reading 4 and the whole assertion would be decorative.
    const total = (bodyText.match(/(\d+)\s*(?:SH|credits?)/i) ?? [])[1];
    assert.equal(total, "8",
      `the retired course rendered but the total reads ${total} SH, not 8 — its 4 SH are `
      + "not counted. A card that looks right and still under-counts the degree is the "
      + "failure this change exists to end.");
  });

  test("the rest of the plan survives it", async () => {
    // The failure this exists for: the plan opens, throws nothing, and is
    // EMPTY — indistinguishable to the student from having lost their work.
    const { bodyText } = await open({
      [DEAD]: "fall2025", [live.id]: "fall2025",
    });
    assert.match(bodyText, live.pattern,
      `${live.id} was seeded beside a retired course and is not on the board — `
      + "one dead id emptied the plan");
  });
});
