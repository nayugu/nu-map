// BROWSER · the catalog-edition control, reduced to what only a browser can see.
//
// ── What is deliberately NOT here ───────────────────────────────────
//
// Whether the row appears, which editions it offers, and whether the cohort
// hint is shown are DECISIONS, and they live in `src/core/editionChoice.js`
// with `test/unit/edition-choice.test.js` on them — ten assertions in 0.11s
// against >120s for the six browser cases this file used to carry. The
// mutation probe runs its target suite once per mutant, so those rules cost
// over twenty minutes to verify and now cost nothing.
//
// That move is the repo's own `bankRank` lesson and it is about accuracy first:
// a mutant survived the entire browser suite while that comparator was inline
// in a component, because the natural browser test could not observe an
// ordering at all. A rule inside a component is not merely expensive to check,
// it is harder to check WELL.
//
// ── What is here, and why it needs a browser ────────────────────────
//
// Three facts, none of which is a decision:
//
//   1. the app MOUNTS and the program box shows a name — the 2026-08-20 outage
//      was a const read before its initializer that every Node suite passed;
//   2. the box is not blank for a plan on an edition its cohort does not
//      follow, which is a rendering fact about SearchCombo resolving a value
//      outside its own filtered option list;
//   3. choosing another edition RE-AUDITS the degree and reaches the saved
//      plan — integration across the loader, the audit and persistence.
//
// ── Waiting ─────────────────────────────────────────────────────────
//
// On conditions, never on the clock. The first version of this file padded
// every case with fixed `waitForTimeout(2500)` calls, which is both slow and
// less correct: a fixed sleep expires early on a loaded machine, and the test
// then reads a figure that is not on screen yet and fails as though the number
// were wrong. minor-overlap.browser.test.js carries the same warning.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS = (year) =>
  `../../data/northeastern/programs/undergraduate/${year}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;
const MATH_2026 = "../../data/northeastern/programs/undergraduate/2026/science/mathematics_bs_(boston)/requirements.json";
const MINOR_2026 = "../../data/northeastern/programs/undergraduate/2026/science/mathematics_minor/requirements.json";

const NAME = "Computer Science, BSCS (Boston)";

/**
 * The editions differ in ways a student would notice, which is what makes "the
 * audit re-ran" observable: 134 SH against 133, and 2026 carries a `Science
 * Requirement` section that 2027 drops.
 *
 * Chosen by DIFFING the two records. The first attempt used a section title
 * that looked 2027-only and was in both, so the assertion passed in every state
 * and proved nothing.
 */
const SH_2026 = "134 SH", SH_2027 = "133 SH";

describe("catalog editions · in the running app", () => {
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

  const seed = (major, entYear, minor = "", major2 = "") => `(${((mj, ey, mn, m2) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad",
      entSem: "fall", entYear: ey, gradSem: "spring", gradYear: ey + 4,
      currentSemId: "fall" + ey,
      major: mj, major2: m2, minor1: mn, placements: {},
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${entYear},${JSON.stringify(minor)},${JSON.stringify(major2)})`;

  async function openPanel(major, entYear, minor = "", major2 = "") {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, entYear, minor, major2));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });

    // Open the panel, dismissing the tour if and when it appears.
    //
    // Written as a poll on the ACTION rather than a wait on the tour, because
    // neither "the tour is up" nor "the tour is gone" is knowable in advance:
    // the overlay mounts a moment after load, so a skip loop that runs
    // immediately finds nothing and the Graduation click is then intercepted by
    // a <div> — which is exactly how the first rewrite of this file failed all
    // four cases. A fixed sleep hid that by being long enough on this machine.
    // Retrying the click IS the condition, and it costs nothing when no tour is
    // shown.
    const skip = page.getByRole("button", { name: /^Skip$/ }).first();
    const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
    await grad.waitFor({ timeout: 30_000 });
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
      opened = await grad.click({ timeout: 500 }).then(() => true).catch(() => false);
    }
    assert.ok(opened, "could not open the graduation panel — something is covering it");

    // The panel is OPEN when its own selector exists — the condition the test
    // actually depends on. Also proof the panel opened at all: a click
    // swallowed by a modal leaves an empty board, and assertions about absent
    // things then pass for the worst possible reason.
    await page.locator('[data-claude-focus="major"] select').first()
      .waitFor({ timeout: 30_000 });

    const boxOf   = (f) => page.locator(`[data-claude-focus="${f}"] input`).first();
    const selOf   = (f) => page.locator(`[data-claude-focus="${f}"] select`).first();
    const read = async () => {
      const text = await page.evaluate(() => document.body.innerText);
      return {
        box: await boxOf("major").inputValue(),
        year: await selOf("major").inputValue(),
        hints: text.match(/your cohort: [\d-]+/g) ?? [],
        sh: (text.match(/13[0-9] SH/g) ?? [])[0] ?? null,
      };
    };
    const saved = (key) => page.evaluate((k) =>
      JSON.parse(localStorage.getItem("ncp-plan-data-default"))[k], key);

    return { ctx, page, read, saved, boxOf, selOf, errors };
  }

  test("the panel renders, names the program, and draws its year control", async () => {
    const { ctx, read, errors } = await openPanel(CS(2026), 2025);
    const s = await read();
    assert.equal(s.box, NAME, "the program box is blank");
    assert.equal(s.year, "2026");
    assert.deepEqual(s.hints, [], "a correctly pinned plan was told about its cohort");
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("every declared program off its cohort's edition is still named, and gets a control", async () => {
    // Reachable with no interaction — a share link, or an edited entry term.
    // Before the fix this arrived with an EMPTY box over loaded requirements,
    // no error and no way back. It is a fact about SearchCombo resolving a
    // value that is not in its own filtered option list, so only a render can
    // show it.
    //
    // ⚠ ALL THREE programs must be off-cohort here, and an earlier version of
    // this case got that wrong in a way that passed. It seeded a 2023 entrant
    // (cohort 2024) with a 2026 minor — but pickCatalogYear([2026,2027], 2024)
    // is 2026, so the minor was ON its cohort's edition, resolved from the
    // filtered list like any other, and the assertion below held with
    // `valueOption` deleted. The mutation probe caught it: two mutants about
    // minors SURVIVED. A fall-2026 entrant (cohort 2027) puts every one of the
    // three on the wrong edition, which is what the assertions claim to test.
    const { ctx, read, boxOf, selOf, errors } = await openPanel(CS(2026), 2026, MINOR_2026, MATH_2026);
    const s = await read();
    assert.equal(s.box, NAME, "the box is blank on arrival");
    // Every declared program, not just the first: `valueOption` is wired per
    // call site and deleting one prop leaves the others working.
    assert.equal(await boxOf("minor1").inputValue(), "Mathematics, Minor");
    assert.equal(await boxOf("major2").inputValue(), "Mathematics, BS (Boston)");
    // And each carries its OWN control. Minors get no separate treatment: a
    // minor declared in a different year than the major is exactly the case one
    // plan-wide catalog year could not express.
    assert.equal(await selOf("minor1").inputValue(), "2026", "the minor has no year control");
    assert.equal(await selOf("major2").inputValue(), "2026", "the second major has no year control");
    // Three programs off-cohort, three hints.
    assert.equal(s.hints.length, 3, `expected a hint per program, saw ${JSON.stringify(s.hints)}`);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("choosing another edition re-audits the degree, persists, and resets", async () => {
    const { ctx, page, read, saved, selOf, errors } = await openPanel(CS(2026), 2025);

    const before = await read();
    assert.equal(before.sh, SH_2026);

    await selOf("major").selectOption("2027");
    // Wait for the DEGREE TOTAL to change, which is the thing being asserted.
    await page.locator(`text=${SH_2027}`).first().waitFor({ timeout: 30_000 });

    const after = await read();
    assert.equal(after.sh, SH_2027, "the degree total did not follow the edition");
    assert.equal(after.box, NAME, "changing the edition emptied the program box");
    assert.match(await saved("major"), /\/2027\//, "the choice did not reach the saved plan");
    assert.deepEqual(after.hints, ["your cohort: 2025-2026"]);

    await page.getByRole("button", { name: /^use$/ }).first().click();
    await page.locator(`text=${SH_2026}`).first().waitFor({ timeout: 30_000 });
    assert.match(await saved("major"), /\/2026\//, "the reset did not reach the saved plan");
    assert.deepEqual((await read()).hints, [], "the hint survived being obeyed");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("each program's control moves only that program", async () => {
    // Wiring, and the slip a shared component invites: right row, wrong setter.
    // It still renders and still changes an edition — the wrong one. Cannot be
    // unit-tested without rendering GradPanel, so it earns its place here.
    const { ctx, page, saved, selOf, errors } = await openPanel(CS(2027), 2026, "", MATH_2026);
    await selOf("major2").selectOption("2027");
    await page.waitForFunction(() =>
      /\/2027\//.test(JSON.parse(localStorage.getItem("ncp-plan-data-default")).major2), null,
      { timeout: 30_000 });

    // Keyed on IDENTITY, not year: major 1 is already on 2027, so a year-only
    // check passes even when a shared handler overwrites it with the second
    // major's 2027 path.
    assert.match(await saved("major"), /2027\/computer-information-science\/computer_science_bscs/,
      "the first major was overwritten when the second's edition changed");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
