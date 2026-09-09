// BROWSER · the sample plan follows the catalog year, and the panel resolves.
//
// ── Why this cannot be a Node test ──────────────────────────────────
//
// The RULE — which plan.json a program path maps to — is pure and lives in
// `planKeyFor` (programPaths.js) with `test/unit/plan-key.test.js` on it, ten
// assertions in a tenth of a second. Nothing below re-checks that; this file is
// only for the two things a render can show and Node cannot.
//
// The second one is the reason the file exists. Fixing the loader turned
// `hasSamplePlan` false for every undergraduate on 2026-2027 (Northeastern
// moved Sample Plans of Study onto the colleges' own websites that edition, so
// we hold none for it), and `SamplePlanOffer` reset
// its source to "catalog" unconditionally on every program change. So the panel
// selected a tab that was DISABLED, the body fell through to a "loading…"
// branch that nothing would ever resolve, and no Node suite could see any of
// it: the loader answers correctly, the offer gate answers correctly, and the
// component still never finishes. That state was already reachable — 417
// programs publish no plan at all — and the edition fix would have handed it to
// every undergraduate on the current catalog.
//
// Waiting is on conditions, never on the clock; see catalog-edition.browser.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS = (year) =>
  `../../data/northeastern/programs/undergraduate/${year}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;

// The discriminator, verified against the tree rather than assumed: this
// program publishes a plan in 2026 and none in 2027. A program with a plan in
// both, or in neither, would pass this file in every state.
const HAS_PLAN = 2026, NO_PLAN = 2027;

describe("sample plan · tied to the selected catalog year", () => {
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

  // An EMPTY canvas, deliberately: `sampleplanOffer` shows the "load" verb only
  // then, and a plan already applied would put the section in its `loaded`
  // state instead. No `major2` either — a double major hides the section whole.
  const seed = (major, entYear) => `(${((mj, ey) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad",
      entSem: "fall", entYear: ey, gradSem: "spring", gradYear: ey + 4,
      currentSemId: "fall" + ey,
      major: mj, major2: "", minor1: "", placements: {},
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(K + "tour-seen", "true");
    // The section remembers its fold across sessions. Pin it OPEN so the test
    // reads the panel rather than a collapsed header — and so a change to the
    // default fold cannot silently turn every assertion below into a no-op.
    localStorage.setItem("numap-grad-expand-sampleplan", "true");
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

    const skip = page.getByRole("button", { name: /^Skip$/ }).first();
    const grad = page.getByRole("button", { name: /^Graduation$/ }).first();
    await grad.waitFor({ timeout: 30_000 });
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); continue; }
      opened = await grad.click({ timeout: 500 }).then(() => true).catch(() => false);
    }
    assert.ok(opened, "could not open the graduation panel — something is covering it");
    await page.locator('[data-claude-focus="major"] [data-edition-select]').first()
      .waitFor({ timeout: 30_000 });

    const selOf = (f) => page.locator(`[data-claude-focus="${f}"] [data-edition-select]`).first();
    const chooseYear = async (f, year) => {
      await selOf(f).click();
      const row = page.locator(`[role="listbox"] [role="option"]`, { hasText: `${year - 1}-${year}` }).first();
      await row.waitFor({ timeout: 15_000 });
      await row.click();
      await page.locator('[role="listbox"]').first().waitFor({ state: "detached", timeout: 15_000 });
    };

    /**
     * Whether the section is on screen, and how each source presents — read as
     * ONE synchronous DOM snapshot.
     *
     * Not as a series of Playwright locator calls, which is how this was first
     * written and why it failed against a working fix. Changing the year
     * reloads the program, so the panel unmounts and remounts; a `count()` on
     * one tab followed by an `isDisabled()` on the other straddles that, and
     * the second call sat waiting out its full 30s timeout for an element that
     * had merely blinked. The failure looked exactly like "the section never
     * appeared", which is the opposite of what was happening.
     *
     * One `evaluate` cannot straddle anything: it either sees a mounted section
     * or it sees none, and "none" is a legitimate answer the poll retries.
     */
    const sources = () => page.evaluate(() => {
      const of = (id) => {
        const el = document.querySelector(`[data-testid="plan-source-${id}"]`);
        return el && { enabled: !el.disabled, selected: el.getAttribute("aria-checked") === "true" };
      };
      const catalog = of("catalog"), chart = of("chart");
      return catalog && chart ? { catalog, chart } : null;
    });
    const bodyText = () => page.evaluate(() => document.body.innerText);

    /** Poll the CONDITION the assertions depend on, never the clock. */
    const settleTo = async (pred, what) => {
      for (let i = 0; i < 100; i++) {
        const cur = await sources();
        if (cur && pred(cur)) return cur;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.fail(`${what} — last saw ${JSON.stringify(await sources())}`);
    };

    return { ctx, page, chooseYear, sources, settleTo, bodyText, errors };
  }

  test("an edition that publishes a plan offers it, and it is the source", async () => {
    const { ctx, settleTo, errors } = await openPanel(CS(HAS_PLAN), 2025);
    const s = await settleTo(x => x.catalog.enabled, "2026 never offered its catalog plan");
    assert.ok(s.catalog.selected, "the catalog plan is not the default source");
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("switching to an edition with no plan leaves NO section, and never a flash", async () => {
    // The whole defect in one gesture. Not seeded on 2027 but SWITCHED to it,
    // because switching is what the student does.
    //
    // ── What this asserted before, and why it changed ────────────────
    //
    // It used to require the section to still be there with the Catalog tab
    // greyed and CHART selected. That was right while the section appeared first
    // and computed second. It is wrong now: Computer Science on 2026-2027 has no
    // catalog plan (Northeastern moved Sample Plans of Study to the colleges'
    // own sites) and CHART refuses for it, so BOTH sources are unavailable and
    // the honest render is nothing at all.
    //
    // The section also must not appear on the way to disappearing. Waiting for
    // CHART's answer before rendering is the whole point — a panel that flashes
    // up and vanishes draws the eye to something that was never there.
    const { ctx, chooseYear, sources, bodyText, errors } = await openPanel(CS(HAS_PLAN), 2025);
    assert.ok((await sources())?.catalog.enabled, "precondition: 2026 offers a catalog plan");

    await chooseYear("major", NO_PLAN);

    // Sample continuously rather than checking twice: a flash is by definition
    // brief, and two point-checks can straddle it entirely.
    let sawSection = false, gone = false;
    for (let i = 0; i < 150; i++) {
      const s = await sources();
      if (s === null) { gone = true; break; }
      if (s.catalog.enabled === false) sawSection = true;  // a section for 2027
      await new Promise(r => setTimeout(r, 100));
    }

    assert.ok(gone, "the section is still on screen for an edition with neither source");
    assert.equal(sawSection, false,
      "the section appeared for the new edition and then vanished — the flash this exists to prevent");

    // ...and nothing is left sitting on a promise that will never land.
    assert.ok(!/checking what it includes/i.test(await bodyText()),
      "the panel is stuck on a loading message that nothing will resolve");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
